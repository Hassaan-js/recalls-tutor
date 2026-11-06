import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { embeddedDatabase } from '../lib/db/client';
import { migrate } from '../lib/db/migrate';
import { seedCatalogue } from '../lib/db/seed';
import { listExams, getExamBySlug } from '../lib/services/catalogue';
import { transitionQuestion } from '../lib/services/content';
import { requirePermission, type Role } from '../lib/auth/permissions';
import { isEntitlementActive } from '../lib/services/access';

test('only human publishing roles may publish', () => {
 for (const role of ['student','reviewer','ai_agent'] as Role[]) assert.throws(()=>requirePermission(role,'publish'),/FORBIDDEN/);
 for (const role of ['content_manager','super_admin'] as Role[]) assert.doesNotThrow(()=>requirePermission(role,'publish'));
 assert.throws(()=>requirePermission('ai_agent','approve'),/FORBIDDEN/);
});
test('access respects start, exact expiry, and revocation', () => {
 const start=new Date('2026-10-30T00:00:00Z'),end=new Date('2026-11-02T00:00:00Z');
 const access={startsAt:start,endsAt:end,revokedAt:null};
 assert.equal(isEntitlementActive(access,new Date('2026-10-29')),false);
 assert.equal(isEntitlementActive(access,start),true);
 assert.equal(isEntitlementActive(access,end),false);
 assert.equal(isEntitlementActive({...access,revokedAt:start},start),false);
});
test('database catalogue, approval boundary, atomic audit and relational integrity', async () => {
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db); await migrate(db);
  await seedCatalogue(db); await seedCatalogue(db);
  const exams=await listExams(db);
  assert.equal(exams.length,3);
  assert.ok(exams.every(exam=>exam.launchStatus==='planned' && exam.questionCount===0));
  const exam=await getExamBySlug('mrcog-part-1',db);
  assert.ok(exam); assert.deepEqual(exam.plans,[]);
  assert.equal(await getExamBySlug("' OR 1=1 --",db),null);
  const [reviewer]=await db.query<{id:string}>("INSERT INTO app_users(auth_id,role) VALUES('reviewer','reviewer') RETURNING id");
  const [manager]=await db.query<{id:string}>("INSERT INTO app_users(auth_id,role) VALUES('manager','content_manager') RETURNING id");
  const [question]=await db.query<{id:string}>('INSERT INTO questions(exam_id) VALUES($1) RETURNING id',[exam.id]);
  await assert.rejects(transitionQuestion(db,manager.id,question.id,'publish'),/INVALID_TRANSITION/);
  await assert.rejects(transitionQuestion(db,reviewer.id,question.id,'submit_review'),/VERSION_REQUIRED/);
  const [version]=await db.query<{id:string}>(`INSERT INTO question_versions(question_id,version,stem,options,correct_answers,explanation) VALUES($1,1,'PRIVATE TEST STEM','[]','[]','PRIVATE TEST EXPLANATION') RETURNING id`,[question.id]);
  await db.query('UPDATE questions SET current_version_id=$1 WHERE id=$2',[version.id,question.id]);
  await transitionQuestion(db,reviewer.id,question.id,'submit_review');
  await assert.rejects(transitionQuestion(db,reviewer.id,question.id,'publish'),/FORBIDDEN/);
  assert.equal((await getExamBySlug(exam.slug,db))?.questionCount,0);
  await transitionQuestion(db,reviewer.id,question.id,'approve');
  await transitionQuestion(db,manager.id,question.id,'publish');
  await assert.rejects(transitionQuestion(db,manager.id,question.id,'publish'),/INVALID_TRANSITION/);
  const publicResult=await getExamBySlug(exam.slug,db);
  assert.equal(publicResult?.questionCount,1);
  assert.ok(!JSON.stringify(publicResult).includes('PRIVATE TEST'));
  assert.equal((await db.query('SELECT * FROM audit_log')).length,3);
  await assert.rejects(db.query('DELETE FROM audit_log'),/append-only/);
  const other=exams.find(item=>item.id!==exam.id)!;
  const [sitting]=await db.query<{id:string}>("INSERT INTO sittings(exam_id,slug,label,year) VALUES($1,'sample','Sample',2026) RETURNING id",[other.id]);
  await assert.rejects(db.query('INSERT INTO question_sittings(question_id,sitting_id,exam_id) VALUES($1,$2,$3)',[question.id,sitting.id,exam.id]));
  const [otherQuestion]=await db.query<{id:string}>('INSERT INTO questions(exam_id) VALUES($1) RETURNING id',[exam.id]);
  await assert.rejects(db.query('UPDATE questions SET current_version_id=$1 WHERE id=$2',[version.id,otherQuestion.id]));
  await transitionQuestion(db,manager.id,question.id,'retire');
  assert.equal((await getExamBySlug(exam.slug,db))?.questionCount,0);
 } finally {await db.close();}
});
