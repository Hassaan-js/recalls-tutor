import {getCurrentActor} from '@/lib/auth/session';
export const dynamic='force-dynamic';
export async function GET() {
 const actor=await getCurrentActor();
 if (!actor) return Response.json({code:'UNAUTHENTICATED'},{status:401,headers:{'Cache-Control':'no-store'}});
 return Response.json({user:actor},{headers:{'Cache-Control':'no-store'}});
}
