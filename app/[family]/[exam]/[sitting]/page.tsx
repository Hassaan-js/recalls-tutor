import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {examPath,findRedirect,getSittingPage,sittingPath} from '@/lib/services/site';
import {pageHeading,pageMetadata,siteUrl,SITE_NAME} from '@/lib/seo';
import {JsonLd,breadcrumbs} from '@/components/seo/json-ld';
import {StickyBuy,TrustBlocks} from '@/components/seo/plans';
import {SampleQuestion} from '@/components/public/sample-question';
import {ArrowRight} from '@/components/site/icons';
export const dynamic='force-dynamic';
type Props={params:Promise<{family:string;exam:string;sitting:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
 const {family,exam,sitting}=await params;const page=await getSittingPage(getDatabase(),family,exam,sitting);
 if(!page)return {title:'Page not found'};
 return pageMetadata(sittingPath(page.exam.familySlug,page.exam.seoSlug,page.sitting.slug),{title:`${page.exam.name} Recalls — ${page.sitting.label} | ${SITE_NAME}`,description:`What came up in ${page.exam.name}, ${page.sitting.label}: ${page.sitting.questions} reviewed recall questions with explanations, references and topic tags.`});
}
export default async function SittingPage({params}:Props) {
 const {family,exam,sitting}=await params;const db=getDatabase();const page=await getSittingPage(db,family,exam,sitting);
 if(!page){const to=await findRedirect(db,`/${family}/${exam}/${sitting}`);if(to)permanentRedirect(to);notFound();}
 const e=page.exam,s=page.sitting,path=sittingPath(e.familySlug,e.seoSlug,s.slug),base=siteUrl(),exPath=examPath(e.familySlug,e.seoSlug);
 const h1=await pageHeading(path,`${e.name}: ${s.label}`);
 return <main id="main" className="hb has-sticky">
  <JsonLd data={breadcrumbs([{name:'Home',path:'/'},{name:e.familyName,path:`/${e.familySlug}`},{name:e.name,path:exPath},{name:s.label,path}],base)}/>
  <section className="pg-hero" aria-labelledby="sitting-title"><div className="wrap">
   <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href={`/${e.familySlug}`}>{e.familyName}</Link><span aria-hidden="true">/</span><Link href={exPath}>{e.name}</Link><span aria-hidden="true">/</span><span aria-current="page">{s.label}</span></nav>
   <div className="pg-grid"><div><h1 id="sitting-title">{h1}</h1>
     <p className="intro">{s.questions?`${s.questions} reviewed question${s.questions===1?'':'s'} compiled from what students shared after the ${s.label} sitting.`:`Recalls from the ${s.label} sitting are being reviewed. Questions appear here once a reviewer has approved them.`}</p>
     <div className="actions">{e.trial&&<Link href="/practice" className="hb-btn primary">Start free trial<ArrowRight /></Link>}<Link href={`${exPath}?from=${s.slug}#plans`} className={e.trial?'hb-btn plain':'hb-btn primary'}>See {e.name} plans</Link></div></div>
    <aside className="glance" aria-label={`${s.label} at a glance`}>{s.questions>0?<ul className="figures"><li><strong>{s.questions}</strong><span>questions</span></li><li><strong>{page.repeats}</strong><span>also in other sittings</span></li><li><strong>{page.topics.length}</strong><span>topics</span></li></ul>
     :<div className="glance-empty"><strong>Under review</strong><p>Questions appear here once a reviewer has approved them.</p></div>}</aside></div>
  </div></section>
  {page.topics.length>0&&<section className="hb-sec wrap split" aria-labelledby="topics-title"><div className="title"><h2 id="topics-title">What came up</h2><p>Topics in this sitting, by number of reviewed questions.</p></div><ul className="topic-chips body">{page.topics.map(t=><li key={t.name}>{t.name}<small>{t.questions}</small></li>)}</ul></section>}
  <section className="hb-sec wrap split" aria-labelledby="sample-title"><div className="title"><h2 id="sample-title">Try a question</h2><p>Answer it to see the explanation, the key notes and where it came from.</p></div><div className="body"><SampleQuestion /></div></section>
  <section className="hb-sec wrap split" aria-labelledby="why-title"><div className="title"><h2 id="why-title">How it works</h2><p>Every question names the sittings it came from, so repeats stand out.</p></div><div className="body"><TrustBlocks trial={e.trial!==null}/></div></section>
  {e.sittings.length>1&&<section className="hb-sec wrap split" aria-labelledby="more-title"><div className="title"><h2 id="more-title">Other sittings</h2></div><ul className="link-rows body">{e.sittings.filter(o=>o.id!==s.id).map(o=><li key={o.id}><Link href={sittingPath(e.familySlug,e.seoSlug,o.slug)}><strong>{o.label}</strong><span>{o.questions} question{o.questions===1?'':'s'}</span><ArrowRight /></Link></li>)}</ul></section>}
  <p className="disclaimer wrap">{SITE_NAME} is independent and is not affiliated with or endorsed by any exam body. Recall questions are shared by students in study groups and communities after their exams, then collected and compiled by our team. They are not official exam questions.</p>
  <StickyBuy trial={e.trial!==null} hasPlans={e.plans.length>0} plansHref={`${exPath}?from=${s.slug}#plans`}/>
 </main>;
}
