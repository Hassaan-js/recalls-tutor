import {timingSafeEqual} from 'node:crypto';
// Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Without the secret every scheduled route refuses.
export function cronAuthorized(request:Request) {
 const secret=process.env.CRON_SECRET,given=request.headers.get('authorization')??'',expected=`Bearer ${secret}`;
 return Boolean(secret)&&given.length===expected.length&&timingSafeEqual(Buffer.from(given),Buffer.from(expected));
}
