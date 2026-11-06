import {getDatabase} from '@/lib/db/client';
import {cronAuthorized} from '@/lib/integrations/cron';
import {stripeGateway} from '@/lib/integrations/stripe';
import {reconcileBilling} from '@/lib/services/billing';
export const dynamic='force-dynamic';
export const maxDuration=300;
// Scheduled nightly (BILL-4): compare every Stripe subscription with our records and repair drift.
export async function GET(request:Request) {
 if(!cronAuthorized(request))return Response.json({error:'Unauthorized'},{status:401});
 const gateway=stripeGateway();
 if(!gateway)return Response.json({skipped:'Stripe is not configured.'});
 return Response.json(await reconcileBilling(getDatabase(),gateway,null));
}
