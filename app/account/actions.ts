'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {deleteAccount,saveProfile} from '@/lib/services/student';
export type AccountResult={error?:string;success?:string;deleted?:boolean};
const field=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==='string'?value:'';};
function failure(error:unknown):AccountResult {return {error:error instanceof Error&&!('query' in error)&&!('code' in error)?error.message:'Unable to save this change. Please retry.'};}
async function actorId() {const actor=await getCurrentActor();if(!actor||actor.suspended)throw new Error('Sign in to change your account.');return actor.id;}
export async function updateProfile(_:AccountResult,form:FormData):Promise<AccountResult> {
 try {await saveProfile(getDatabase(),await actorId(),{name:field(form,'name'),country:field(form,'country'),timezone:field(form,'timezone'),examIds:form.getAll('examIds').filter((v):v is string=>typeof v==='string'),examDate:field(form,'examDate'),dailyTarget:field(form,'dailyTarget')});
  revalidatePath('/account/profile');revalidatePath('/practice');return {success:'Profile saved.'};}catch(error){return failure(error);}
}
export async function removeAccount(_:AccountResult,form:FormData):Promise<AccountResult> {
 try {await deleteAccount(getDatabase(),await actorId(),field(form,'confirmEmail'));return {deleted:true};}catch(error){return failure(error);}
}
