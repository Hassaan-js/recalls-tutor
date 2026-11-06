import type {Metadata} from 'next';
import Link from 'next/link';
import {getDatabase} from '@/lib/db/client';
import {listPublishedPosts,postPath} from '@/lib/services/content-site';
import {pageHeading,pageMetadata,SITE_NAME} from '@/lib/seo';
import {ArrowRight} from '@/components/site/icons';
export const dynamic='force-dynamic';
export async function generateMetadata():Promise<Metadata> {
 return pageMetadata('/blog',{title:`Guides and sitting reports | ${SITE_NAME}`,description:'Revision guides and what came up in each recent sitting, from the Recalls Tutor team.'});
}
const KIND:Record<string,string>={post:'Article',guide:'Guide',sitting_report:'Sitting report'};
// SEO-2: guides, articles and "What came up" reports written by staff.
export default async function BlogPage() {
 const posts=await listPublishedPosts(getDatabase());
 const h1=await pageHeading('/blog','Guides and sitting reports');
 return <main id="main" className="hb">
  <section className="pg-hero" aria-labelledby="blog-title"><div className="wrap"><nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">Blog</span></nav>
   <h1 id="blog-title">{h1}</h1><p className="intro">How to revise, and what came up in each recent sitting.</p></div></section>
  <section className="hb-sec wrap" aria-label="Posts">{posts.length?<ul className="post-list">{posts.map(p=><li key={p.id}><Link href={postPath(p.slug)}>
    <span className="post-kind">{KIND[p.kind]??'Article'}{p.examName?` · ${p.examName}`:''}</span><strong>{p.title}</strong><span className="post-excerpt">{p.excerpt}</span>
    <span className="post-meta">{p.publishedAt&&new Date(p.publishedAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}<ArrowRight/></span></Link></li>)}</ul>
   :<p className="intro">The first guides are being written. Check back soon.</p>}</section>
 </main>;
}
