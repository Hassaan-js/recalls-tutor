import { getAuth } from '@/lib/auth/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handler(request:Request) {
 try {return await getAuth().handler(request);}
 catch {return Response.json({code:'AUTH_UNAVAILABLE',message:'Authentication is temporarily unavailable. Please try again.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export {handler as GET,handler as POST};
