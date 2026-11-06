import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {examPath,findRedirect,getExamPage,sittingPath} from '@/lib/services/site';
import {couponPreview} from '@/lib/services/coupons';
import {examTopicLinks,topicPath} from '@/lib/services/content-site';
import {pageHeading,pageMetadata,siteUrl,SITE_NAME} from '@/lib/seo';
import {JsonLd,breadcrumbs,faqSchema} from '@/components/seo/json-ld';
import {PlanSelector,StickyBuy,TrustBlocks} from '@/components/seo/plans';
import {SampleQuestion} from '@/components/public/sample-question';
import {ArrowRight,Plus} from '@/components/site/icons';
export const dynamic='force-dynamic';
type Props={params:Promise<{family:string;exam:string}>;searchParams?:Promise<Record<string,string|string[]|undefined>>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
 const {family,exam}=await params;const page=await getExamPage(getDatabase(),family,exam);
 if(!page)return {title:'Page not found'};
 const latest=page.sittings[0]?.label;
 return pageMetadata(examPath(page.familySlug,page.seoSlug),{title:`${page.name} Recalls${latest?` — ${latest}`:''} | ${SITE_NAME}`,description:`${page.name} recall questions from real exam sittings${latest?`, including ${latest}`:''}. Reviewed explanations, references, high-yield tags and timed papers.`});
}
// The exam page: its name, figures and actions first, then a sample, plans, sittings, topics and answers, each as a titled split.
export default async function ExamPage({params,searchParams}:Props) {
 const {family,exam}=await params;const db=getDatabase();const page=await getExamPage(db,family,exam);
 if(!page){const to=await findRedirect(db,`/${family}/${exam}`);if(to)permanentRedirect(to);notFound();}
 // BILL-6: ?code= from a campaign or an emailed offer, and ?from= when the student came from a sitting page.
 const query=(await searchParams)??{};const one=(v:unknown)=>typeof v==='string'?v.slice(0,80):'';
 const preview=one(query.code)?await couponPreview(db,page.id,one(query.code)):null;
 const topicLinks=await examTopicLinks(db,page.id);
 const fromSitting=page.sittings.some(s=>s.slug===one(query.from))?one(query.from):'';
 const path=examPath(page.familySlug,page.seoSlug),base=siteUrl(),h1=await pageHeading(path,`${page.name} recalls`);
 const product=page.plans.length?{'@context':'https://schema.org','@type':'Product',name:`${page.name} recall question bank`,description:page.description,brand:{'@type':'Brand',name:SITE_NAME},url:`${base}${path}`,
  offers:page.plans.map(p=>({'@type':'Offer',name:`${p.months}-month plan`,price:(p.priceCents/100).toFixed(2),priceCurrency:'USD',availability:'https://schema.org/PreOrder',url:`${base}${path}#plans`}))}:null;
 return <main id="main" className="hb has-sticky">
  <JsonLd data={breadcrumbs([{name:'Home',path:'/'},{name:page.familyName,path:`/${page.familySlug}`},{name:page.name,path}],base)}/>
  {product&&<JsonLd data={product}/>}{page.faqs.length>0&&<JsonLd data={faqSchema(page.faqs)}/>}
  <section className="pg-hero" aria-labelledby="exam-title"><div className="wrap">
   <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href={`/${page.familySlug}`}>{page.familyName}</Link><span aria-hidden="true">/</span><span aria-current="page">{page.name}</span></nav>
   <div className="pg-grid"><div><h1 id="exam-title">{h1}</h1><p className="intro">{page.description} Practise with questions students shared after their exams, compiled by our team and reviewed before they are published.</p>
     <div className="actions">{page.trial&&<Link href="/practice" className="hb-btn primary">Start free trial<ArrowRight /></Link>}<a href="#plans" className={page.trial?'hb-btn plain':'hb-btn primary'}>See plans</a></div>
     {page.trial&&<p className="note">Free trial: {page.trial.days} days or {page.trial.questionLimit} questions, whichever comes first. No card needed.</p>}</div>
    <aside className="glance" aria-label={`${page.name} at a glance`}>{page.questionCount>0?<ul className="figures"><li><strong>{page.questionCount}</strong><span>reviewed questions</span></li><li><strong>{page.sittings.length}</strong><span>sittings covered</span></li><li><strong>{page.highYield}</strong><span>high-yield</span></li></ul>
     :<div className="glance-empty"><strong>In preparation</strong><p>Questions appear here once a reviewer has approved them.</p></div>}</aside></div>
  </div></section>
  <section className="hb-sec wrap split" aria-labelledby="sample-title"><div className="title"><h2 id="sample-title">Try a question</h2><p>Every question comes with the sittings it was recalled in, the answer, why each other option is wrong, and the key notes.</p></div><div className="body"><SampleQuestion /></div></section>
  <section className="hb-sec wrap split" id="plans" aria-labelledby="plans-title"><div className="title"><h2 id="plans-title">Plans</h2><p>One exam, every sitting, including the ones added while your plan is active.</p></div>
   <div className="body"><PlanSelector plans={page.plans} examName={page.name} trial={page.trial} checkoutEnabled={Boolean(process.env.STRIPE_SECRET_KEY)} returnPath={`${path}${preview?.valid||fromSitting?`?${[preview?.valid?`code=${preview.code}`:"",fromSitting?`from=${fromSitting}`:""].filter(Boolean).join("&")}`:""}#plans`} promo={preview} fromSitting={fromSitting}/></div></section>
  <section className="hb-sec wrap split" aria-labelledby="sittings-title"><div className="title"><h2 id="sittings-title">Sittings</h2><p>Every sitting has its own page with what came up. Past sittings stay available.</p></div>
   <div className="body">{page.sittings.length?<ul className="link-rows">{page.sittings.map(s=><li key={s.id}><Link href={sittingPath(page.familySlug,page.seoSlug,s.slug)}><strong>{s.label}</strong><span>{s.questions} question{s.questions===1?'':'s'}</span><ArrowRight /></Link></li>)}</ul>:<div className="plan-pending"><h3>Sittings to be confirmed</h3><p>Each exam sitting gets its own page as soon as its recalls are reviewed.</p></div>}</div></section>
  {topicLinks.length>0&&<section className="hb-sec wrap split" aria-labelledby="topics-title"><div className="title"><h2 id="topics-title">Topics</h2><p>Where the reviewed questions sit, by topic. Each topic page has free sample questions where staff have chosen them.</p></div><ul className="topic-chips body">{topicLinks.map(t=><li key={t.slug}><Link href={topicPath(page.familySlug,page.seoSlug,t.slug)}>{t.name}<small>{t.questions}</small></Link></li>)}</ul></section>}
  <section className="hb-sec wrap split" aria-labelledby="why-title"><div className="title"><h2 id="why-title">Why recalls</h2>{(page.format.questions||page.format.minutes)?<p>Timed papers follow the real exam: {[page.format.questions&&`${page.format.questions} questions`,page.format.minutes&&`${page.format.minutes} minutes`].filter(Boolean).join(' in ')}{page.format.passMark?`, with results against a ${page.format.passMark}% pass mark`:''}.</p>:<p>Practise the questions students shared after recent sittings.</p>}</div><div className="body"><TrustBlocks trial={page.trial!==null}/></div></section>
  {page.faqs.length>0&&<section className="hb-sec wrap split" aria-labelledby="faq-title"><div className="title"><h2 id="faq-title">Questions</h2><p><Link href="/faq" className="hb-link">All questions and answers<ArrowRight /></Link></p></div><div className="faq body">{page.faqs.map(f=><details key={f.id}><summary>{f.question}<Plus /></summary><p>{f.answer}</p></details>)}</div></section>}
  <p className="disclaimer wrap">{SITE_NAME} is independent and is not affiliated with or endorsed by any exam body. Recall questions are shared by students in study groups and communities after their exams, then collected and compiled by our team. They are not official exam questions.</p>
  <StickyBuy trial={page.trial!==null} hasPlans={page.plans.length>0}/>
 </main>;
}
