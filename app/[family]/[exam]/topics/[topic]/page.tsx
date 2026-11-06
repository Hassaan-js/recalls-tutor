import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {examPath,findRedirect} from '@/lib/services/site';
import {getTopicPage,samplePath,topicPath} from '@/lib/services/content-site';
import {pageHeading,pageMetadata,siteUrl,SITE_NAME} from '@/lib/seo';
import {JsonLd,breadcrumbs} from '@/components/seo/json-ld';
import {StickyBuy,TrustBlocks} from '@/components/seo/plans';
import {SampleQuestionBody} from '@/components/public/sample-question';
import {ArrowRight} from '@/components/site/icons';
export const dynamic='force-dynamic';
type Props={params:Promise<{family:string;exam:string;topic:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
 const {family,exam,topic}=await params;const page=await getTopicPage(getDatabase(),family,exam,topic);
 if(!page)return {title:'Page not found'};
 return pageMetadata(topicPath(page.exam.familySlug,page.exam.seoSlug,page.topic.slug),{title:`${page.topic.name} recall questions — ${page.exam.name} | ${SITE_NAME}`,
  description:`${page.figures.questions} reviewed ${page.exam.name} recall questions on ${page.topic.name}${page.samples.length?`, with ${page.samples.length} free sample question${page.samples.length===1?'':'s'}`:''}.`});
}
// SEO-2: one page per topic, with up to five free samples chosen by staff. Paid questions are never on this page.
export default async function TopicPage({params}:Props) {
 const {family,exam,topic}=await params;const db=getDatabase();const page=await getTopicPage(db,family,exam,topic);
 if(!page){const to=await findRedirect(db,`/${family}/${exam}/topics/${topic}`);if(to)permanentRedirect(to);notFound();}
 const e=page.exam,t=page.topic,ex=examPath(e.familySlug,e.seoSlug),path=topicPath(e.familySlug,e.seoSlug,t.slug),base=siteUrl();
 const h1=await pageHeading(path,`${t.name}: ${e.name} recall questions`);
 return <main id="main" className="hb has-sticky">
  <JsonLd data={breadcrumbs([{name:'Home',path:'/'},{name:e.familyName,path:`/${e.familySlug}`},{name:e.name,path:ex},{name:t.name,path}],base)}/>
  <section className="pg-hero" aria-labelledby="topic-title"><div className="wrap">
   <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href={`/${e.familySlug}`}>{e.familyName}</Link><span aria-hidden="true">/</span><Link href={ex}>{e.name}</Link><span aria-hidden="true">/</span><span aria-current="page">{t.name}</span></nav>
   <div className="pg-grid"><div><h1 id="topic-title">{h1}</h1>
     <p className="intro">{page.figures.questions} reviewed {page.figures.questions===1?'question':'questions'} on {t.name}, recalled from {page.figures.sittings} {page.figures.sittings===1?'sitting':'sittings'} of {e.name}.{page.figures.highYield?` ${page.figures.highYield} came up in more than one sitting.`:''}</p>
     <div className="actions">{e.trial&&<Link href="/practice" className="hb-btn primary">Start free trial<ArrowRight/></Link>}<Link href={`${ex}#plans`} className={e.trial?'hb-btn plain':'hb-btn primary'}>See {e.name} plans</Link></div></div>
    <aside className="glance" aria-label={`${t.name} at a glance`}><ul className="figures"><li><strong>{page.figures.questions}</strong><span>reviewed questions</span></li><li><strong>{page.figures.highYield}</strong><span>high-yield</span></li><li><strong>{page.samples.length}</strong><span>free samples</span></li></ul></aside></div>
  </div></section>
  {page.samples.length>0&&<section className="hb-sec wrap split" aria-labelledby="samples-title"><div className="title"><h2 id="samples-title">Free sample questions</h2><p>Answer them here, exactly as in practice. Each has its own page you can share.</p></div>
   <div className="body sample-stack">{page.samples.map(q=><div key={q.slug} className="q-card"><SampleQuestionBody data={{where:`${e.name} · ${t.name}`,stem:q.stem,options:q.options,answer:q.answer,why:q.explanation,others:[],notes:q.keyNotes,seen:q.sittings.length?`Seen in ${q.sittings.join(', ')}`:null,highYield:q.highYield}}/>
    <p className="sample-link"><Link className="hb-link" href={samplePath(e.familySlug,e.seoSlug,q.slug)}>Open this question on its own page</Link></p></div>)}</div></section>}
  {page.subtopics.length>0&&<section className="hb-sec wrap split" aria-labelledby="sub-title"><div className="title"><h2 id="sub-title">What it covers</h2></div><ul className="link-rows body">{page.subtopics.map(s=><li key={s.name}><span><strong>{s.name}</strong><span>{s.questions} question{s.questions===1?'':'s'}</span></span></li>)}</ul></section>}
  {page.others.length>0&&<section className="hb-sec wrap split" aria-labelledby="other-title"><div className="title"><h2 id="other-title">Other {e.name} topics</h2></div><ul className="link-rows body">{page.others.map(o=><li key={o.slug}><Link href={topicPath(e.familySlug,e.seoSlug,o.slug)}><strong>{o.name}</strong><ArrowRight/></Link></li>)}</ul></section>}
  <TrustBlocks trial={e.trial!==null}/>
  <StickyBuy trial={e.trial!==null} hasPlans={e.plans.length>0} plansHref={`${ex}#plans`}/>
 </main>;
}
