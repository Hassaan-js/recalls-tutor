import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {listExams} from '../lib/services/catalogue';
import {hasExamAccess} from '../lib/services/practice';
import {addPartnerMember,addSeatPack,createPartner,getPartnerDetail,listPartners,partnerRevenue,setKeySuspended,setPartnerProducts,setPartnerStatus} from '../lib/services/partner-admin';
import {assignMany,claimInviteLink,claimInvites,cohortReport,createApiKey,createInviteLink,createWebhookEndpoint,inviteByToken,listApiRequests,parseEmailList,partnerAlerts,requirePartnerAdmin,rotateApiKey,sendEnrollmentEmails,setPartnerConsent,studentPartners,sweepPartners} from '../lib/services/partners';
import {api,RATE_LIMIT,serveApi,type ApiContext,type ApiResult} from '../lib/services/partner-api';
import {deliverWebhooks,signWebhook,validWebhookUrl,type Sender} from '../lib/services/partner-webhooks';
test('Partners: seats, enrolments, the /v1 API, idempotency, consent, links and webhooks',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function account(role:string,opts:{twoFactor?:boolean;verified?:boolean;email?:string}={}) {const authId=randomUUID(),email=opts.email??`${authId}@example.test`;await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',[authId,role,email,opts.verified??true,opts.twoFactor??false]);return {id:(await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id,email,authId};}
  const admin=await account('super_admin',{twoFactor:true}),manager=await account('content_manager');
  const partnerAdmin=await account('student',{twoFactor:true}),outsider=await account('student');
  const existing=await account('student',{email:'existing@student.test'});
  const exam=(await listExams(db))[0];
  const [{slug}]=await db.query<{slug:string}>('SELECT slug FROM exams WHERE id=$1',[exam.id]);
  // Admin: only an MFA Super Admin creates and approves partners.
  await assert.rejects(createPartner(db,manager.id,{name:'Academy',contactEmail:'',billing:'prepaid',creditLimit:null,notes:''}),/Super Admin/);
  const org=await createPartner(db,admin.id,{name:'Gold Academy',contactEmail:'ops@gold.test',billing:'prepaid',creditLimit:null,notes:''});
  await assert.rejects(setPartnerStatus(db,admin.id,org,'approve',''),/at least one product/);
  await setPartnerProducts(db,admin.id,org,[{examId:exam.id,months:6,priceCents:4500},{examId:exam.id,months:3,priceCents:3000}]);
  await addPartnerMember(db,admin.id,org,partnerAdmin.email);
  await assert.rejects(requirePartnerAdmin(db,outsider.id,org),/not a partner admin/);
  await assert.rejects(requirePartnerAdmin(db,partnerAdmin.id,org,{write:true}),/waiting for approval/);
  // Sandbox keys work while the partner is pending; live keys only after approval.
  const test=await createApiKey(db,partnerAdmin.id,org,{mode:'test',label:'Staging',ipAllow:''});
  await assert.rejects(createApiKey(db,partnerAdmin.id,org,{mode:'live',label:'',ipAllow:''}),/approved/);
  await assert.rejects(createApiKey(db,outsider.id,org,{mode:'test',label:'',ipAllow:''}),/not a partner admin/);
  let n=0;
  const call=async(secret:string|null,method:string,path:string,op:(c:ApiContext)=>Promise<ApiResult>,body?:unknown,headers:Record<string,string>={})=>{
   const h:Record<string,string>={'Content-Type':'application/json','x-real-ip':'203.0.113.9',...headers};if(secret)h.Authorization=`Bearer ${secret}`;
   const {response}=await serveApi(db,new Request(`https://recalls.test${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),op,{write:method!=='GET'});
   return {status:response.status,body:await response.json() as Record<string,any>,headers:response.headers};
  };
  const idem=()=>({'Idempotency-Key':`order-${++n}`});
  assert.equal((await call(null,'GET','/v1/products',api.products)).status,401);
  assert.equal((await call('rt_live_nope','GET','/v1/products',api.products)).status,401);
  const products=await call(test.secret,'GET','/v1/products',api.products);
  assert.equal(products.status,200);assert.deepEqual(products.body.data.map((p:any)=>p.id).sort(),[`${slug}-3m`,`${slug}-6m`]);
  const sandboxEnrol=await call(test.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'Sandbox@Student.test',product:`${slug}-6m`},idem());
  assert.equal(sandboxEnrol.status,201);assert.equal(sandboxEnrol.body.status,'active');assert.equal(sandboxEnrol.body.sandbox,true);assert.equal(sandboxEnrol.body.email,'sandbox@student.test');
  assert.equal((await db.query(`SELECT 1 FROM entitlements WHERE source='partner'`)).length,0,'sandbox never grants access');
  assert.equal((await call(test.secret,'GET','/v1/seats',api.seats)).body.data.find((s:any)=>s.product===`${slug}-6m`).available,24);
  // Approve, buy a pack of 3 seats, and go live.
  await setPartnerStatus(db,admin.id,org,'approve','');
  await addSeatPack(db,admin.id,org,{examId:exam.id,months:6,seats:3,priceCents:13500,expiresOn:new Date(Date.now()+200*86400000).toISOString().slice(0,10),reference:'INV-1'});
  const live=await createApiKey(db,partnerAdmin.id,org,{mode:'live',label:'Checkout',ipAllow:'203.0.113.0/24'});
  const hook=await createWebhookEndpoint(db,partnerAdmin.id,org,{mode:'live',url:'https://hooks.gold.test/recalls',events:['enrollment.activated','seats.low_balance','enrollment.expiring','enrollment.expired']});
  assert.throws(()=>validWebhookUrl('https://127.0.0.1/x'),/public/);assert.throws(()=>validWebhookUrl('http://hooks.test'),/https/);
  // Writes need an Idempotency-Key, and a retry with the same key replays the first answer without a second seat.
  assert.equal((await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'a@b.test',product:`${slug}-6m`})).body.error.code,'missing_idempotency_key');
  const key={'Idempotency-Key':'checkout-1001'};
  const first=await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'existing@student.test',product:`${slug}-6m`,external_ref:'order-1001'},key);
  assert.equal(first.status,201);assert.equal(first.body.status,'active','an existing verified account is activated at once');
  assert.equal(await hasExamAccess(db,existing.id,exam.id),true);
  const retry=await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'existing@student.test',product:`${slug}-6m`,external_ref:'order-1001'},key);
  assert.equal(retry.status,201);assert.equal(retry.body.id,first.body.id);assert.equal(retry.headers.get('idempotent-replayed'),'true');
  assert.equal((await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'other@student.test',product:`${slug}-6m`},key)).body.error.code,'idempotency_mismatch');
  assert.equal((await call(live.secret,'GET','/v1/seats',api.seats)).body.data.find((s:any)=>s.product===`${slug}-6m`).available,2);
  // The same student twice is refused; a new email waits as "invited" until that person signs up and verifies.
  assert.equal((await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'existing@student.test',product:`${slug}-6m`},idem())).status,409);
  assert.equal((await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'not-an-email',product:`${slug}-6m`},idem())).body.error.code,'invalid_email');
  assert.equal((await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'x@y.test',product:`${slug}-12m`},idem())).body.error.code,'product_not_allowed');
  const invited=await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'new@student.test',product:`${slug}-6m`},idem());
  assert.equal(invited.body.status,'invited');
  const third=await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'third@student.test',product:`${slug}-6m`},idem());
  assert.equal(third.status,201);
  assert.equal((await call(live.secret,'POST','/v1/enrollments',api.createEnrollment,{email:'fourth@student.test',product:`${slug}-6m`},idem())).status,402,'no seats left');
  // Revoking an unactivated seat returns it to the balance.
  const revoked=await call(live.secret,'DELETE',`/v1/enrollments/${third.body.id}`,api.revokeEnrollment(third.body.id),undefined,idem());
  assert.equal(revoked.body.status,'revoked');assert.equal(revoked.body.seat_returned,true);
  assert.equal((await call(live.secret,'GET','/v1/seats',api.seats)).body.data.find((s:any)=>s.product===`${slug}-6m`).available,1);
  // The invited student signs up with that email and is activated at the first verified sign-in.
  const newcomer=await account('student',{email:'new@student.test'});
  assert.equal(await claimInvites(db,newcomer.id,'New@Student.test'),1);
  assert.equal(await hasExamAccess(db,newcomer.id,exam.id),true);
  assert.equal((await call(live.secret,'GET',`/v1/enrollments/${invited.body.id}`,api.getEnrollment(invited.body.id))).body.status,'active');
  // Another partner's key cannot see this enrolment.
  const other=await createPartner(db,admin.id,{name:'Other Org',contactEmail:'',billing:'prepaid',creditLimit:null,notes:''});
  await setPartnerProducts(db,admin.id,other,[{examId:exam.id,months:6,priceCents:null}]);await addPartnerMember(db,admin.id,other,outsider.email);
  const otherKey=await createApiKey(db,outsider.id,other,{mode:'test',label:'',ipAllow:''}).catch(e=>e);
  assert.match(String(otherKey),/two-step/,'API keys need two-step sign-in');
  // Progress needs the student's consent.
  assert.equal((await call(live.secret,'GET',`/v1/enrollments/${first.body.id}/progress`,api.progress(first.body.id))).body.error.code,'consent_required');
  assert.deepEqual((await studentPartners(db,existing.id)).map(p=>[p.name,p.sharing]),[['Gold Academy',false]]);
  await setPartnerConsent(db,existing.id,org,true);
  const progress=await call(live.secret,'GET',`/v1/enrollments/${first.body.id}/progress`,api.progress(first.body.id));
  assert.equal(progress.status,200);assert.equal(progress.body.progress.answered,0);
  assert.equal((await cohortReport(db,org)).consented,1);
  await setPartnerConsent(db,existing.id,org,false);
  assert.equal((await call(live.secret,'GET',`/v1/enrollments/${first.body.id}/progress`,api.progress(first.body.id))).status,403);
  // Extending an active enrolment uses another seat and adds the months; revoking an active one keeps the seat used.
  const before=new Date(first.body.access_ends_at).getTime();
  const extended=await call(live.secret,'PATCH',`/v1/enrollments/${first.body.id}`,api.changeEnrollment(first.body.id),{extend_months:6},idem());
  assert.equal(extended.status,200);assert.ok(new Date(extended.body.access_ends_at).getTime()-before>150*86400000);
  assert.equal((await call(live.secret,'GET','/v1/seats',api.seats)).body.data.find((s:any)=>s.product===`${slug}-6m`).available,0);
  const gone=await call(live.secret,'DELETE',`/v1/enrollments/${invited.body.id}`,api.revokeEnrollment(invited.body.id),undefined,idem());
  assert.equal(gone.body.seat_returned,false);assert.equal(await hasExamAccess(db,newcomer.id,exam.id),false);
  // IP allow-list, rate limit, key suspension and rotation.
  assert.equal((await call(live.secret,'GET','/v1/products',api.products,undefined,{'x-real-ip':'198.51.100.7'})).body.error.code,'ip_not_allowed');
  const [{id:liveKeyId}]=await db.query<{id:string}>(`SELECT id FROM api_keys WHERE organisation_id=$1 AND mode='live'`,[org]);
  await setKeySuspended(db,admin.id,liveKeyId,true);
  assert.equal((await call(live.secret,'GET','/v1/products',api.products)).body.error.code,'api_key_suspended');
  await setKeySuspended(db,admin.id,liveKeyId,false);
  const rotated=await rotateApiKey(db,partnerAdmin.id,org,liveKeyId);
  assert.equal((await call(live.secret,'GET','/v1/products',api.products)).status,200,'the old key works for 24 hours after rotation');
  assert.equal((await call(rotated.secret,'GET','/v1/products',api.products)).status,200);
  await db.query(`INSERT INTO api_requests(organisation_id,key_id,mode,method,path,status) SELECT $1,$2,'test','GET','/v1/products',200 FROM generate_series(1,$3)`,[org,(await db.query<{id:string}>(`SELECT id FROM api_keys WHERE organisation_id=$1 AND mode='test'`,[org]))[0].id,RATE_LIMIT]);
  const limited=await call(test.secret,'GET','/v1/products',api.products);
  assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
  assert.ok((await listApiRequests(db,org)).length>=10,'requests are logged for the portal');
  // Webhooks: signed, delivered, retried after a failure.
  const seen:{url:string;headers:Record<string,string>;body:string}[]=[];let fail=true;
  const send:Sender=async(url,init)=>{seen.push({url,headers:init.headers,body:init.body});if(fail){fail=false;return {status:500};}return {status:200};};
  const firstRun=await deliverWebhooks(db,{send});
  assert.equal(firstRun.sent,2,"two live activations");assert.equal(firstRun.delivered,firstRun.sent-1);
  const sig=seen[0].headers['Recalls-Signature'];const t=Number(/t=(\d+)/.exec(sig)![1]);
  assert.equal(sig,signWebhook(hook.secret,seen[0].body,t));
  assert.equal(/v1=([0-9a-f]+)/.exec(sig)![1],createHmac('sha256',hook.secret).update(`${t}.${seen[0].body}`).digest('hex'));
  assert.equal(JSON.parse(seen[0].body).type,'enrollment.activated');
  const [{retrying}]=await db.query<{retrying:number}>(`SELECT count(*)::int AS retrying FROM webhook_deliveries WHERE delivered_at IS NULL AND attempts=1 AND next_attempt_at>now()`);
  assert.equal(retrying,1);
  await db.query(`UPDATE webhook_deliveries SET next_attempt_at=now() WHERE delivered_at IS NULL`);
  assert.equal((await deliverWebhooks(db,{send})).delivered,1);
  // CSV: 100 students in one step, refused in full when seats are short.
  const csv=parseEmailList(['email',...Array.from({length:100},(_,i)=>`student${i}@cohort.test,Name ${i}`),'student1@cohort.test'].join('\n'));
  assert.equal(csv.length,100);
  await assert.rejects(assignMany(db,partnerAdmin.id,org,{examId:exam.id,months:3,emails:csv,source:'csv'}),/needs 100 seats and 0/);
  await addSeatPack(db,admin.id,org,{examId:exam.id,months:3,seats:102,priceCents:null,expiresOn:new Date(Date.now()+10*86400000).toISOString().slice(0,10),reference:''});
  await db.query('UPDATE organisations SET low_balance_at=2 WHERE id=$1',[org]);
  const bulk=await assignMany(db,partnerAdmin.id,org,{examId:exam.id,months:3,emails:csv,source:'csv'});
  assert.equal(bulk.ids.length,100);assert.ok(bulk.results.every(r=>r.ok&&r.status==='invited'));
  assert.equal((await partnerAlerts(db,org)).filter(a=>a.kind==='low_balance').length,1,'low balance alert at the threshold');
  // Invite link with a cap of one.
  const link=await createInviteLink(db,partnerAdmin.id,org,{examId:exam.id,months:3,cap:1,days:7,label:'Cohort B'});
  const token=link.url.split('/join/')[1];
  assert.equal((await inviteByToken(db,token))!.usable,true);
  const joiner=await account('student'),late=await account('student');
  await claimInviteLink(db,joiner.id,token);
  assert.equal(await hasExamAccess(db,joiner.id,exam.id),true);
  await assert.rejects(claimInviteLink(db,late.id,token),/All seats/);
  // Seat emails go out once; the sweep raises the expiring-pack alert and sends expiry events.
  const mail:string[]=[];
  assert.equal(await sendEnrollmentEmails(db,async m=>{mail.push(m.to);}),101);
  assert.equal(await sendEnrollmentEmails(db,async m=>{mail.push(m.to);}),0);
  assert.ok(mail.includes('existing@student.test'));
  await db.query(`UPDATE partner_enrollments SET ends_at=now()+interval '3 days' WHERE id=$1`,[first.body.id]);
  const swept=await sweepPartners(db,async()=>{});
  assert.equal(swept.expiring,1);assert.equal(swept.packs,1);
  assert.ok((await partnerAlerts(db,org)).some(a=>a.kind==='pack_expiring'));
  await db.query(`UPDATE partner_enrollments SET ends_at=now()-interval '1 minute' WHERE id=$1`,[first.body.id]);
  assert.equal((await sweepPartners(db)).expired,1);
  assert.equal((await call(rotated.secret,'GET',`/v1/enrollments/${first.body.id}`,api.getEnrollment(first.body.id))).body.status,'expired');
  // Suspending the partner stops live keys at once; admin views and revenue.
  await setPartnerStatus(db,admin.id,org,'suspend','Unpaid invoice');
  assert.equal((await call(rotated.secret,'GET','/v1/products',api.products)).body.error.code,'partner_inactive');
  const listed=(await listPartners(db,admin.id)).find(p=>p.id===org)!;
  assert.equal(listed.status,'suspended');assert.equal(listed.members,1);
  const detail=(await getPartnerDetail(db,admin.id,org))!;
  assert.equal(detail.billing.packs.length,2);assert.equal(detail.keys.filter(k=>k.mode==='live').length,2);
  const revenue=await partnerRevenue(db,admin.id);
  assert.equal(revenue.find(r=>r.partner==='Gold Academy'&&r.kind==='pack')!.cents,13500);
  assert.ok((await db.query(`SELECT 1 FROM audit_log WHERE action='partner.approved'`)).length);
 } finally {await db.close();}
});
