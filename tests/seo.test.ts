import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {seedSiteContent} from '../lib/db/seed-site';
import {createSitting,createTopic,updateExamSettings,updateSitting} from '../lib/services/catalogue-admin';
import {createRecall,getStudioQuestion,reviewStudioQuestion,saveStudioDraft,setQuestionTags} from '../lib/services/studio';
import {addFaq,addRedirect,deleteFaq,examPath,findRedirect,getExamPage,getFamilyPage,getPageMeta,getSitePage,getSittingPage,getWebsiteAdmin,listFaqs,planDisplay,savePageMeta,saveSitePage,sitemapEntries} from '../lib/services/site';
import {JsonLd} from '../components/seo/json-ld';
import {RichText} from '../components/seo/rich-text';
test('SEO helpers: plan maths, safe structured data and safe page text',()=>{
 const plans=planDisplay([{id:'c',months:12,priceCents:14400},{id:'a',months:3,priceCents:6000},{id:'b',months:6,priceCents:9000}]);
 assert.deepEqual(plans.map(p=>[p.months,p.perMonthCents,p.savingsPercent,p.highlighted]),[[3,2000,null,false],[6,1500,25,true],[12,1200,40,false]]);
 assert.deepEqual(planDisplay([]),[]);
 const ld=renderToStaticMarkup(createElement(JsonLd,{data:{name:'</script><script>alert(1)</script>'}}));
 assert.equal((ld.match(/<\/script>/g)??[]).length,1);assert.ok(!ld.includes('<script>alert'));
 const html=renderToStaticMarkup(createElement(RichText,{text:'## Heading\n\nA <img src=x onerror=alert(1)> paragraph\n\n- one\n- two'}));
 const policy=renderToStaticMarkup(createElement(RichText,{text:['## Your account','- Personal subscription','- No sharing','','## Plans','Plans renew automatically.'].join('\n')}));
 assert.equal(policy,'<h2>Your account</h2><ul><li>Personal subscription</li><li>No sharing</li></ul><h2>Plans</h2><p>Plans renew automatically.</p>');
 assert.ok(!html.includes('<img'));assert.match(html,/<h2>Heading<\/h2>/);assert.match(html,/<ul><li>one<\/li><li>two<\/li><\/ul>/);
});
test('Public exam, sitting and policy pages never expose paid content; staff edit SEO, FAQs and redirects',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);await seedCatalogue(db);await seedSiteContent(db);
  async function actor(role:string) {const authId=randomUUID();await db.query('INSERT INTO auth_users(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',[authId,role,`${authId}@example.test`]);return (await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[authId,role]))[0].id;}
  const manager=await actor('content_manager'),reviewer=await actor('reviewer');
  const [exam]=await db.query<{id:string}>("SELECT id FROM exams WHERE slug='mrcog-part-1'");
  // Canonical URL structure from PRD SEO-1.
  assert.equal(examPath('mrcog','part-1-recalls'),'/mrcog/part-1-recalls');
  const page0=(await getExamPage(db,'mrcog','part-1-recalls'))!;
  assert.equal(page0.name,'MRCOG Part 1');assert.equal(page0.plans.length,0);assert.equal(page0.trial,null);assert.deepEqual(page0.format,{questions:null,minutes:null,passMark:null});
  assert.equal(await getExamPage(db,'mrcog','part-9-recalls'),null);assert.equal(await getExamPage(db,'amc','part-1-recalls')!==null,true);
  assert.deepEqual((await getFamilyPage(db,'mrcog'))!.exams.map(e=>e.seoSlug),['part-1-recalls','part-2-recalls']);
  // A published question with distinctive private text, linked to a published sitting and a topic.
  const secret={stem:'ZEBRA-STEM-7731 paid question body',option:'QUOKKA-OPTION-1842',explanation:'NARWHAL-EXPLANATION-5520',source:'OKAPI-SOURCE-9904'};
  const sept=await createSitting(db,manager,{examId:exam.id,year:2026,month:9,label:''}),mar=await createSitting(db,manager,{examId:exam.id,year:2025,month:3,label:''});
  await updateSitting(db,manager,sept,{published:true});
  const topic=await createTopic(db,manager,{examId:exam.id,name:'Obstetrics',parentId:null});
  const id=await createRecall(db,manager,{examId:exam.id,sourceLabel:'Private source',sourceText:secret.source,requestId:randomUUID()});
  const first=(await getStudioQuestion(db,reviewer,id))!;
  const v=await saveStudioDraft(db,reviewer,id,first.versionId,{stem:secret.stem,options:[secret.option,'B','C','D','E'],correctAnswer:0,explanation:secret.explanation,references:['Ref']});
  await reviewStudioQuestion(db,reviewer,id,v,'submit_review',false,'');await reviewStudioQuestion(db,reviewer,id,v,'approve',true,'');await reviewStudioQuestion(db,manager,id,v,'publish',false,'');
  await setQuestionTags(db,reviewer,id,{topicId:topic,difficulty:'easy',sittingIds:[sept,mar]});
  await createRecall(db,manager,{examId:exam.id,sourceLabel:'Draft',sourceText:'DRAFT-ONLY-TEXT',requestId:randomUUID()});
  const page=(await getExamPage(db,'mrcog','part-1-recalls'))!;
  assert.equal(page.questionCount,1);assert.equal(page.highYield,1);assert.deepEqual(page.sittings.map(s=>[s.label,s.questions]),[['September 2026',1]]);// unpublished March sitting hidden
  assert.deepEqual(page.topics,[{name:'Obstetrics',questions:1}]);
  const sitting=(await getSittingPage(db,'mrcog','part-1-recalls','september-2026'))!;
  assert.equal(sitting.sitting.questions,1);assert.equal(sitting.repeats,1);assert.deepEqual(sitting.topics,[{name:'Obstetrics',questions:1}]);
  assert.equal(await getSittingPage(db,'mrcog','part-1-recalls','march-2025'),null);
  const sitemap=await sitemapEntries(db);
  assert.ok(sitemap.includes('/mrcog/part-1-recalls/september-2026'));assert.ok(!sitemap.includes('/mrcog/part-1-recalls/march-2025'));assert.ok(sitemap.includes('/amc'));
  // SEO-6: nothing paid or private appears in any public payload.
  const publicPayload=JSON.stringify([page,sitting,await getFamilyPage(db,'mrcog'),sitemap,await listFaqs(db,exam.id),await getSitePage(db,'terms')]);
  for(const value of [...Object.values(secret),'DRAFT-ONLY-TEXT'])assert.ok(!publicPayload.includes(value),`public payload leaked ${value}`);
  // Trial and exam format appear only once configured; plans show only real prices.
  await db.query(`INSERT INTO plans(exam_id,months,price_cents,active) VALUES($1,3,6000,true),($1,6,9000,true),($1,12,14400,false)`,[exam.id]);
  await updateExamSettings(db,manager,exam.id,{questionCount:'100',durationMinutes:'150',passMarkPercent:'',highYieldMin:'',needsExpertBelow:'',approvedSources:[],styleNotes:''});
  const priced=(await getExamPage(db,'mrcog','part-1-recalls'))!;
  assert.deepEqual(priced.plans.map(p=>[p.months,p.highlighted,p.savingsPercent]),[[3,false,null],[6,true,25]]);assert.deepEqual(priced.format,{questions:100,minutes:150,passMark:null});
  // Seeded drafts are marked for legal review, and re-seeding never overwrites staff edits.
  assert.match((await getSitePage(db,'terms'))!.body,/draft awaiting legal review/);assert.match((await getSitePage(db,'about'))!.body,/not affiliated with/);
  await assert.rejects(saveSitePage(db,reviewer,{slug:'terms',title:'x',body:'y'}),/content manager/);
  await saveSitePage(db,manager,{slug:'terms',title:'Terms of use',body:'Edited terms'});await seedSiteContent(db);
  assert.equal((await getSitePage(db,'terms'))!.body,'Edited terms');
  const generalFaqs=(await listFaqs(db,null)).length;assert.ok(generalFaqs>=5);
  // Old default wording about where recalls come from is corrected on re-seed; edited text is not.
  await db.query("UPDATE faqs SET answer='No. Questions are reconstructed from candidates’ recollections and written in our own words. Extra.' WHERE question='Are these official exam questions?'");
  await seedSiteContent(db);
  assert.match((await listFaqs(db,null)).find(f=>f.question==='Are these official exam questions?')!.answer,/^No\. They are compiled from questions students shared after their exams.* Extra\.$/);
  assert.equal((await getSitePage(db,'terms'))!.body,'Edited terms');
  // Page meta overrides with length limits; clearing every field restores defaults.
  await assert.rejects(savePageMeta(db,manager,{path:'/mrcog/part-1-recalls',title:'x'.repeat(71),description:'',h1:''}),/70 characters/);
  await assert.rejects(savePageMeta(db,reviewer,{path:'/faq',title:'x',description:'',h1:''}),/content manager/);
  await savePageMeta(db,manager,{path:'/mrcog/part-1-recalls/',title:'MRCOG Part 1 Recalls 2026',description:'Custom description',h1:'Custom heading'});
  assert.deepEqual(await getPageMeta(db,'/mrcog/part-1-recalls'),{title:'MRCOG Part 1 Recalls 2026',description:'Custom description',h1:'Custom heading'});
  await savePageMeta(db,manager,{path:'/mrcog/part-1-recalls',title:'',description:'',h1:''});
  assert.deepEqual(await getPageMeta(db,'/mrcog/part-1-recalls'),{title:null,description:null,h1:null});
  // FAQs: general ones appear everywhere, exam ones only on that exam.
  await addFaq(db,manager,{examId:exam.id,question:'How many papers per sitting?',answer:'Synthetic answer.'});
  assert.equal((await listFaqs(db,exam.id)).length,generalFaqs+1);assert.equal((await listFaqs(db,null)).length,generalFaqs);
  const faq=(await listFaqs(db,exam.id)).find(f=>f.examId===exam.id)!;await deleteFaq(db,manager,faq.id);
  // Redirect manager.
  await assert.rejects(addRedirect(db,manager,{from:'not-a-path',to:'/x'}),/old address/);
  await assert.rejects(addRedirect(db,manager,{from:'/a',to:'https://evil.example'}),/new address/);
  await assert.rejects(addRedirect(db,manager,{from:'/same',to:'/same'}),/itself/);
  await addRedirect(db,manager,{from:'/mrcog/part-one',to:'/mrcog/part-1-recalls'});
  await assert.rejects(addRedirect(db,manager,{from:'/older',to:'/mrcog/part-one'}),/itself redirected/);
  assert.equal(await findRedirect(db,'/MRCOG/part-one/'),'/mrcog/part-1-recalls');assert.equal(await findRedirect(db,'/nothing'),null);
  const admin=await getWebsiteAdmin(db,manager);
  assert.ok(admin.pages.some(p=>p.path==='/mrcog/part-1-recalls/september-2026'));assert.equal(admin.redirects.length,1);assert.equal(admin.sitePages.length,5);
  await assert.rejects(getWebsiteAdmin(db,reviewer),/content manager/);
 }finally{await db.close();}
});
