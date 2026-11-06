'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {setMarketingEmails} from '@/lib/services/lifecycle';
export async function setOfferEmails(on:boolean):Promise<{error?:string}> {
 const actor=await getCurrentActor();if(!actor)return {error:'Sign in again to change this.'};
 try{await setMarketingEmails(getDatabase(),actor.id,on);revalidatePath('/account/profile');return {};}catch{return {error:'Unable to save this. Please retry.'};}
}
