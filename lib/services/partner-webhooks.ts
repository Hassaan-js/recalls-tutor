import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import type {Database} from '../db/client';
// PART-4 outbound webhooks. Each event is stored as one delivery per subscribed endpoint, signed with the endpoint's
// secret and retried with backoff, so a partner that is down briefly still receives every event.
export const WEBHOOK_EVENTS=['enrollment.activated','enrollment.expiring','enrollment.expired','seats.low_balance'] as const;
export type WebhookEvent=typeof WEBHOOK_EVENTS[number];
export type Mode='live'|'test';
// Minutes to wait after each failed attempt; after the last one the delivery is given up and shown as failed.
const BACKOFF=[1,5,30,120,360,720,1440];
export const MAX_ATTEMPTS=BACKOFF.length+1;
export function newWebhookSecret() {return `whsec_${randomBytes(24).toString('base64url')}`;}
// Header format: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">. Partners compare in constant time and
// reject timestamps older than five minutes.
export function signWebhook(secret:string,body:string,timestamp:number) {
 return `t=${timestamp},v1=${createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
// Partner-supplied URLs must be public HTTPS addresses; private and loopback hosts are refused.
export function validWebhookUrl(value:string) {
 let url:URL;
 try {url=new URL(value.trim());} catch {throw new Error('Enter a full URL starting with https://.');}
 if(url.protocol!=='https:')throw new Error('Webhook URLs must use https://.');
 if(url.username||url.password)throw new Error('Do not put a username or password in the URL.');
 const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 const privateV4=/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||(isIP(host)===4&&privateV4.test(host))||(isIP(host)===6&&(host==='::1'||/^(fc|fd|fe80)/.test(host))))
  throw new Error('Webhook URLs must point to a public server.');
 if(url.toString().length>500)throw new Error('Webhook URLs can be up to 500 characters.');
 return url.toString();
}
export async function enqueueWebhook(db:Database,organisationId:string,mode:Mode,event:WebhookEvent,data:Record<string,unknown>) {
 const endpoints=await db.query<{id:string}>(`SELECT id FROM webhook_endpoints WHERE organisation_id=$1 AND mode=$2 AND disabled_at IS NULL AND $3=ANY(events)`,[organisationId,mode,event]);
 if(!endpoints.length)return 0;
 const payload={id:`evt_${randomUUID().replaceAll('-','')}`,type:event,mode,created_at:new Date().toISOString(),data};
 for(const e of endpoints)await db.query('INSERT INTO webhook_deliveries(endpoint_id,event,payload) VALUES($1,$2,$3::jsonb)',[e.id,event,JSON.stringify(payload)]);
 return endpoints.length;
}
export type Sender=(url:string,init:{method:'POST';headers:Record<string,string>;body:string;signal:AbortSignal;redirect:'manual'})=>Promise<{status:number}>;
const defaultSender:Sender=(url,init)=>fetch(url,init);
// Claims due deliveries with a short lease (so two workers never send the same one), sends them, and records the
// result. Safe to call from the API after a write and from the cron route.
export async function deliverWebhooks(db:Database,options:{send?:Sender;limit?:number}={}) {
 const send=options.send??defaultSender;
 const due=await db.query<{id:string;url:string;secret:string;payload:Record<string,unknown>;attempts:number;event:string}>(`UPDATE webhook_deliveries d SET next_attempt_at=now()+interval '2 minutes' FROM webhook_endpoints e
  WHERE d.id IN (SELECT id FROM webhook_deliveries WHERE delivered_at IS NULL AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED) AND e.id=d.endpoint_id AND e.disabled_at IS NULL
  RETURNING d.id,e.url,e.secret,d.payload,d.attempts,d.event`,[options.limit??25]);
 let delivered=0;
 for(const d of due) {
  const body=JSON.stringify(d.payload),timestamp=Math.floor(Date.now()/1000);
  let status:number|null=null,error:string|null=null;
  try {
   status=(await send(d.url,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'RecallsTutor-Webhooks/1','Recalls-Event':d.event,'Recalls-Delivery':d.id,'Recalls-Signature':signWebhook(d.secret,body,timestamp)},body,signal:AbortSignal.timeout(10000),redirect:'manual'})).status;
   if(status<200||status>=300)error=`The endpoint answered ${status}.`;
  } catch(e) {error=e instanceof Error&&e.name==='TimeoutError'?'No answer within 10 seconds.':'The endpoint could not be reached.';}
  const attempts=d.attempts+1;
  if(!error){delivered++;await db.query('UPDATE webhook_deliveries SET delivered_at=now(),attempts=$2,last_status=$3,last_error=NULL WHERE id=$1',[d.id,attempts,status]);continue;}
  const wait=BACKOFF[attempts-1];
  await db.query(`UPDATE webhook_deliveries SET attempts=$2,last_status=$3,last_error=$4,next_attempt_at=CASE WHEN $5::int IS NULL THEN NULL ELSE now()+make_interval(mins=>$5::int) END WHERE id=$1`,[d.id,attempts,status,error,wait??null]);
 }
 return {sent:due.length,delivered};
}
