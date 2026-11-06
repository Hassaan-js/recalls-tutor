import {getDatabase} from '@/lib/db/client';
import {sendAuthMail} from '@/lib/auth/mail';
import {cronAuthorized} from '@/lib/integrations/cron';
import {sweepPartners} from '@/lib/services/partners';
import {deliverWebhooks} from '@/lib/services/partner-webhooks';
export const dynamic='force-dynamic';
// Scheduled every few minutes: expiry events, pack alerts, unsent seat emails, webhook retries and log pruning.
export async function GET(request:Request) {
 if(!cronAuthorized(request))return Response.json({error:'Unauthorized'},{status:401});
 const db=getDatabase();
 const sweep=await sweepPartners(db,sendAuthMail);
 const webhooks=await deliverWebhooks(db,{limit:100});
 return Response.json({sweep,webhooks});
}
