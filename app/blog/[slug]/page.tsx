import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {findRedirect} from '@/lib/services/site';
import {getPublishedPost,postPath} from '@/lib/services/content-site';
import {pageMetadata,siteUrl,SITE_NAME} from '@/lib/seo';
import {JsonLd,breadcrumbs} from '@/components/seo/json-ld';
import {Prose} from '@/components/public/prose';
export const dynamic='force-dynamic';
type Props={params:Promise<{slug:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
 const {slug}=await params;const post=await getPublishedPost(getDatabase(),slug);
 if(!post)return {title:'Page not found'};
 return pageMetadata(postPath(post.slug),{title:`${post.title} | ${SITE_NAME}`,description:post.excerpt});
}
// SEO-2 / SEO-5: a post with Article structured data.
export default async function PostPage({params}:Props) {
 const {slug}=await params;const db=getDatabase();const post=await getPublishedPost(db,slug);
 if(!post){const to=await findRedirect(db,`/blog/${slug}`);if(to)permanentRedirect(to);notFound();}
 const base=siteUrl(),path=postPath(post.slug);
 const article={'@context':'https://schema.org','@type':'Article',headline:post.title,description:post.excerpt,datePublished:post.publishedAt,dateModified:post.updatedAt,
  author:{'@type':'Organization',name:SITE_NAME},publisher:{'@type':'Organization',name:SITE_NAME},mainEntityOfPage:`${base}${path}`};
 return <main id="main" className="hb">
  <JsonLd data={breadcrumbs([{name:'Home',path:'/'},{name:'Blog',path:'/blog'},{name:post.title,path}],base)}/><JsonLd data={article}/>
  <article className="wrap post" aria-labelledby="post-title">
   <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href="/blog">Blog</Link><span aria-hidden="true">/</span><span aria-current="page">{post.title}</span></nav>
   <h1 id="post-title">{post.title}</h1>
   <p className="post-meta">{post.publishedAt&&new Date(post.publishedAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}{post.examName?` · ${post.examName}`:''}</p>
   <p className="intro">{post.excerpt}</p>
   <Prose body={post.body}/>
  </article>
 </main>;
}
