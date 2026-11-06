import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {receiveStripeEvent,setPlanPrice,startCheckout} from '../lib/services/billing';
import {usableCoupon} from '../lib/services/coupons';
import {marketingEmails,offerSettings,offersToken,runLifecycle,saveOfferSettings,setMarketingEmails,validOffersToken} from '../lib/services/lifecycle';
import {FakeStripe} from './fake-stripe';
const DAY=86400,now=()=>Math.floor(Date.now()/1000);
test('Lifecycle emails: receipts, renewal reminders, failed payments, trials, win-back and trial offers',async()=>{
 const db=embeddedDatabase(new PGlite());const stripe=new FakeStripe();
 const outbox:{to:string;subject:string;text:string}[]=[];const mailer=async(m:{to:string;subject:string;text:string})=>{outbox.push(m);};
 const run=()=>runLifecycle(db,stripe,mailer,'https://rt.test');
 const sent=(to:string)=>outbox.filter(m=>m.to===to);
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID(),email=`${authId}@example.test`;await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,`Sam ${role}`,email,twoFactor]);return {id:(await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id,email};}
  const admin=await actor('super_admin',true),buyer=await actor('student'),quiet=await actor('student'),trialist=await actor('student');
  const [exam]=await db.query<{id:string}>("SELECT id FROM exams WHERE slug='mrcog-part-1'");
  await setPlanPrice(db,stripe,admin.id,{examId:exam.id,months:6,priceCents:9000});
  const [plan]=await db.query<{id:string}>('SELECT id FROM plans WHERE months=6 AND active');
  let n=0;const deliver=(type:string,id:string)=>receiveStripeEvent(db,stripe,{id:`evt_${++n}`,type,objectId:id});
  async function buy(user:{id:string}) {const s=(await startCheckout(db,stripe,user.id,{planId:plan.id,siteUrl:'https://rt.test',cancelPath:'/'})).split('/').pop()!;const p=stripe.pay(s,now(),now()+182*DAY);await deliver('checkout.session.completed',s);await deliver('invoice.paid',p.invoice);return p;}
  // Receipt: one per paid invoice, sent once.
  const paid=await buy(buyer);await buy(quiet);
  let r=await run();assert.equal(r.sent,2);
  assert.match(sent(buyer.email)[0].subject,/^Receipt: MRCOG Part 1 plan$/);assert.match(sent(buyer.email)[0].text,/\$90\.00/);
  assert.equal((await run()).sent,0);// nothing twice
  // Renewal reminder inside 7 days; skipped if auto-renew is turned off before it is sent.
  await db.query(`UPDATE subscriptions SET current_period_end=now()+interval '5 days'`);
  await db.query(`UPDATE subscriptions SET cancel_at_period_end=true WHERE user_id=$1`,[quiet.id]);
  r=await run();assert.equal(r.sent,1);
  assert.match(sent(buyer.email).at(-1)!.subject,/renews on/);assert.match(sent(buyer.email).at(-1)!.text,/\$90\.00/);
  // Payment failed while in the grace period.
  await db.query(`UPDATE subscriptions SET status='past_due',grace_until=now()+interval '6 days' WHERE user_id=$1`,[buyer.id]);
  r=await run();assert.equal(r.sent,1);assert.match(sent(buyer.email).at(-1)!.subject,/couldn't take your MRCOG Part 1 renewal payment/);
  // Win-back: 14 days after a plan lapses, a single-use 20% code tied to the account. Not for students who turned offers off.
  assert.equal((await offerSettings(db)).winBackPercent,20);
  await setMarketingEmails(db,quiet.id,false);assert.equal(await marketingEmails(db,quiet.id),false);
  await db.query(`UPDATE subscriptions SET status='canceled',grace_until=NULL`);
  await db.query(`UPDATE entitlements SET starts_at=now()-interval '200 days',ends_at=now()-interval '15 days' WHERE source='subscription'`);
  r=await run();assert.equal(r.sent,1);
  const winBack=sent(buyer.email).at(-1)!;assert.match(winBack.subject,/20% off to come back/);
  const code=/Your code: (BACK-[0-9A-F]{8})/.exec(winBack.text)![1];
  assert.match(winBack.text,new RegExp(`rt\\.test/mrcog/part-1-recalls\\?code=${code}#plans`));
  assert.match(winBack.text,/To stop offer emails: https:\/\/rt\.test\/email\/offers\?u=/);
  assert.equal((await usableCoupon(db,buyer.id,exam.id,code)).code,code);
  await assert.rejects(usableCoupon(db,quiet.id,exam.id,code),/not valid/);
  assert.equal(sent(quiet.email).some(m=>/come back/.test(m.subject)),false);
  assert.equal((await run()).sent,0);// one win-back per exam
  // A refunded plan never gets a win-back.
  const refunded=await actor('student');await buy(refunded);await run();
  await db.query(`UPDATE subscriptions SET status='canceled',access_hold='refunded' WHERE user_id=$1`,[refunded.id]);
  await db.query(`UPDATE entitlements SET starts_at=now()-interval '200 days',ends_at=now()-interval '15 days' WHERE user_id=$1`,[refunded.id]);
  await run();assert.equal(sent(refunded.email).some(m=>/come back/.test(m.subject)),false);
  // Trials: day 2 and day 3 emails. No trial offer until a Super Admin sets its discount.
  await db.query(`INSERT INTO trials(user_id,exam_id,started_at,ends_at,question_limit) VALUES($1,$2,now()-interval '30 hours',now()+interval '42 hours',50)`,[trialist.id,exam.id]);
  r=await run();assert.equal(r.sent,1);assert.match(sent(trialist.email)[0].subject,/trial ends/);
  await db.query(`UPDATE trials SET started_at=now()-interval '50 hours',ends_at=now()+interval '22 hours' WHERE user_id=$1`,[trialist.id]);
  r=await run();assert.equal(r.sent,1);assert.match(sent(trialist.email)[1].subject,/Last day of your MRCOG Part 1 trial/);
  assert.equal(sent(trialist.email).some(m=>/after your trial/.test(m.subject)),false);
  await assert.rejects(saveOfferSettings(db,buyer.id,{winBackPercent:20,winBackValidDays:14,trialOfferPercent:15}),/Super Admin/);
  await assert.rejects(saveOfferSettings(db,admin.id,{winBackPercent:20,winBackValidDays:14,trialOfferPercent:95}),/1 to 90/);
  await saveOfferSettings(db,admin.id,{winBackPercent:20,winBackValidDays:14,trialOfferPercent:15});
  r=await run();assert.equal(r.sent,1);
  const offer=sent(trialist.email).at(-1)!;assert.match(offer.subject,/15% off MRCOG Part 1 after your trial/);
  const trialCode=/Your code: (TRIAL-[0-9A-F]{8})/.exec(offer.text)![1];
  const [c]=await db.query<{expires:string}>('SELECT expires_at::text AS expires FROM coupons WHERE code=$1',[trialCode]);
  const [t]=await db.query<{ends:string}>('SELECT ends_at::text AS ends FROM trials WHERE user_id=$1',[trialist.id]);
  assert.ok(Date.parse(c.expires)>=Date.parse(t.ends)+47*3600_000);// usable until about 48 hours after the trial
  // Nothing is sent twice.
  assert.equal((await run()).sent,0);
  // The opt-out link is signed per account.
  assert.equal(validOffersToken(buyer.id,offersToken(buyer.id)),true);assert.equal(validOffersToken(quiet.id,offersToken(buyer.id)),false);
  // Failed sends are retried and do not block other emails.
  const flaky=await actor('student');await db.query(`INSERT INTO trials(user_id,exam_id,started_at,ends_at,question_limit) VALUES($1,$2,now()-interval '30 hours',now()+interval '42 hours',50)`,[flaky.id,exam.id]);
  const failing=async(m:{to:string})=>{if(m.to===flaky.email)throw new Error('mail down');};
  const first=await runLifecycle(db,stripe,failing as never,'https://rt.test');assert.equal(first.failed,2);
  assert.equal((await run()).sent,2);assert.deepEqual(sent(flaky.email).map(m=>/after your trial/.test(m.subject)).sort(),[false,true]);// day 2, and the trial offer now that one is set
  assert.equal(paid.sub.startsWith('sub_'),true);
 }finally{await db.close();}
});
