import type {Metadata} from 'next';
import Link from 'next/link';
import {getDatabase} from '@/lib/db/client';
import {listFaqs} from '@/lib/services/site';
import {pageHeading,pageMetadata} from '@/lib/seo';
import {JsonLd,faqSchema} from '@/components/seo/json-ld';
import {Plus} from '@/components/site/icons';
import {SampleQuestion} from '@/components/public/sample-question';
export const dynamic='force-dynamic';
export function generateMetadata():Promise<Metadata> {return pageMetadata('/faq',{title:'Frequently asked questions',description:'How Recalls Tutor turns exam recalls into reviewed practice questions, how plans and free trials work, and what “Seen in” and high-yield mean.'});}
export default async function FaqPage() {
 const faqs=await listFaqs(getDatabase(),null);
 return <main id="main" className="hb">{faqs.length>0&&<JsonLd data={faqSchema(faqs)}/>}
  <section className="pg-hero" aria-labelledby="faq-title"><div className="wrap"><h1 id="faq-title">{await pageHeading('/faq','Questions about Recalls Tutor')}</h1>
   <p className="intro">How recalls become reviewed questions, what “Seen in” and high-yield mean, and how plans, renewals and the free trial work.</p></div></section>
  <section className="hb-sec wrap split" aria-label="Questions and answers"><div className="title"><h2>Answers</h2><p>Still unsure? <Link className="hb-link" href="/contact">Contact us</Link>.</p></div>
   <div className="body">{faqs.length?<div className="faq">{faqs.map((f,i)=><details key={f.id} open={i===0}><summary>{f.question}<Plus /></summary><p>{f.answer}</p></details>)}</div>:<p>Answers to common questions will appear here.</p>}</div></section>
  <section className="hb-sec wrap split" aria-labelledby="sample-title"><div className="title"><h2 id="sample-title">What a question looks like</h2><p>Answer it to see the explanation and key notes, exactly as in practice.</p></div><div className="body"><SampleQuestion /></div></section>
 </main>;
}
