'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getAuth} from '@/lib/auth/server';
import {getDatabase} from '@/lib/db/client';
import {extendAccess,prepareResetFor,revokeAccess,setRole} from '@/lib/services/admin';
import {reinstateAccount,suspendAccount} from '@/lib/services/protection';
export type AdminResult={error?:string;success?:string};
const field=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==='string'?value:'';};
async function actorId() {const actor=await getCurrentActor();if(staffAccess(actor)!=='allowed'||!actor)throw new Error('Staff access is required.');return actor.id;}
function failure(error:unknown):AdminResult {return {error:error instanceof Error&&!('query' in error)&&!('code' in error)?error.message:'Unable to save this change. Please retry.'};}
const date=(value:string)=>new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
export async function grantStudentAccess(_:AdminResult,form:FormData):Promise<AdminResult> {
 try {const ends=await extendAccess(getDatabase(),await actorId(),{userId:field(form,'userId'),examId:field(form,'examId'),days:Number(field(form,'days')),note:field(form,'note')});revalidatePath('/studio/students');return {success:`Access granted until ${date(ends)}.`};}catch(error){return failure(error);}
}
export async function revokeStudentAccess(entitlementId:string,note:string):Promise<AdminResult> {
 try {await revokeAccess(getDatabase(),await actorId(),entitlementId,note);revalidatePath('/studio/students');return {success:'Complimentary access revoked.'};}catch(error){return failure(error);}
}
export async function sendStudentReset(userId:string):Promise<AdminResult> {
 try {const email=await prepareResetFor(getDatabase(),await actorId(),userId);await getAuth().api.requestPasswordReset({body:{email,redirectTo:'/reset-password'}});return {success:`A password reset link was sent to ${email}.`};}catch(error){return failure(error);}
}
export async function suspendStudent(_:AdminResult,form:FormData):Promise<AdminResult> {
 try {await suspendAccount(getDatabase(),await actorId(),field(form,'userId'),field(form,'reason'));revalidatePath('/studio/students');return {success:'Account suspended and signed out everywhere.'};}catch(error){return failure(error);}
}
export async function reinstateStudent(userId:string):Promise<AdminResult> {
 try {await reinstateAccount(getDatabase(),await actorId(),userId);revalidatePath('/studio/students');return {success:'Account reinstated.'};}catch(error){return failure(error);}
}
export async function changeRole(_:AdminResult,form:FormData):Promise<AdminResult> {
 try {const r=await setRole(getDatabase(),await actorId(),{email:field(form,'email')||undefined,userId:field(form,'userId')||undefined,role:field(form,'role')});revalidatePath('/studio/team');
  return {success:`${r.email} is now ${r.to==='student'?'a student':`a ${r.to.replaceAll('_',' ')}`}. They are signed out so the change applies at their next sign-in.`};}catch(error){return failure(error);}
}
