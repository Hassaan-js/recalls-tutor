import type {MetadataRoute} from 'next';
import {getDatabase} from '@/lib/db/client';
import {sitemapEntries} from '@/lib/services/site';
import {contentSitemap} from '@/lib/services/content-site';
import {siteUrl} from '@/lib/seo';
// SEO-4: generated from the database at request time, so a newly published sitting appears immediately.
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap> {
 const base=siteUrl(),now=new Date();
 const fixed=['/','/pricing','/faq','/about','/contact','/terms','/privacy','/refund-policy'];
 const dynamicPaths=[...await sitemapEntries(getDatabase()),...await contentSitemap(getDatabase())];
 return [...fixed.map(p=>({url:`${base}${p}`,lastModified:now,changeFrequency:'monthly' as const,priority:p==='/'?1:0.5})),
  ...dynamicPaths.map(p=>({url:`${base}${p}`,lastModified:now,changeFrequency:'weekly' as const,priority:p.split('/').length===3?0.9:0.8}))];
}
