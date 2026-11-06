import type {Database} from '../db/client';
import {requireId} from './studio';
import {examPath,getExamPage} from './site';
import {slugify} from './catalogue-admin';
// SEO-2: topic pages, free sample question pages and the blog. Public pages show only questions a content
// manager has marked as a free sample; everything else stays behind sign-in (SEO-6).
export const topicPath=(family:string,exam:string,topic:string)=>`${examPath(family,exam)}/topics/${topic}`;
export const samplePath=(family:string,exam:string,sample:string)=>`${examPath(family,exam)}/questions/${sample}`;
export const postPath=(slug:string)=>`/blog/${slug}`;
const MAX_SAMPLES_PER_TOPIC=5;
async function requireManager(db:Database,actorId:string) {
 const [actor]=await db.query(`SELECT 1 FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.id=$1 AND a.status='active' AND u.email_verified=true AND a.role IN ('content_manager','super_admin') AND (a.role<>'super_admin' OR u.two_factor_enabled=true)`,[actorId]);
 if(!actor)throw new Error('Only a content manager can change public content.');
}
async function audit(db:Database,actorId:string,entityId:string,action:string,after:unknown) {
 await db.query('INSERT INTO audit_log(actor_id,entity_id,action,after_json) VALUES($1,$2,$3,$4::jsonb)',[actorId,entityId,action,JSON.stringify(after)]);
}
export type SampleQuestionData={slug:string;stem:string;options:string[];answer:number;explanation:string;keyNotes:string[];references:string[];sittings:string[];topic:string|null;highYield:boolean};
const SAMPLE_SQL=`SELECT q.sample_slug AS slug,v.stem,v.options,v.correct_answers->>0 AS answer,v.explanation,v.key_notes AS "keyNotes",v.references_json AS "references",
 COALESCE((SELECT array_agg(s.label ORDER BY s.year DESC,s.month DESC NULLS LAST) FROM question_sittings qs JOIN sittings s ON s.id=qs.sitting_id AND s.published WHERE qs.question_id=q.id),'{}') AS sittings,
 COALESCE(p.name,t.name) AS topic,(SELECT count(*) FROM question_sittings qs WHERE qs.question_id=q.id)>=$2::int AS "highYield"
 FROM questions q JOIN question_versions v ON v.id=q.current_version_id LEFT JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id`;
