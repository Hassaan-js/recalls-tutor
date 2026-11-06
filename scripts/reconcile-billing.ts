import {getDatabase} from '../lib/db/client';
import {stripeGateway} from '../lib/integrations/stripe';
import {reconcileBilling} from '../lib/services/billing';
// Nightly job (BILL-4): run from the host's scheduler, e.g. `tsx scripts/reconcile-billing.ts` at 03:00.
async function main() {
 const gateway=stripeGateway();if(!gateway)throw new Error('STRIPE_SECRET_KEY is not set.');
 const db=getDatabase();
 try {const result=await reconcileBilling(db,gateway,null);console.log(`Reconciled: ${result.checked} checked, ${result.failed} failed, ${result.missing} missing from Stripe.`);if(result.failed||result.missing)process.exitCode=2;}
 finally {await db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Reconciliation failed.');process.exitCode=1;});
