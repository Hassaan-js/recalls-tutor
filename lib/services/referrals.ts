import {randomBytes} from 'node:crypto';
import type {Database} from '../db/client';
import type {StripeGateway} from '../integrations/stripe';
import {issuePersonalCoupon} from './coupons';
import {offerSettings} from './lifecycle';
// R3 referrals: each student has a link. A friend who signs up through it within 30 days (cookie) is linked to
// them; when the friend first pays, the referrer can receive a single-use code. The reward is off until a
// Super Admin sets its percentage: it is a business decision, not a default.
export const REFERRAL_COOKIE='rt_ref';
export async function referralCode(db:Database,userId:string) {
 const [row]=await db.query<{code:string}>('SELECT code FROM referral_codes WHERE user_id=$1',[userId]);
 if(row)return row.code;
 for(let i=0;i<5;i++){const code=randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8).padEnd(8,'0');
  const [made]=await db.query<{code:string}>('INSERT INTO referral_codes(user_id,code) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING code',[userId,code]);
  if(made)return made.code;
  const [again]=await db.query<{code:string}>('SELECT code FROM referral_codes WHERE user_id=$1',[userId]);if(again)return again.code;}
 throw new Error('Could not create a referral link. Please retry.');
}
export async function referralSummary(db:Database,userId:string) {
 const code=await referralCode(db,userId);
 const [r]=await db.query<{joined:number;paid:number;rewards:number}>(`SELECT count(*)::int AS joined,count(*) FILTER (WHERE converted_at IS NOT NULL)::int AS paid,count(reward_coupon_id)::int AS rewards FROM referrals WHERE referrer_id=$1`,[userId]);
 const s=await offerSettings(db);
 return {code,...r,rewardPercent:s.referralPercent};
}
// Linked only for a new account (created in the last 7 days) that has never paid and is not the referrer.
export async function claimReferral(db:Database,refereeId:string,code:string) {
 if(!/^[a-z0-9]{6,12}$/.test(code))return false;
 const rows=await db.query(`INSERT INTO referrals(referee_id,referrer_id) SELECT $1,c.user_id FROM referral_codes c JOIN app_users a ON a.id=$1
  WHERE c.code=$2 AND c.user_id<>$1 AND a.created_at>now()-interval '7 days' AND a.role='student' AND NOT EXISTS(SELECT 1 FROM billing_payments p WHERE p.user_id=$1)
  ON CONFLICT(referee_id) DO NOTHING RETURNING referee_id`,[refereeId,code]);
 return rows.length>0;
}
// Called after a payment is recorded. Only the friend's first paid invoice converts the referral.
export async function convertReferral(db:Database,gateway:StripeGateway,refereeId:string) {
 const [ref]=await db.query<{referrer_id:string}>(`UPDATE referrals SET converted_at=now() WHERE referee_id=$1 AND converted_at IS NULL
  AND (SELECT count(*) FROM billing_payments p WHERE p.user_id=$1 AND p.amount_cents>0)=1 RETURNING referrer_id`,[refereeId]);
 if(!ref)return null;
 const s=await offerSettings(db);
 if(!s.referralPercent)return null;
 // The code is for the exam the referrer studies: their latest plan, else the first exam on their profile.
 const [exam]=await db.query<{id:string;name:string}>(`SELECT e.id,e.name FROM exams e WHERE e.id=COALESCE((SELECT exam_id FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1),(SELECT exam_ids[1] FROM student_profiles WHERE user_id=$1))`,[ref.referrer_id]);
 if(!exam)return null;
 // One referral reward per friend: the coupon is tied to this referee through the lifecycle email's ref.
 const c=await issuePersonalCoupon(db,gateway,{userId:ref.referrer_id,examId:exam.id,purpose:'referral',percentOff:s.referralPercent,validDays:30,name:`Referral ${s.referralPercent}% · ${exam.name}`,unique:refereeId}).catch(()=>null);
 if(!c?.synced)return null;
 await db.query('UPDATE referrals SET reward_coupon_id=$2 WHERE referee_id=$1',[refereeId,c.id]);
 await db.query(`INSERT INTO lifecycle_emails(kind,user_id,ref,coupon_id) VALUES('referral_reward',$1,$2,$3) ON CONFLICT DO NOTHING`,[ref.referrer_id,refereeId,c.id]);
 return c.code;
}
