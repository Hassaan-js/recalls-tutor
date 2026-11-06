import {ImageResponse} from 'next/og';
// SEO-5: the Open Graph / Twitter share image, in the site's product-led look: the deep teal field of the page
// headers, the mark, the page's own title in white, and a fragment of the practice screen on the right. The
// fragment carries no question text or figures, so a shared link never shows content or numbers it should not.
export const shareSize={width:1200,height:630};
const DEEP='#0b2f35',DEEP2='#0f3f46',MINT='#5eead4',MUTED='#a7c7c9';
function Mark({size}:{size:number}) {
 return <svg width={size} height={size} viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0f766e"/><stop offset="1" stopColor="#0e7490"/></linearGradient></defs>
  <rect x="2" y="3" width="23" height="26" rx="7" fill="url(#g)"/><path d="M25 9h2.5a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5H25z" fill={MINT}/><path d="M8 11h9M8 16h7M8 21h5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>;
}
// A practice-screen fragment: a stem as grey lines, five option rows with the second marked correct.
function Fragment() {
 const rows=['A','B','C','D','E'];
 return <div style={{display:'flex',flexDirection:'column',width:330,background:'#fff',borderRadius:22,padding:'26px 26px 22px',boxShadow:'0 30px 60px -20px rgba(0,0,0,.45)'}}>
  <div style={{display:'flex',gap:8,marginBottom:18}}><div style={{display:'flex',width:70,height:22,borderRadius:11,background:'#f0fdfa',border:'1.5px solid #99f6e4'}}/><div style={{display:'flex',width:86,height:22,borderRadius:11,background:'#fffbeb',border:'1.5px solid #fcd34d'}}/></div>
  {[262,280,190].map((w,i)=><div key={i} style={{display:'flex',width:w,height:11,borderRadius:6,background:'#cbd5e1',marginBottom:10}}/>)}
  <div style={{display:'flex',flexDirection:'column',gap:9,marginTop:10}}>{rows.map((l,i)=><div key={l} style={{display:'flex',alignItems:'center',gap:12,height:38,padding:'0 12px',borderRadius:10,border:`1.5px solid ${i===1?'#15803d':'#e2e8f0'}`,background:i===1?'#f0fdf4':'#fff'}}>
   <div style={{display:'flex',alignItems:'center',justifyContent:'center',width:22,height:22,borderRadius:6,background:i===1?'#15803d':'#f1f5f9',color:i===1?'#fff':'#475569',fontSize:13,fontWeight:700}}>{l}</div>
   <div style={{display:'flex',width:[120,150,96,134,110][i],height:9,borderRadius:5,background:i===1?'#86efac':'#e2e8f0'}}/></div>)}</div>
 </div>;
}
export function shareImage(family:string,title:string,footnote:string) {
 return new ImageResponse(<div style={{width:'100%',height:'100%',display:'flex',background:`linear-gradient(135deg,${DEEP} 0%,${DEEP2} 100%)`,padding:'64px 72px',position:'relative'}}>
  <div style={{position:'absolute',right:-120,top:-160,width:620,height:620,borderRadius:310,background:'rgba(94,234,212,.08)',display:'flex'}}/>
  <div style={{display:'flex',flexDirection:'column',justifyContent:'space-between',flex:1,minWidth:0,paddingRight:48}}>
   <div style={{display:'flex',alignItems:'center',gap:14,color:'#fff',fontSize:30,fontWeight:700}}><Mark size={46}/>Recalls Tutor</div>
   <div style={{display:'flex',flexDirection:'column'}}>
    <div style={{display:'flex',color:MINT,fontSize:28,fontWeight:700,marginBottom:18}}>{family}</div>
    <div style={{display:'flex',color:'#fff',fontSize:title.length>30?64:title.length>20?76:88,fontWeight:700,lineHeight:1.05,letterSpacing:-2}}>{title}</div>
   </div>
   <div style={{display:'flex',color:MUTED,fontSize:26}}>{footnote}</div>
  </div>
  <div style={{display:'flex',alignItems:'center'}}><Fragment/></div>
 </div>,shareSize);
}