const sample=(r:SampleQuestionData&{answer:unknown})=>({...r,answer:Number(r.answer)});
// ---- Staff: choose free samples ----
export async function setPublicSample(db:Database,actorId:string,questionId:string,on:boolean) {
 requireId(questionId);await requireManager(db,actorId);
 const [q]=await db.query<{status:string;exam_id:string;stem:string;sample_slug:string|null;topic:string|null}>(`SELECT q.status,q.exam_id,v.stem,q.sample_slug,COALESCE(t.parent_id,t.id)::text AS topic FROM questions q JOIN question_versions v ON v.id=q.current_version_id LEFT JOIN topics t ON t.id=q.topic_id WHERE q.id=$1`,[questionId]);
 if(!q)throw new Error('Question not found.');
 if(on&&q.status!=='published')throw new Error('Only published questions can be free samples.');
 if(on&&!q.topic)throw new Error('Tag the question with a topic first, so it appears on that topic’s page.');
 if(on&&(await db.query<{n:number}>(`SELECT count(*)::int AS n FROM questions q JOIN topics t ON t.id=q.topic_id WHERE q.public_sample AND q.id<>$1 AND COALESCE(t.parent_id,t.id)=$2::uuid`,[questionId,q.topic]))[0].n>=MAX_SAMPLES_PER_TOPIC)throw new Error(`A topic shows at most ${MAX_SAMPLES_PER_TOPIC} free samples. Remove one first.`);
 // The address stays the same once given, so a page that ranks keeps its URL even if the sample is withdrawn and returns.
 const slug=q.sample_slug??`${slugify(q.stem.split(/\s+/).slice(0,8).join(' ')).slice(0,60).replace(/-+$/,'')||'question'}-${questionId.slice(0,6)}`;
 await db.query('UPDATE questions SET public_sample=$2,sample_slug=$3,sample_marked_by=$4,sample_marked_at=now() WHERE id=$1',[questionId,on,slug,actorId]);
 await audit(db,actorId,questionId,on?'question.sample_on':'question.sample_off',{slug});
 return slug;
}
// ---- Public pages ----
export async function getTopicPage(db:Database,family:string,examSlug:string,topicSlug:string) {
 const exam=await getExamPage(db,family,examSlug);if(!exam)return null;
 const [topic]=await db.query<{id:string;name:string;slug:string}>('SELECT id,name,slug FROM topics WHERE exam_id=$1 AND slug=$2 AND parent_id IS NULL',[exam.id,topicSlug]);
 if(!topic)return null;
 const hy=2;
 const [figures]=await db.query<{questions:number;highYield:number;sittings:number}>(`SELECT count(*)::int AS questions,count(*) FILTER (WHERE (SELECT count(*) FROM question_sittings qs WHERE qs.question_id=q.id)>=$2)::int AS "highYield",
  (SELECT count(DISTINCT qs.sitting_id)::int FROM question_sittings qs JOIN questions x ON x.id=qs.question_id AND x.status='published' JOIN topics y ON y.id=x.topic_id WHERE COALESCE(y.parent_id,y.id)=$1) AS sittings
  FROM questions q JOIN topics t ON t.id=q.topic_id WHERE q.status='published' AND COALESCE(t.parent_id,t.id)=$1`,[topic.id,hy]);
 if(!figures.questions)return null;// a topic page exists only once it has published questions
 const subtopics=await db.query<{name:string;questions:number}>(`SELECT t.name,count(q.id)::int AS questions FROM topics t JOIN questions q ON q.topic_id=t.id AND q.status='published' WHERE t.parent_id=$1 GROUP BY t.name ORDER BY 2 DESC,1`,[topic.id]);
 const samples=(await db.query<SampleQuestionData&{answer:unknown}>(`${SAMPLE_SQL} WHERE q.public_sample AND q.status='published' AND COALESCE(t.parent_id,t.id)=$1 ORDER BY q.sample_marked_at LIMIT ${MAX_SAMPLES_PER_TOPIC}`,[topic.id,hy])).map(sample);
 const otherSlugs=await db.query<{name:string;slug:string}>(`SELECT t.name,t.slug FROM topics t WHERE t.exam_id=$1 AND t.parent_id IS NULL AND t.id<>$2 AND EXISTS(SELECT 1 FROM questions q JOIN topics c ON c.id=q.topic_id WHERE q.status='published' AND COALESCE(c.parent_id,c.id)=t.id) ORDER BY t.name`,[exam.id,topic.id]);
 return {exam,topic,figures,subtopics,samples,others:otherSlugs};
}
export async function getSamplePage(db:Database,family:string,examSlug:string,sampleSlug:string) {
 const exam=await getExamPage(db,family,examSlug);if(!exam)return null;
 const [row]=await db.query<SampleQuestionData&{answer:unknown;topicSlug:string|null}>(`${SAMPLE_SQL.replace('COALESCE(p.name,t.name) AS topic,','COALESCE(p.name,t.name) AS topic,COALESCE(p.slug,t.slug) AS "topicSlug",')} WHERE q.exam_id=$1 AND q.sample_slug=$3 AND q.public_sample AND q.status='published'`,[exam.id,2,sampleSlug]);
 if(!row)return null;
 const more=await db.query<{slug:string;stem:string}>(`SELECT q.sample_slug AS slug,left(v.stem,140) AS stem FROM questions q JOIN question_versions v ON v.id=q.current_version_id WHERE q.exam_id=$1 AND q.public_sample AND q.status='published' AND q.sample_slug<>$2 ORDER BY q.sample_marked_at DESC LIMIT 4`,[exam.id,sampleSlug]);
 return {exam,question:sample(row),topicSlug:row.topicSlug,more};
}
export async function examTopicLinks(db:Database,examId:string) {
 return db.query<{name:string;slug:string;questions:number;samples:number}>(`SELECT t.name,t.slug,count(q.id)::int AS questions,count(q.id) FILTER (WHERE q.public_sample)::int AS samples FROM topics t JOIN topics c ON COALESCE(c.parent_id,c.id)=t.id JOIN questions q ON q.topic_id=c.id AND q.status='published'
  WHERE t.exam_id=$1 AND t.parent_id IS NULL GROUP BY t.name,t.slug ORDER BY 3 DESC,1`,[examId]);
}
// ---- Blog ----
export type Post={id:string;slug:string;kind:string;title:string;excerpt:string;body:string;examId:string|null;sittingId:string|null;status:string;publishedAt:string|null;updatedAt:string;examName:string|null;author:string|null};
const POST_SQL=`SELECT b.id,b.slug,b.kind,b.title,b.excerpt,b.body,b.exam_id AS "examId",b.sitting_id AS "sittingId",b.status,b.published_at::text AS "publishedAt",b.updated_at::text AS "updatedAt",e.name AS "examName",u.name AS author
 FROM blog_posts b LEFT JOIN exams e ON e.id=b.exam_id LEFT JOIN app_users a ON a.id=b.author_id LEFT JOIN auth_users u ON u.id=a.auth_id`;
