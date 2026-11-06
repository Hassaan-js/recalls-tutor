import {after} from 'next/server';
import {getDatabase} from '../db/client';
import {sendAuthMail} from '../auth/mail';
import {sendEnrollmentEmails} from '../services/partners';
import {deliverWebhooks} from '../services/partner-webhooks';
import {serveApi,type ApiContext,type ApiResult} from '../services/partner-api';
// Seat emails and webhooks go out right after a write; the cron route retries anything that failed.
export async function runPartnerJobs() {
 const db=getDatabase();
 await sendEnrollmentEmails(db,sendAuthMail).catch(e=>console.error('Partner seat emails failed',e));
 await deliverWebhooks(db).catch(e=>console.error('Partner webhooks failed',e));
}
export async function v1(request:Request,op:(ctx:ApiContext)=>Promise<ApiResult>,write=false) {
 const {response,wrote}=await serveApi(getDatabase(),request,op,{write});
 if(wrote)after(runPartnerJobs);
 return response;
}
