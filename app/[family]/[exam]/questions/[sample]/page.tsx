import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {examPath,findRedirect} from '@/lib/services/site';
import {getSamplePage,samplePath,topicPath} from '@/lib/services/content-site';
import {pageHeading,pageMetadata,siteUrl,SITE_NAME} from '@/lib/seo';
import {JsonLd,breadcrumbs} from '@/components/seo/json-ld';
import {StickyBuy,TrustBlocks} from '@/components/seo/plans';
import {SampleQuestionBody} from '@/components/public/sample-question';
import {ArrowRight} from '@/components/site/icons';
export const dynamic='force-dynamic';
type Props={params:Promise<{family:string;exam:string;sample:string}>};
const L='ABCDE';
export async function generateMetadata({params}:Props):Promise<Metadata> {
 const {family,exam,sample}=await params;const page=await getSamplePage(getDatabase(),family,exam,sample);
 if(!page)return {title:'Page not found'};
 const q=page.question;
 return pageMetadata(samplePath(page.exam.familySlug,page.exam.seoSlug,q.slug),{title:`${q.stem.slice(0,70).replace(/\s+\S*$/,'')}… — free ${page.exam.name} question | ${SITE_NAME}`,
  description:`A free ${page.exam.name} recall question${q.topic?` on ${q.topic}`:''} with the answer, explanation and key notes.`});
}
// SEO-2 / SEO-5: an indexable free sample question with Quiz structured data. Staff choose every sample.
export default async function SamplePage({params}:Props) {
 const {family,exam,sample}=await params;const db=getDatabase();const page=await getSamplePage(db,family,exam,sample);
 if(!page){const to=await findRedirect(db,`/${family}/${exam}/questions/${sample}`);if(to)permanentRedirect(to);notFound();}
 const e=page.exam,q=page.question,ex=examPath(e.familySlug,e.seoSlug),path=samplePath(e.familySlug,e.seoSlug,q.slug),base=siteUrl();
 const h1=await pageHeading(path,`Free ${e.name} question${q.topic?`: ${q.topic}`:''}`);
 const quiz={'@context':'https://schema.org','@type':'Quiz',name:h1,about:{'@type':'Thing',name:q.topic??e.name},educationalLevel:e.name,url:`${base}${path}`,
  hasPart:[{'@type':'Question',eduQuestionType:'Multiple choice',text:q.stem,
   acceptedAnswer:{'@type':'Answer',text:`${L[q.answer]}. ${q.options[q.answer]}`},suggestedAnswer:q.options.map((o,i)=>i===q.answer?null:{'@type':'Answer',text:`${L[i]}. ${o}`}).filter(Boolean)}]};
 return <main id="main" className="hb has-sticky">
  <JsonLd data={breadcrumbs([{name:'Home',path:'/'},{name:e.familyName,path:`/${e.familySlug}`},{name:e.name,path:ex},...(q.topic&&page.topicSlug?[{name:q.topic,path:topicPath(e.familySlug,e.seoSlug,page.topicSlug)}]:[]),{name:'Sample question',path}],base)}/>
  <JsonLd data={quiz}/>
  <section className="pg-hero" aria-labelledby="sample-title"><div className="wrap">
   <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href={ex}>{e.name}</Link>{q.topic&&page.topicSlug&&<><span aria-hidden="true">/</span><Link href={topicPath(e.familySlug,e.seoSlug,page.topicSlug)}>{q.topic}</Link></>}<span aria-hidden="true">/</span><span aria-current="page">Sample question</span></nav>
   <h1 id="sample-title">{h1}</h1>
   <p className="intro">One of the free questions from the {e.name} bank. Choose an answer to see the explanation and key notes, exactly as in practice.</p>
  </div></section>
  <section className="hb-sec wrap" aria-label="Question"><div className="q-card sample-solo"><SampleQuestionBody data={{where:`${e.name}${q.topic?` · ${q.topic}`:''}`,stem:q.stem,options:q.options,answer:q.answer,why:q.explanation,others:[],notes:q.keyNotes,seen:q.sittings.length?`Seen in ${q.sittings.join(', ')}`:null,highYield:q.highYield}}/></div>
   {q.references.length>0&&<details className="sample-refs"><summary>References</summary><ul>{q.references.map(r=><li key={r}>{r}</li>)}</ul></details>}</section>
  {page.more.length>0&&<section className="hb-sec wrap split" aria-labelledby="more-title"><div className="title"><h2 id="more-title">More free questions</h2></div><ul className="link-rows body">{page.more.map(m=><li key={m.slug}><Link href={samplePath(e.familySlug,e.seoSlug,m.slug)}><strong>{m.stem}{m.stem.length>=140?'…':''}</strong><ArrowRight/></Link></li>)}</ul></section>}
  <TrustBlocks trial={e.trial!==null}/>
  <StickyBuy trial={e.trial!==null} hasPlans={e.plans.length>0} plansHref={`${ex}#plans`}/>
 </main>;
}
