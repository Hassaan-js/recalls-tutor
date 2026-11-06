import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {createRecall,getStudioQuestion,saveStudioDraft,reviewStudioQuestion,setQuestionTags} from '../lib/services/studio';
import {contentSitemap,draftSittingReport,examTopicLinks,getPublishedPost,getSamplePage,getTopicPage,listPublishedPosts,savePost,setPostStatus,setPublicSample} from '../lib/services/content-site';
test('SEO-2: free samples, topic pages, sample pages, blog and sitting reports',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);
  async function actor(role:string,twoFactor=false) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,two_factor_enabled,created_at,updated_at) VALUES($1,$2,$3,true,$4,now(),now())',[authId,role,`${authId}@example.test`,twoFactor]);return (await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id;}
  const manager=await actor('content_manager'),reviewer=await actor('reviewer');
  const [exam]=await db.query<{id:string;family:string;seo:string}>("SELECT e.id,f.slug AS family,e.seo_slug AS seo FROM exams e JOIN exam_families f ON f.id=e.family_id WHERE e.slug='mrcog-part-1'");
  const [topic]=await db.query<{id:string}>(`INSERT INTO topics(exam_id,name,slug) VALUES($1,'Labour ward','labour-ward') RETURNING id`,[exam.id]);
  const [sub]=await db.query<{id:string}>(`INSERT INTO topics(exam_id,name,slug,parent_id) VALUES($1,'Postpartum haemorrhage','pph',$2) RETURNING id`,[exam.id,topic.id]);
  const [sitting]=await db.query<{id:string}>(`INSERT INTO sittings(exam_id,slug,label,year,month,published) VALUES($1,'september-2026','September 2026',2026,9,true) RETURNING id`,[exam.id]);
  async function question(n:number,publish=true,topicId:string|null=sub.id) {
   const id=await createRecall(db,manager,{examId:exam.id,sourceLabel:'Synthetic',sourceText:`SOURCE ${n}`,requestId:randomUUID()});
   const first=(await getStudioQuestion(db,reviewer,id))!;const v=await saveStudioDraft(db,reviewer,id,first.versionId,{stem:`Synthetic stem ${n} paid content`,options:['A','B','C','D','E'],correctAnswer:1,explanation:'x',references:['ref'],keyNotes:['note']});
   await setQuestionTags(db,manager,id,{topicId,difficulty:null,sittingIds:[sitting.id]});
   if(publish){await reviewStudioQuestion(db,reviewer,id,v,'submit_review',false,'');await reviewStudioQuestion(db,reviewer,id,v,'approve',true,'');await reviewStudioQuestion(db,manager,id,v,'publish',false,'');}
   return id;
  }
  const q=[await question(1),await question(2),await question(3),await question(4),await question(5),await question(6)];
  const draft=await question(7,false),untagged=await question(8,true,null);
  // Only content managers; only published, tagged questions; at most five per topic.
  await assert.rejects(setPublicSample(db,reviewer,q[0],true),/content manager/);
  await assert.rejects(setPublicSample(db,manager,draft,true),/Only published/);
  await assert.rejects(setPublicSample(db,manager,untagged,true),/topic first/);
  const slug=await setPublicSample(db,manager,q[0],true);
  assert.match(slug,/^synthetic-stem-1-paid-content-[0-9a-f]{6}$/);
  for(const id of q.slice(1,5))await setPublicSample(db,manager,id,true);
  await assert.rejects(setPublicSample(db,manager,q[5],true),/at most 5/);
  // Topic page: by top-level topic, figures from the whole bank, but only sample questions in full.
  const page=(await getTopicPage(db,exam.family,exam.seo,'labour-ward'))!;
  assert.equal(page.figures.questions,6);assert.equal(page.samples.length,5);assert.deepEqual(page.subtopics.map(s=>s.name),['Postpartum haemorrhage']);
  assert.equal(JSON.stringify(page).includes('Synthetic stem 6'),false);// SEO-6: a paid question never appears
  assert.equal(await getTopicPage(db,exam.family,exam.seo,'pph'),null);// subtopics have no page of their own
  assert.deepEqual((await examTopicLinks(db,exam.id)).map(t=>[t.slug,t.questions,t.samples]),[['labour-ward',6,5]]);
  // Sample page, and the address survives being withdrawn and restored.
  const s=(await getSamplePage(db,exam.family,exam.seo,slug))!;
  assert.equal(s.question.answer,1);assert.deepEqual(s.question.sittings,['September 2026']);assert.equal(s.topicSlug,'labour-ward');assert.equal(s.more.length,4);
  await setPublicSample(db,manager,q[0],false);assert.equal(await getSamplePage(db,exam.family,exam.seo,slug),null);
  assert.equal(await setPublicSample(db,manager,q[0],true),slug);
  // A retired question stops being public even if still marked.
  const retired=(await getStudioQuestion(db,reviewer,q[1]))!;await reviewStudioQuestion(db,manager,q[1],retired.versionId,'retire',false,'');
  assert.equal((await getTopicPage(db,exam.family,exam.seo,'labour-ward'))!.samples.length,4);
  // Blog: drafts are private, publishing needs a summary and body, addresses are unique.
  await assert.rejects(savePost(db,reviewer,{slug:'x',kind:'guide',title:'X',excerpt:'',body:'',examId:null,sittingId:null}),/content manager/);
  const id=await savePost(db,manager,{slug:'',kind:'guide',title:'How to revise for Part 1',excerpt:'',body:'## Plan\n\n- Start early',examId:exam.id,sittingId:null});
  assert.equal(await getPublishedPost(db,'how-to-revise-for-part-1'),null);
  await assert.rejects(setPostStatus(db,manager,id,true),/summary/);
  await savePost(db,manager,{id,slug:'how-to-revise-for-part-1',kind:'guide',title:'How to revise for Part 1',excerpt:'A plan for the last eight weeks.',body:'## Plan\n\n- Start early',examId:exam.id,sittingId:null});
  await setPostStatus(db,manager,id,true);
  assert.equal((await getPublishedPost(db,'how-to-revise-for-part-1'))!.examName,'MRCOG Part 1');
  await assert.rejects(savePost(db,manager,{slug:'how-to-revise-for-part-1',kind:'post',title:'Other',excerpt:'',body:'',examId:null,sittingId:null}),/already uses/);
  // "What came up": figures only, no question text, created once per sitting.
  const report=await draftSittingReport(db,manager,sitting.id);
  assert.equal(await draftSittingReport(db,manager,sitting.id),report);
  const [r]=await db.query<{body:string;status:string;title:string}>('SELECT body,status,title FROM blog_posts WHERE id=$1',[report]);
  assert.equal(r.status,'draft');assert.equal(r.title,'What came up in MRCOG Part 1, September 2026');
  assert.match(r.body,/\*\*Labour ward\*\*: 5 questions/);assert.equal(r.body.includes('Synthetic stem'),false);
  assert.equal((await listPublishedPosts(db)).length,1);
  // Sitemap: the topic page, the live samples and the published post.
  const map=await contentSitemap(db);
  assert.ok(map.includes('/mrcog/part-1-recalls/topics/labour-ward'));assert.equal(map.filter(p=>p.includes('/questions/')).length,4);
  assert.ok(map.includes('/blog'));assert.ok(map.includes('/blog/how-to-revise-for-part-1'));assert.equal(map.some(p=>p.includes('what-came-up')),false);
 } finally {await db.close();}
});
