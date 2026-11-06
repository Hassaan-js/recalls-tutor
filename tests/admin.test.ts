import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {extendAccess,getOverview,getStudent,listAuditLog,listStudents,listTeam,prepareResetFor,revokeAccess,setRole} from '../lib/services/admin';
import {hasExamAccess} from '../lib/services/practice';
import {suspendAccount} from '../lib/services/protection';
import {listExams} from '../lib/services/catalogue';
test('Admin: overview figures, student search and detail, access grants, roles and audit log',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,opts:{twoFactor?:boolean;verified?:boolean;name?:string}={}) {const authId=randomUUID(),email=`${authId}@example.test`;await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',[authId,opts.name??role,email,opts.verified??true,opts.twoFactor??false]);return {id:(await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id,email,authId};}
  const admin=await actor('super_admin',{twoFactor:true}),adminNoMfa=await actor('super_admin'),manager=await actor('content_manager'),reviewer=await actor('reviewer');
  const paid=await actor('student',{name:'Paid Student'}),trial=await actor('student',{name:'Trial Student'}),idle=await actor('student',{name:'Idle Student'}),unverified=await actor('student',{verified:false,name:'New Student'});
  const exam=(await listExams(db))[0];
  const [plan]=await db.query<{id:string}>(`INSERT INTO plans(exam_id,months,price_cents,active) VALUES($1,6,12000,true) RETURNING id`,[exam.id]);
  await db.query(`INSERT INTO subscriptions(user_id,exam_id,plan_id,stripe_subscription_id,stripe_customer_id,status,current_period_end) VALUES($1,$2,$3,'sub_1','cus_1','active',now()+interval '10 days')`,[paid.id,exam.id,plan.id]);
  await db.query(`INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'subscription',now(),now()+interval '10 days')`,[paid.id,exam.id]);
  await db.query(`INSERT INTO trials(user_id,exam_id,ends_at,question_limit) VALUES($1,$2,now()+interval '3 days',50)`,[trial.id,exam.id]);
  await db.query(`INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) VALUES($1,$2,'trial',now(),now()+interval '3 days')`,[trial.id,exam.id]);
  // Overview: every staff role sees the counts; only an MFA Super Admin sees money.
  await assert.rejects(getOverview(db,paid.id),/permission/);
  const forManager=await getOverview(db,manager.id);
  assert.equal(forManager.money,null);
  assert.equal(forManager.students.total,4);assert.equal(forManager.students.verified,3);assert.equal(forManager.students.new7d,4);
  assert.equal(forManager.access.paying,1);assert.equal(forManager.access.trials,1);assert.equal(forManager.access.renewalsDue14d,1);
  assert.equal(forManager.signups.length,14);assert.equal(forManager.signups.at(-1)!.n,4);
  const forAdmin=await getOverview(db,admin.id);
  assert.equal(forAdmin.money!.mrrCents,2000);assert.equal(forAdmin.money!.newValue30dCents,12000);
  // Students: Super Admin with MFA only; search and filters.
  await assert.rejects(listStudents(db,manager.id),/Super Admin/);
  await assert.rejects(listStudents(db,adminNoMfa.id),/Super Admin/);
  assert.equal((await listStudents(db,admin.id)).total,4);
  assert.deepEqual((await listStudents(db,admin.id,{filter:'paying'})).rows.map(r=>r.name),['Paid Student']);
  assert.deepEqual((await listStudents(db,admin.id,{filter:'trial'})).rows.map(r=>r.name),['Trial Student']);
  assert.equal((await listStudents(db,admin.id,{filter:'none'})).total,2);
  assert.deepEqual((await listStudents(db,admin.id,{query:'idle'})).rows.map(r=>r.id),[idle.id]);
  assert.deepEqual((await listStudents(db,admin.id,{query:paid.id.slice(0,8)})).rows.map(r=>r.id),[paid.id]);
  const detail=(await getStudent(db,admin.id,paid.id))!;
  assert.equal(detail.subscriptions.length,1);assert.equal(detail.subscriptions[0].priceCents,12000);assert.equal(detail.access.filter(a=>a.live).length,1);
  assert.equal(await getStudent(db,admin.id,manager.id),null);
  // Access: extensions start after current access and are audited; only complimentary grants can be revoked.
  await assert.rejects(extendAccess(db,admin.id,{userId:idle.id,examId:exam.id,days:30,note:''}),/reason/);
  await assert.rejects(extendAccess(db,manager.id,{userId:idle.id,examId:exam.id,days:30,note:'x'}),/Super Admin/);
  await assert.rejects(extendAccess(db,admin.id,{userId:unverified.id,examId:exam.id,days:30,note:'x'}),/verified/);
  await extendAccess(db,admin.id,{userId:idle.id,examId:exam.id,days:30,note:'Support goodwill'});
  assert.equal(await hasExamAccess(db,idle.id,exam.id),true);
  const extended=await extendAccess(db,admin.id,{userId:paid.id,examId:exam.id,days:5,note:'Exam postponed'});
  const days=(Date.parse(extended)-Date.now())/86400000;
  assert.ok(days>14.9&&days<15.1,`extension starts after the paid period (got ${days})`);
  const paidAccess=(await getStudent(db,admin.id,paid.id))!.access;
  await assert.rejects(revokeAccess(db,admin.id,paidAccess.find(a=>a.source==='subscription')!.id,'x'),/complimentary/);
  const idleGrant=(await getStudent(db,admin.id,idle.id))!.access[0];
  await revokeAccess(db,admin.id,idleGrant.id,'Granted by mistake');
  assert.equal(await hasExamAccess(db,idle.id,exam.id),false);
  // Password reset is audited and needs a real account.
  assert.equal(await prepareResetFor(db,admin.id,paid.id),paid.email);
  // Suspension shows in the list filter.
  await suspendAccount(db,admin.id,trial.id,'Sharing account');
  assert.deepEqual((await listStudents(db,admin.id,{filter:'suspended'})).rows.map(r=>r.id),[trial.id]);
  // Roles: Super Admin only, never your own, verified accounts only, sessions ended.
  await db.query(`INSERT INTO auth_sessions(id,token,user_id,expires_at,created_at,updated_at) VALUES($1,$2,$3,now()+interval '1 day',now(),now())`,[randomUUID(),randomUUID(),idle.authId]);
  await assert.rejects(setRole(db,manager.id,{email:idle.email,role:'reviewer'}),/Super Admin/);
  await assert.rejects(setRole(db,admin.id,{userId:admin.id,role:'student'}),/own role/);
  await assert.rejects(setRole(db,admin.id,{email:unverified.email,role:'reviewer'}),/verified/);
  await assert.rejects(setRole(db,admin.id,{email:'nobody@example.test',role:'reviewer'}),/No active account/);
  await assert.rejects(setRole(db,admin.id,{email:idle.email,role:'owner'}),/valid role/);
  const promoted=await setRole(db,admin.id,{email:idle.email.toUpperCase(),role:'reviewer'});
  assert.deepEqual([promoted.from,promoted.to],['student','reviewer']);
  assert.equal((await db.query('SELECT 1 FROM auth_sessions WHERE user_id=$1',[idle.authId])).length,0);
  await assert.rejects(setRole(db,admin.id,{userId:idle.id,role:'reviewer'}),/already/);
  const team=await listTeam(db,admin.id);
  assert.equal(team[0].role,'super_admin');assert.ok(team.some(t=>t.id===idle.id&&t.role==='reviewer'));assert.ok(!team.some(t=>t.role==='student'));
  await setRole(db,admin.id,{userId:reviewer.id,role:'student'});
  assert.ok(!(await listTeam(db,admin.id)).some(t=>t.id===reviewer.id));
  // Audit log: every action above, newest first, filterable by area.
  await assert.rejects(listAuditLog(db,manager.id),/Super Admin/);
  const log=await listAuditLog(db,admin.id);
  for(const action of ['entitlement.granted','entitlement.revoked','account.password_reset_sent','account.suspended','account.role_changed'])assert.ok(log.some(l=>l.action===action),action);
  assert.ok(log.every((l,i)=>i===0||l.at<=log[i-1].at));
  assert.ok((await listAuditLog(db,admin.id,{action:'entitlement'})).every(l=>l.action.startsWith('entitlement')));
  assert.equal((await listAuditLog(db,admin.id,{action:'account.role'})).length,2);
 } finally {await db.close();}
});
