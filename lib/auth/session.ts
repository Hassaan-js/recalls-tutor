import { headers } from 'next/headers';
import { getAuth } from './server';
import { getDatabase } from '../db/client';
import { actorFromSession } from './actor';
import { REFERRAL_COOKIE, claimReferral } from '../services/referrals';
export async function getCurrentActor() {
 const requestHeaders=await headers();
 const session=await getAuth().api.getSession({headers:requestHeaders});
 const actor=await actorFromSession(getDatabase(),session);
 // Referrals: a new student who arrived through a friend's link is linked to them once.
 const ref=requestHeaders.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${REFERRAL_COOKIE}=([a-z0-9]{6,12})`))?.[1];
 if(actor&&ref&&actor.role==='student'&&actor.emailVerified)await claimReferral(getDatabase(),actor.id,ref).catch(()=>false);
 return actor;
}
