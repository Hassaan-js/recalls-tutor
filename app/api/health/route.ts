import {cronAuthorized} from '@/lib/integrations/cron';
import {getDatabase} from '@/lib/db/client';
import {readiness} from '@/lib/readiness';
export const dynamic='force-dynamic';
// Public: a plain liveness answer for uptime monitors. With the cron secret: the readiness report (no secrets).
export async function GET(request:Request) {
 if(!cronAuthorized(request))return Response.json({status:'ok',service:'recalls-tutor'});
 const r=await readiness(process.env.DATABASE_URL?getDatabase():null);
 return Response.json({status:r.ready?'ready':'not_ready',checks:r.checks.map(c=>({name:c.name,ok:c.ok,required:c.required,detail:c.ok&&/KEY|SECRET/i.test(c.detail)?'set':c.detail}))});
}
