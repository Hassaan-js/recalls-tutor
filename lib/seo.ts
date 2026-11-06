import type {Metadata} from 'next';
import {getDatabase} from './db/client';
import {getPageMeta} from './services/site';
export const SITE_NAME='Recalls Tutor';
export function siteUrl() {return (process.env.NEXT_PUBLIC_SITE_URL||'http://localhost:3000').replace(/\/+$/,'');}
// SEO-4: database-driven defaults, overridden by anything staff set in Studio → Website.
export async function pageMetadata(path:string,defaults:{title:string;description:string},options:{noindex?:boolean}={}):Promise<Metadata> {
 const meta=await getPageMeta(getDatabase(),path);
 const title=meta.title??defaults.title,description=meta.description??defaults.description;
 return {title:{absolute:title.includes(SITE_NAME)?title:`${title} | ${SITE_NAME}`},description,alternates:{canonical:path},
  openGraph:{title,description,url:path,siteName:SITE_NAME,type:'website'},twitter:{card:'summary_large_image',title,description},
  ...(options.noindex?{robots:{index:false}}:{})};
}
export async function pageHeading(path:string,fallback:string) {return (await getPageMeta(getDatabase(),path)).h1??fallback;}
export const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
