import {NextResponse} from 'next/server';
import {REFERRAL_COOKIE} from '@/lib/services/referrals';
import {siteUrl} from '@/lib/seo';
export const dynamic='force-dynamic';
// A friend's referral link: remember the code for 30 days, then go to sign-up. The link itself grants nothing.
export async function GET(_:Request,{params}:{params:Promise<{code:string}>}) {
 const {code}=await params;
 const response=NextResponse.redirect(`${siteUrl()}/sign-up`,303);
 if(/^[a-z0-9]{6,12}$/.test(code))response.cookies.set(REFERRAL_COOKIE,code,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:30*86400});
 return response;
}
