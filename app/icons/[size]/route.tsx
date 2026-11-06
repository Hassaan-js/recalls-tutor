import {ImageResponse} from 'next/og';
// STU-16 / PWA: the home-screen icon, drawn from the site mark on a full teal square so it also works as maskable.
const SIZES=[192,512] as const;
export function generateStaticParams(){return SIZES.map(size=>({size:String(size)}));}
export async function GET(_:Request,{params}:{params:Promise<{size:string}>}) {
 const size=Number((await params).size);
 if(!SIZES.includes(size as typeof SIZES[number]))return new Response('Not found',{status:404});
 const u=size/32;
 return new ImageResponse(<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(135deg,#0f766e,#0e7490)'}}>
  <div style={{position:'relative',display:'flex',width:16*u,height:18*u}}>
   <div style={{position:'absolute',right:-2.4*u,top:4*u,width:2.4*u,height:6*u,borderRadius:`0 ${1.2*u}px ${1.2*u}px 0`,background:'#5eead4'}}/>
   {[[3,10],[8,8],[13,6]].map(([top,width])=><div key={top} style={{position:'absolute',left:2*u,top:top*u,width:width*u,height:1.8*u,borderRadius:u,background:'#fff'}}/>)}
  </div></div>,{width:size,height:size});
}
