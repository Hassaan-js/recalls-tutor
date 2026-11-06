import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {getSitePage} from '@/lib/services/site';
import {pageHeading,pageMetadata} from '@/lib/seo';
import {RichText} from './rich-text';
// About, contact and policy pages: text is written by staff in Studio → Website, set in one reading card.
export async function sitePageMetadata(slug:string):Promise<Metadata> {
 const page=await getSitePage(getDatabase(),slug);
 return pageMetadata(`/${slug}`,{title:page?.title??'Recalls Tutor',description:page?page.body.replace(/^##\s.*$/gm,'').replace(/\s+/g,' ').trim().slice(0,155):''});
}
const INTROS:Record<string,string>={about:'Who we are and how every question is made.',contact:'How to reach the Recalls Tutor team.',terms:'The rules for using Recalls Tutor and its questions.',privacy:'What we collect, why we collect it, and your rights.','refund-policy':'When and how you can get your money back.'};
export async function SitePage({slug}:{slug:string}) {
 const page=await getSitePage(getDatabase(),slug);
 if(!page)notFound();
 return <main id="main" className="hb">
  <section className="pg-hero" aria-labelledby="page-title"><div className="wrap"><h1 id="page-title">{await pageHeading(`/${slug}`,page.title)}</h1>{INTROS[slug]&&<p className="intro">{INTROS[slug]}</p>}</div></section>
  <div className="wrap"><article className="prose-card"><RichText text={page.body}/>
  <p className="updated">Last updated {new Date(page.updatedAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}.</p></article></div></main>;
}
