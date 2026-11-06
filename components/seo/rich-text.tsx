// Renders staff-written page text as plain React elements: blank-line paragraphs, "## " headings and "- " bullets.
// No HTML is ever interpreted, so page text cannot inject markup.
export function RichText({text}:{text:string}) {
 const out:React.ReactNode[]=[];
 text.replace(/\r\n?/g,'\n').split(/\n{2,}/).map(b=>b.trim()).filter(Boolean).forEach((block,i)=>{
  const lines=block.split('\n');
  // A heading line may be followed by bullets or a paragraph in the same block.
  if(lines[0].startsWith('## ')){out.push(<h2 key={`h${i}`}>{lines[0].slice(3)}</h2>);lines.shift();}
  if(!lines.length)return;
  if(lines.every(l=>l.startsWith('- ')))out.push(<ul key={`u${i}`}>{lines.map((l,j)=><li key={j}>{l.slice(2)}</li>)}</ul>);
  else out.push(<p key={`p${i}`}>{lines.join(' ')}</p>);
 });
 return <>{out}</>;
}
