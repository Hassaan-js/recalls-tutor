import Link from 'next/link';
import type {ReactNode} from 'react';
// Staff-written posts: a small, safe subset of Markdown (## headings, - lists, **bold**, [links](/path)), rendered as
// React elements. No HTML from the post is ever injected into the page.
function inline(text:string,key:string):ReactNode[] {
 const out:ReactNode[]=[];const re=/\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;let last=0,m:RegExpExecArray|null,i=0;
 while((m=re.exec(text))){if(m.index>last)out.push(text.slice(last,m.index));
  if(m[1])out.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
  else{const href=m[3];const safe=/^\/(?!\/)/.test(href)||/^https:\/\//.test(href);
   out.push(safe?(href.startsWith('/')?<Link key={`${key}-${i++}`} href={href} className="hb-link">{m[2]}</Link>:<a key={`${key}-${i++}`} href={href} className="hb-link" rel="noopener nofollow">{m[2]}</a>):m[2]);}
  last=re.lastIndex;}
 if(last<text.length)out.push(text.slice(last));
 return out;
}
export function Prose({body}:{body:string}) {
 const blocks=body.replace(/\r\n/g,'\n').split(/\n{2,}/).map(b=>b.trim()).filter(Boolean);
 return <div className="prose">{blocks.map((b,i)=>{
  if(b.startsWith('### '))return <h3 key={i}>{inline(b.slice(4),`h${i}`)}</h3>;
  if(b.startsWith('## '))return <h2 key={i}>{inline(b.slice(3),`h${i}`)}</h2>;
  const lines=b.split('\n');
  if(lines.every(l=>/^[-*] /.test(l)))return <ul key={i}>{lines.map((l,j)=><li key={j}>{inline(l.slice(2),`l${i}-${j}`)}</li>)}</ul>;
  if(lines.every(l=>/^\d+\. /.test(l)))return <ol key={i}>{lines.map((l,j)=><li key={j}>{inline(l.replace(/^\d+\. /,''),`o${i}-${j}`)}</li>)}</ol>;
  return <p key={i}>{lines.map((l,j)=><span key={j}>{j>0&&<br/>}{inline(l,`p${i}-${j}`)}</span>)}</p>;
 })}</div>;
}
