'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {reinstateAccount,resolveSecurityAlert,suspendAccount,updateProtectionSettings} from '@/lib/services/protection';
export type SecurityResult={error?:string;success?:string};
function field(form:FormData,key:string) {const value=form.get(key);return typeof value==='string'?value:'';}
async function actorId() {const actor=await getCurrentActor();if(staffAccess(actor)!=='allowed'||!actor)throw new Error('Staff access is required.');return actor.id;}
function failure(error:unknown):SecurityResult {return {error:error instanceof Error && !('query' in error) && !('code' in error)?error.message:'Unable to save this change. Please retry.'};}
export async function saveProtection(_:SecurityResult,form:FormData):Promise<SecurityResult> {
 try {await updateProtectionSettings(getDatabase(),await actorId(),{hourlyQuestionBudget:Number(field(form,'hourlyQuestionBudget')),burstQuestions:Number(field(form,'burstQuestions')),burstMinutes:Number(field(form,'burstMinutes'))});revalidatePath('/studio/security');return {success:'Protection limits saved.'};}catch(error){return failure(error);}
}
export async function resolveAlert(_:SecurityResult,form:FormData):Promise<SecurityResult> {
 try {await resolveSecurityAlert(getDatabase(),await actorId(),field(form,'alertId'),field(form,'resolution'));revalidatePath('/studio/security');return {success:'Alert resolved.'};}catch(error){return failure(error);}
}
export async function suspend(_:SecurityResult,form:FormData):Promise<SecurityResult> {
 try {await suspendAccount(getDatabase(),await actorId(),field(form,'userId'),field(form,'reason'));revalidatePath('/studio/security');return {success:'Account suspended and signed out everywhere.'};}catch(error){return failure(error);}
}
export async function reinstate(_:SecurityResult,form:FormData):Promise<SecurityResult> {
 try {await reinstateAccount(getDatabase(),await actorId(),field(form,'userId'));revalidatePath('/studio/security');return {success:'Account reinstated.'};}catch(error){return failure(error);}
}
