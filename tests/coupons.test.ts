import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {receiveStripeEvent,setPlanPrice,startCheckout} from '../lib/services/billing';
import {createCoupon,csvCell,deactivateCoupon,describeDiscount,issuePersonalCoupon,listCoupons,revenueCsv,revenueReport,syncCouponsToStripe,usableCoupon} from '../lib/services/coupons';
import {FakeStripe} from './fake-stripe';
const DAY=86400,now=()=>Math.floor(Date.now()/1000),today=()=>new Date().toISOString().slice(0,10);
test('Coupons: admin rules, Stripe sync, checkout, revenue ledger, reports and CSV',async()=>{
 const db=embeddedDatabase(new PGlite());const stripe=new FakeStripe();
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,role,`${authId}@example.test`,twoFactor]);return (await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id;}
  const admin=await actor('super_admin',true),manager=await actor('content_manager'),student=await actor('student'),other=await actor('student');
  const exams=await db.query<{id:string;slug:string}>("SELECT id,slug FROM exams ORDER BY slug");
  const exam=exams.find(e=>e.slug==='mrcog-part-1')!,otherExam=exams.find(e=>e.slug!=='mrcog-part-1')!;
  const [sitting]=await db.query<{id:string}>(`INSERT INTO sittings(exam_id,slug,label,year,published) VALUES($1,'september-2026','September 2026',2026,true) RETURNING id`,[exam.id]);
  await setPlanPrice(db,stripe,admin,{examId:exam.id,months:6,priceCents:10000});
  const [plan]=await db.query<{id:string}>('SELECT id FROM plans WHERE months=6 AND active');
  let n=0;const deliver=(type:string,id:string)=>receiveStripeEvent(db,stripe,{id:`evt_${++n}`,type,objectId:id});
  const base={name:'Spring campaign',kind:'percent' as const,value:25,duration:'once' as const,durationMonths:null,examIds:[],maxRedemptions:null,expiresAt:null,firstTimeOnly:false};
  // Only a Super Admin; codes are validated and never reused.
  await assert.rejects(createCoupon(db,stripe,manager,{...base,code:'SPRING25'}),/Super Admin/);
  await assert.rejects(createCoupon(db,stripe,admin,{...base,code:'no'}),/3 to 40/);
  await assert.rejects(createCoupon(db,stripe,admin,{...base,code:'BIG',value:120}),/between 1 and 100/);
  await assert.rejects(createCoupon(db,stripe,admin,{...base,code:'LONG',duration:'repeating'}),/number of months/);
  await assert.rejects(createCoupon(db,stripe,admin,{...base,code:'OLD',expiresAt:'2020-01-01'}),/future/);
  // Saved before Stripe is connected, then synced. " spring 25 " is normalised to SPRING25.
  const saved=await createCoupon(db,null,admin,{...base,code:' spring25 '});
  assert.equal(saved.code,'SPRING25');assert.equal(saved.synced,false);
  await assert.rejects(createCoupon(db,stripe,admin,{...base,code:'SPRING25'}),/already exists/);
  await assert.rejects(usableCoupon(db,student,exam.id,'SPRING25'),/not valid/);// not in Stripe yet
  assert.deepEqual(await syncCouponsToStripe(db,stripe,admin),{synced:1,failed:[]});
  // A coupon for an exam that is not in Stripe yet cannot be synced until its price is.
  const scoped=await createCoupon(db,stripe,admin,{...base,code:'OTHER10',value:10,examIds:[otherExam.id]});
  assert.equal(scoped.synced,false);assert.match((await syncCouponsToStripe(db,stripe,admin)).failed[0],/not in Stripe yet/);
  const fixed=await createCoupon(db,stripe,admin,{...base,code:'TENOFF',kind:'amount',value:1000,duration:'repeating',durationMonths:3,examIds:[exam.id],firstTimeOnly:true});
  assert.equal(fixed.synced,true);
  const [promo]=[...stripe.promos.values()].filter(p=>p.code==='TENOFF');
  assert.deepEqual(stripe.coupons.get(promo.coupon)!.products,[...stripe.products.keys()]);
  assert.equal(describeDiscount({kind:'amount',percentOff:null,amountOffCents:1000,duration:'repeating',durationMonths:3}),'$10 off for 3 months');
  // Checkout: our code is applied directly; scope and exam are checked before Stripe sees it.
  await assert.rejects(startCheckout(db,stripe,student,{planId:plan.id,siteUrl:'https://rt.test',cancelPath:'/',promoCode:'OTHER10'}),/not valid/);
  await assert.rejects(startCheckout(db,stripe,student,{planId:plan.id,siteUrl:'https://rt.test',cancelPath:'/',promoCode:'NOPE-1'}),/not valid/);
  const url=await startCheckout(db,stripe,student,{planId:plan.id,siteUrl:'https://rt.test',cancelPath:'/',promoCode:'spring25',fromSitting:'september-2026'});
  const sessionId=url.split('/').pop()!,session=stripe.sessions.get(sessionId)!;
  assert.equal(stripe.promos.get(session.promotionCode!)!.code,'SPRING25');assert.equal(session.sittingId,sitting.id);
  // Payment: the paid invoice is recorded once, with the discount, coupon and sitting.
  const paid=stripe.pay(sessionId,now(),now()+182*DAY);
  await deliver('checkout.session.completed',sessionId);
  assert.equal(await deliver('invoice.paid',paid.invoice),'processed');await deliver('invoice.paid',paid.invoice);
  const payments=await db.query<{kind:string;amount_cents:number;discount_cents:number;coupon_id:string;sitting_id:string}>('SELECT kind,amount_cents,discount_cents,coupon_id,sitting_id FROM billing_payments');
  assert.equal(payments.length,1);assert.deepEqual([payments[0].kind,payments[0].amount_cents,payments[0].discount_cents,payments[0].coupon_id,payments[0].sitting_id],['new',7500,2500,saved.id,sitting.id]);
  // First-purchase-only codes are refused once the student has paid.
  await assert.rejects(usableCoupon(db,student,exam.id,'TENOFF'),/first purchases only/);
  assert.equal((await usableCoupon(db,other,exam.id,'TENOFF')).code,'TENOFF');
  // A renewal at full price, then a partial refund and a dispute that is later won.
  const sub=stripe.subs.get(paid.sub)!;const renewal=stripe.invoice(paid.sub,sub.customer);await deliver('invoice.paid',renewal);
  const renewalCharge=stripe.invoices.get(renewal)!.charge;stripe.charges.get(renewalCharge)!.refunded=2000;await deliver('charge.refunded',renewalCharge);
  stripe.disputes.set('dp_9',stripe.invoices.get(paid.invoice)!.charge);await deliver('charge.dispute.created','dp_9');
  let report=await revenueReport(db,admin,{from:today(),to:today(),group:'day'});
  assert.deepEqual([report.totals.payments,report.totals.paidCents,report.totals.newCents,report.totals.renewalCents,report.totals.discountCents,report.totals.refundCents,report.totals.disputeCents,report.totals.netCents],[2,17500,7500,10000,2500,2000,7500,8000]);
  assert.equal(report.periods.length,1);assert.equal(report.periods[0].key,today());
  assert.deepEqual(report.coupons.map(c=>[c.label,c.payments,c.discountCents]).sort(),[['No coupon',1,0],['SPRING25',1,2500]]);
  assert.ok(report.sittings.some(s=>s.label==='MRCOG Part 1 · September 2026'||/September 2026/.test(s.label)));
  assert.equal(report.kinds.find(k=>k.key==='renewal')!.refundCents,2000);
  stripe.disputeStatus.set('dp_9','won');await deliver('charge.dispute.closed','dp_9');
  report=await revenueReport(db,admin,{from:today(),to:today(),group:'month'});
  assert.equal(report.totals.disputeCents,0);assert.equal(report.totals.netCents,15500);
  await assert.rejects(revenueReport(db,admin,{from:'2026-02-01',to:'2026-01-01',group:'day'}),/after the end/);
  await assert.rejects(revenueReport(db,manager,{from:today(),to:today(),group:'day'}),/Super Admin/);
  // CSV export: one row per payment, spreadsheet formulas neutralised, and the export is audited.
  const csv=await revenueCsv(db,admin,{from:today(),to:today()});
  const lines=csv.trim().split('\r\n');assert.equal(lines.length,3);
  assert.match(lines[0],/^Paid \(UTC\),Stripe invoice,Exam/);assert.match(lines[1],/,new,SPRING25,100\.00,25\.00,75\.00,0\.00,0\.00,USD$/);assert.match(lines[2],/,renewal,,100\.00,0\.00,100\.00,20\.00,0\.00,USD$/);
  assert.equal(csvCell('=HYPERLINK("x")'),`"'=HYPERLINK(""x"")"`);assert.equal(csvCell('a,b'),'"a,b"');
  assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='revenue.exported'")).length);
  // The coupon list shows use and revenue; turning a code off also turns it off in Stripe.
  const list=await listCoupons(db,admin);
  assert.deepEqual(list.map(c=>[c.code,c.state]).sort(),[['OTHER10','not_synced'],['SPRING25','live'],['TENOFF','live']]);
  assert.equal(list.find(c=>c.code==='SPRING25')!.uses,1);
  await deactivateCoupon(db,stripe,admin,saved.id);
  assert.equal(stripe.promos.get(session.promotionCode!)!.active,false);
  await assert.rejects(usableCoupon(db,other,exam.id,'SPRING25'),/not valid/);
  await assert.rejects(deactivateCoupon(db,stripe,admin,saved.id),/already turned off/);
  // Personal codes: single use, tied to the account's Stripe customer, one per purpose and exam.
  const first=await issuePersonalCoupon(db,stripe,{userId:student,examId:exam.id,purpose:'win_back',percentOff:20,validDays:14,name:'Win-back 20%'});
  const again=await issuePersonalCoupon(db,stripe,{userId:student,examId:exam.id,purpose:'win_back',percentOff:20,validDays:14,name:'Win-back 20%'});
  assert.equal(first.code,again.code);assert.equal(first.fresh,true);assert.equal(again.fresh,false);assert.match(first.code,/^BACK-[0-9A-F]{8}$/);
  const personalPromo=[...stripe.promos.values()].find(p=>p.code===first.code)!;
  assert.equal(personalPromo.customer,(await db.query<{id:string}>('SELECT stripe_customer_id AS id FROM billing_customers WHERE user_id=$1',[student]))[0].id);assert.equal(personalPromo.maxRedemptions,1);
  await assert.rejects(usableCoupon(db,other,exam.id,first.code),/not valid/);
  assert.equal((await listCoupons(db,admin)).some(c=>c.code===first.code),false);// personal codes stay out of the campaign list
  assert.equal((await listCoupons(db,admin,{personal:true})).some(c=>c.code===first.code),true);
 }finally{await db.close();}
});