export async function listPublishedPosts(db:Database,limit=50) {return db.query<Post>(`${POST_SQL} WHERE b.status='published' ORDER BY b.published_at DESC LIMIT $1`,[limit]);}
export async function getPublishedPost(db:Database,slug:string) {const [p]=await db.query<Post>(`${POST_SQL} WHERE b.slug=$1 AND b.status='published'`,[slug]);return p??null;}
export async function listPostsAdmin(db:Database,actorId:string) {await requireManager(db,actorId);return db.query<Post>(`${POST_SQL} ORDER BY b.status,b.updated_at DESC LIMIT 200`);}
export async function savePost(db:Database,actorId:string,input:{id?:string|null;slug:string;kind:string;title:string;excerpt:string;body:string;examId:string|null;sittingId:string|null}) {
 await requireManager(db,actorId);
 const slug=slugify(input.slug||input.title),title=input.title.trim(),excerpt=input.excerpt.trim(),body=input.body.replace(/\r\n/g,'\n').trim();
 if(!title||title.length>160)throw new Error('Give the post a title of up to 160 characters.');
 if(!slug)throw new Error('Give the post an address, for example how-to-pass-part-1.');
 if(excerpt.length>300)throw new Error('Keep the summary under 300 characters.');
 if(body.length>60000)throw new Error('The post is too long (60,000 characters at most).');
 if(!['post','guide','sitting_report'].includes(input.kind))throw new Error('Choose the kind of post.');
 if(input.examId)requireId(input.examId);if(input.sittingId)requireId(input.sittingId);
 if(input.sittingId&&!(await db.query('SELECT 1 FROM sittings WHERE id=$1 AND ($2::uuid IS NULL OR exam_id=$2)',[input.sittingId,input.examId])).length)throw new Error('Choose a sitting from the selected exam.');
 if((await db.query('SELECT 1 FROM blog_posts WHERE slug=$1 AND ($2::uuid IS NULL OR id<>$2)',[slug,input.id??null])).length)throw new Error('Another post already uses this address.');
 const values=[slug,input.kind,title,excerpt,body,input.examId,input.sittingId,actorId];
 const [row]=input.id?await db.query<{id:string}>(`UPDATE blog_posts SET slug=$1,kind=$2,title=$3,excerpt=$4,body=$5,exam_id=$6,sitting_id=$7,author_id=COALESCE(author_id,$8::uuid),updated_at=now() WHERE id=$9 RETURNING id`,[...values,input.id])
  :await db.query<{id:string}>(`INSERT INTO blog_posts(slug,kind,title,excerpt,body,exam_id,sitting_id,author_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,values);
 if(!row)throw new Error('Post not found.');
 await audit(db,actorId,row.id,'blog.saved',{slug,title});
 return row.id;
}
export async function setPostStatus(db:Database,actorId:string,id:string,publish:boolean) {
 requireId(id);await requireManager(db,actorId);
 const [p]=await db.query<{body:string;excerpt:string}>('SELECT body,excerpt FROM blog_posts WHERE id=$1',[id]);
 if(!p)throw new Error('Post not found.');
 if(publish&&(!p.body.trim()||!p.excerpt.trim()))throw new Error('Add a summary and the body before publishing.');
 await db.query(`UPDATE blog_posts SET status=$2,published_at=CASE WHEN $2='published' THEN COALESCE(published_at,now()) ELSE published_at END,updated_at=now() WHERE id=$1`,[id,publish?'published':'draft']);
 await audit(db,actorId,id,publish?'blog.published':'blog.unpublished',{});
}
// "What came up in {exam} {sitting}": a draft built only from the catalogue's own figures, never question text.
// Staff add the commentary before publishing.
export async function draftSittingReport(db:Database,actorId:string,sittingId:string) {
 requireId(sittingId);await requireManager(db,actorId);
 const [s]=await db.query<{id:string;label:string;exam_id:string;exam:string;slug:string;family:string;seo:string}>(`SELECT s.id,s.label,s.exam_id,e.name AS exam,s.slug,f.slug AS family,e.seo_slug AS seo FROM sittings s JOIN exams e ON e.id=s.exam_id JOIN exam_families f ON f.id=e.family_id WHERE s.id=$1 AND s.published`,[sittingId]);
 if(!s)throw new Error('Publish the sitting before writing its report.');
 const [existing]=await db.query<{id:string}>(`SELECT id FROM blog_posts WHERE kind='sitting_report' AND sitting_id=$1`,[sittingId]);
 if(existing)return existing.id;
 const topics=await db.query<{name:string;n:number}>(`SELECT COALESCE(p.name,t.name,'Other') AS name,count(*)::int AS n FROM question_sittings qs JOIN questions q ON q.id=qs.question_id AND q.status='published' LEFT JOIN topics t ON t.id=q.topic_id LEFT JOIN topics p ON p.id=t.parent_id WHERE qs.sitting_id=$1 GROUP BY 1 ORDER BY 2 DESC,1`,[sittingId]);
 const [{total,repeats}]=await db.query<{total:number;repeats:number}>(`SELECT count(*)::int AS total,count(*) FILTER (WHERE (SELECT count(*) FROM question_sittings o WHERE o.question_id=qs.question_id)>1)::int AS repeats FROM question_sittings qs JOIN questions q ON q.id=qs.question_id AND q.status='published' WHERE qs.sitting_id=$1`,[sittingId]);
 const body=[`## The sitting at a glance`,``,`We have ${total} reviewed question${total===1?'':'s'} recalled from ${s.exam}, ${s.label}. ${repeats} of them had also come up in an earlier sitting.`,``,
  `## Topics that came up`,``,...topics.map(t=>`- **${t.name}**: ${t.n} question${t.n===1?'':'s'}`),``,
  `## What this means for your revision`,``,`[Write the commentary here before publishing: patterns, surprises and what to prioritise. Do not quote questions.]`,``,
  `Practise every ${s.label} question on the [${s.label} page](${examPath(s.family,s.seo)}/${s.slug}).`].join('\n');
 return savePost(db,actorId,{slug:`what-came-up-${slugify(s.exam)}-${s.slug}`,kind:'sitting_report',title:`What came up in ${s.exam}, ${s.label}`,excerpt:`The topics that appeared in ${s.exam}, ${s.label}, from ${total} reviewed recalls.`,body,examId:s.exam_id,sittingId});
}
export async function contentSitemap(db:Database) {
 const topics=await db.query<{family:string;exam:string;topic:string}>(`SELECT DISTINCT f.slug AS family,e.seo_slug AS exam,t.slug AS topic FROM topics t JOIN exams e ON e.id=t.exam_id JOIN exam_families f ON f.id=e.family_id
  WHERE t.parent_id IS NULL AND EXISTS(SELECT 1 FROM questions q JOIN topics c ON c.id=q.topic_id WHERE q.status='published' AND COALESCE(c.parent_id,c.id)=t.id)`);
 const samples=await db.query<{family:string;exam:string;slug:string}>(`SELECT f.slug AS family,e.seo_slug AS exam,q.sample_slug AS slug FROM questions q JOIN exams e ON e.id=q.exam_id JOIN exam_families f ON f.id=e.family_id WHERE q.public_sample AND q.status='published'`);
 const posts=await db.query<{slug:string}>(`SELECT slug FROM blog_posts WHERE status='published'`);
 return [...topics.map(t=>topicPath(t.family,t.exam,t.topic)),...samples.map(s=>samplePath(s.family,s.exam,s.slug)),...(posts.length?['/blog']:[]),...posts.map(p=>postPath(p.slug))];
}
