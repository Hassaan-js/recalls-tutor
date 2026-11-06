import {getDatabase} from '@/lib/db/client';
import {sendAuthMail} from '@/lib/auth/mail';
import {cronAuthorized} from '@/lib/integrations/cron';
import {stripeGateway} from '@/lib/integrations/stripe';
import {runLifecycle} from '@/lib/services/lifecycle';
import {pruneTutorRequests} from '@/lib/services/tutor';
import {siteUrl} from '@/lib/seo';
export const dynamic='force-dynamic';
export const maxDuration=60;
// Scheduled hourly (BILL-7, TRIAL-2): renewal reminders, receipts, failed-payment notices, trial emails, offers and referral rewards.
export async function GET(request:Request) {
 if(!cronAuthorized(request))return Response.json({error:'Unauthorized'},{status:401});
 const db=getDatabase();
 const emails=await runLifecycle(db,stripeGateway(),sendAuthMail,siteUrl());
 const tutorPruned=await pruneTutorRequests(db);// student text kept 30 days only
 return Response.json({...emails,tutorPruned});
}
