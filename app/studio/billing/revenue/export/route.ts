import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {CouponError,revenueCsv} from '@/lib/services/coupons';
export const dynamic='force-dynamic';
// BILL-6: one row per payment for the chosen dates, for accounting.
export async function GET(request:Request) {
 const actor=await getCurrentActor();
 if(staffAccess(actor)!=='allowed'||!actor||actor.role!=='super_admin')return new Response('Super Admin access required.',{status:403});
 const url=new URL(request.url),from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??'';
 try {
  const csv=await revenueCsv(getDatabase(),actor.id,{from,to});
  return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="recalls-tutor-revenue-${from}-to-${to}.csv"`,'Cache-Control':'no-store'}});
 } catch(error) {
  if(error instanceof CouponError)return new Response(error.message,{status:400});
  throw error;
 }
}
