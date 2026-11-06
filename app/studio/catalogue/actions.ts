'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {createExam,createSitting,createTopic,updateExamSettings,updateSitting} from '@/lib/services/catalogue-admin';
export type CatalogueResult={error?:string;success?:string};
function field(form:FormData,key:string) {const value=form.get(key);return typeof value==='string'?value:'';}
async function actorId() {const actor=await getCurrentActor();if(staffAccess(actor)!=='allowed'||!actor)throw new Error('Staff access is required.');return actor.id;}
function failure(error:unknown):CatalogueResult {return {error:error instanceof Error && !('query' in error) && !('code' in error)?error.message:'Unable to save this change. Please retry.'};}
function refresh() {revalidatePath('/studio/catalogue');revalidatePath('/studio');revalidatePath('/practice');}
export async function saveExamSettings(_:CatalogueResult,form:FormData):Promise<CatalogueResult> {
 try {
  await updateExamSettings(getDatabase(),await actorId(),field(form,'examId'),{questionCount:field(form,'questionCount'),durationMinutes:field(form,'durationMinutes'),passMarkPercent:field(form,'passMarkPercent'),highYieldMin:field(form,'highYieldMin'),needsExpertBelow:field(form,'needsExpertBelow'),
   approvedSources:field(form,'approvedSources').split('\n').map(s=>s.trim()).filter(Boolean),styleNotes:field(form,'styleNotes'),
   trial:form.has('trialDays')?{enabled:field(form,'trialEnabled')==='true',days:field(form,'trialDays'),questionLimit:field(form,'trialQuestionLimit'),mockSize:field(form,'trialMockSize')}:undefined});
  refresh();return {success:'Exam settings saved.'};
 }catch(error){return failure(error);}
}
export async function addSitting(_:CatalogueResult,form:FormData):Promise<CatalogueResult> {
 try {await createSitting(getDatabase(),await actorId(),{examId:field(form,'examId'),year:Number(field(form,'year')),month:Number(field(form,'month')),label:field(form,'label')});refresh();return {success:'Sitting added.'};}catch(error){return failure(error);}
}
export async function toggleSitting(sittingId:string,changes:{published?:boolean;trialPool?:boolean}):Promise<CatalogueResult> {
 try {await updateSitting(getDatabase(),await actorId(),sittingId,changes);refresh();return {success:'Sitting updated.'};}catch(error){return failure(error);}
}
export async function addTopic(_:CatalogueResult,form:FormData):Promise<CatalogueResult> {
 try {await createTopic(getDatabase(),await actorId(),{examId:field(form,'examId'),name:field(form,'name'),parentId:field(form,'parentId')||null});refresh();return {success:'Topic added.'};}catch(error){return failure(error);}
}
export async function addExam(_:CatalogueResult,form:FormData):Promise<CatalogueResult&{slug?:string}> {
 try {const r=await createExam(getDatabase(),await actorId(),{familySlug:field(form,'familySlug'),familyName:field(form,'familyName'),name:field(form,'name'),slug:field(form,'slug'),description:field(form,'description')});revalidatePath('/studio/catalogue');revalidatePath('/','layout');return {success:'Exam added. Set its timings, topics and sittings next.',slug:r.slug};}catch(error){return failure(error);}
}
