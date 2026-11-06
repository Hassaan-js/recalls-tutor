import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {exportAccountData} from '@/lib/services/student';
// AUTH-3: the signed-in student's own data as a JSON download. Question content is not included.
export async function GET() {
 const actor=await getCurrentActor();
 if(!actor)return new Response('Sign in to export your data.',{status:401});
 const data=await exportAccountData(getDatabase(),actor.id);
 return new Response(JSON.stringify(data,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="recalls-tutor-data-${new Date().toISOString().slice(0,10)}.json"`,'Cache-Control':'no-store'}});
}
