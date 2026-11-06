import {createHash,randomUUID} from 'node:crypto';
import type {Database} from '../db/client';
import {changeEnrollment,createEnrollment,enrollmentProgress,findApiKey,getEnrollment,ipAllowed,listEnrollments,listProducts,PartnerError,resolveProduct,revokeEnrollment,seatBalances} from './partners';
import type {Mode} from './partner-webhooks';
// PART-4: the /v1 partner API. Every request is authenticated by key, checked against the key's IP allow-list,
// rate limited per key and logged for the Partner Portal. Every write needs an Idempotency-Key: the first response
// is kept for 24 hours and replayed for a retry, so a retried course purchase never uses a second seat.
export const RATE_LIMIT=120; // requests per key per minute
const MAX_BODY=16*1024;
export type ApiContext={db:Database;orgId:string;mode:Mode;sandbox:boolean;keyId:string;body:Record<string,unknown>;url:URL};
export type ApiResult={status:number;body:unknown};
type Op=(ctx:ApiContext)=>Promise<ApiResult>;
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
function json(status:number,body:unknown,extra:Record<string,string>={}) {
 return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
}
const TYPES:Record<number,string>={400:'invalid_request_error',401:'authentication_error',402:'seats_error',403:'permission_error',404:'not_found_error',409:'conflict_error',422:'invalid_request_error',429:'rate_limit_error',500:'api_error'};
export const apiError=(status:number,code:string,message:string,detail:Record<string,unknown>={})=>({status,body:{error:{type:TYPES[status]??'api_error',code,message,...detail}}});
export function clientIp(request:Request) {
 return request.headers.get('x-real-ip')?.trim()||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||null;
}
export async function serveApi(db:Database,request:Request,op:Op,opts:{write?:boolean}={}):Promise<{response:Response;wrote:boolean}> {
 const started=Date.now(),url=new URL(request.url),requestId=`req_${randomUUID().replaceAll('-','')}`,ip=clientIp(request);
 const done=(r:ApiResult,extra:Record<string,string>={})=>json(r.status,r.body,{'Request-Id':requestId,...extra});
 const auth=request.headers.get('authorization')??'';
 const secret=/^Bearer\s+(\S+)$/i.exec(auth)?.[1];
 if(!secret)return {response:done(apiError(401,'missing_api_key','Send your API key as "Authorization: Bearer rt_live_…".'),{'WWW-Authenticate':'Bearer'}),wrote:false};
 const key=await findApiKey(db,secret);
 if(!key)return {response:done(apiError(401,'invalid_api_key','This API key is not valid.'),{'WWW-Authenticate':'Bearer'}),wrote:false};
 const log=async(status:number,idem:string|null,replayed=false)=>{await db.query('INSERT INTO api_requests(organisation_id,key_id,mode,method,path,status,ip,idempotency_key,replayed,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [key.orgId,key.keyId,key.mode,request.method,url.pathname.slice(0,200),status,ip,idem,replayed,Date.now()-started]);};
 const finish=async(r:ApiResult,idem:string|null=null,extra:Record<string,string>={},replayed=false)=>{await log(r.status,idem,replayed);return done(r,extra);};
 if(key.problem==='revoked')return {response:await finish(apiError(401,'api_key_revoked','This API key has been revoked or has expired after rotation.')),wrote:false};
 if(key.problem==='suspended')return {response:await finish(apiError(403,'api_key_suspended','This API key has been suspended by Recalls Tutor.')),wrote:false};
 if(key.problem==='partner_inactive')return {response:await finish(apiError(403,'partner_inactive','Your partner account is not active for live requests.')),wrote:false};
 if(!ipAllowed(ip,key.ipAllow))return {response:await finish(apiError(403,'ip_not_allowed',`Requests from ${ip??'this address'} are not on this key's IP allow-list.`)),wrote:false};
 const [{n}]=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM api_requests WHERE key_id=$1 AND created_at>now()-interval '60 seconds'`,[key.keyId]);
 const rate={'RateLimit-Limit':String(RATE_LIMIT),'RateLimit-Remaining':String(Math.max(0,RATE_LIMIT-n-1))};
 if(n>=RATE_LIMIT)return {response:await finish(apiError(429,'rate_limited',`Up to ${RATE_LIMIT} requests a minute per key. Retry shortly.`),null,{...rate,'Retry-After':'60'}),wrote:false};
 await db.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1',[key.keyId]);
 let raw='',body:Record<string,unknown>={};
 if(request.method==='POST'||request.method==='PATCH') {
  raw=await request.text();
  if(raw.length>MAX_BODY)return {response:await finish(apiError(400,'body_too_large','The request body is too large.'),null,rate),wrote:false};
  try {const parsed=raw?JSON.parse(raw):{};if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw 0;body=parsed;}
  catch {return {response:await finish(apiError(400,'invalid_json','Send a JSON object with "Content-Type: application/json".'),null,rate),wrote:false};}
 }
 const ctx:ApiContext={db,orgId:key.orgId,mode:key.mode,sandbox:key.mode==='test',keyId:key.keyId,body,url};
 const run=async():Promise<ApiResult>=>{
  try {return await op(ctx);}
  catch(e) {
   if(e instanceof PartnerError)return apiError(e.status,e.reason,e.message,e.detail);
   console.error('Partner API error',e);return apiError(500,'server_error','Something went wrong on our side. Retry with the same Idempotency-Key.');
  }
 };
 if(!opts.write){const r=await run();return {response:await finish(r,null,rate),wrote:false};}
 const idem=request.headers.get('idempotency-key')?.trim()??'';
 if(!idem||idem.length>255||!/^[\x21-\x7e]+$/.test(idem))return {response:await finish(apiError(400,'missing_idempotency_key','Every write needs an Idempotency-Key header (for example the order id from your checkout), up to 255 characters.'),null,rate),wrote:false};
 const hash=sha256(`${request.method} ${url.pathname}\n${raw}`);
 // Claim the key first (status 0 means "in progress"). A claim left behind by a crashed request is taken over
 // after a minute; otherwise the stored response is replayed.
 let claimed=(await db.query(`INSERT INTO api_idempotency(organisation_id,mode,key,request_hash,status,response) VALUES($1,$2,$3,$4,0,'{}') ON CONFLICT DO NOTHING RETURNING key`,[key.orgId,key.mode,idem,hash])).length>0;
 if(!claimed) {
  const [prior]=await db.query<{request_hash:string;status:number;response:unknown;stale:boolean}>(`SELECT request_hash,status,response,created_at<now()-interval '60 seconds' AS stale FROM api_idempotency WHERE organisation_id=$1 AND mode=$2 AND key=$3`,[key.orgId,key.mode,idem]);
  if(prior&&prior.request_hash!==hash)return {response:await finish(apiError(422,'idempotency_mismatch','This Idempotency-Key was already used with a different request.'),idem,rate),wrote:false};
  if(prior&&prior.status>0)return {response:await finish({status:prior.status,body:prior.response},idem,{...rate,'Idempotent-Replayed':'true'},true),wrote:false};
  claimed=(await db.query(`UPDATE api_idempotency SET created_at=now() WHERE organisation_id=$1 AND mode=$2 AND key=$3 AND status=0 AND created_at<now()-interval '60 seconds' RETURNING key`,[key.orgId,key.mode,idem])).length>0;
  if(!claimed)return {response:await finish(apiError(409,'idempotency_in_progress','A request with this Idempotency-Key is still being processed. Retry in a few seconds.'),idem,rate),wrote:false};
 }
 const r=await run();
 if(r.status>=500)await db.query('DELETE FROM api_idempotency WHERE organisation_id=$1 AND mode=$2 AND key=$3',[key.orgId,key.mode,idem]);
 else await db.query('UPDATE api_idempotency SET status=$4,response=$5::jsonb,created_at=now() WHERE organisation_id=$1 AND mode=$2 AND key=$3',[key.orgId,key.mode,idem,r.status,JSON.stringify(r.body)]);
 return {response:await finish(r,idem,rate),wrote:r.status<300};
}
// ---------------------------------------------------------------- endpoints
const found=(v:unknown)=>v?{status:200,body:v}:apiError(404,'not_found','Enrolment not found.');
export const api={
 products:(async c=>({status:200,body:{object:'list',data:(await listProducts(c.db,c.orgId)).map(p=>({id:p.product,object:'product',exam:{slug:p.examSlug,name:p.exam},months:p.months,exam_live:p.live}))}})) as Op,
 seats:(async c=>{const s=await seatBalances(c.db,c.orgId,c.sandbox);
  return {status:200,body:{object:'list',billing:s.billing,low_balance_at:s.lowBalanceAt,credit:s.credit&&{limit_seats:s.credit.limit,used_this_month:s.credit.usedThisMonth},
   data:s.balances.map(b=>({product:b.product,available:b.available,assigned:b.assigned,activated:b.activated,packs:b.packs.map(p=>({id:p.id,seats:p.seats,remaining:p.remaining,expires_at:p.expiresAt}))}))}};}) as Op,
 listEnrollments:(async c=>{const q=c.url.searchParams;const r=await listEnrollments(c.db,c.orgId,{sandbox:c.sandbox,email:q.get('email')??'',status:q.get('status')??'',limit:Number(q.get('limit')??50),offset:Number(q.get('offset')??0)});
  return {status:200,body:{object:'list',total:r.total,data:r.data}};}) as Op,
 createEnrollment:(async c=>{
  const product=await resolveProduct(c.db,c.orgId,c.body.product);
  const e=await createEnrollment(c.db,c.orgId,{...product,email:typeof c.body.email==='string'?c.body.email:'',source:'api',sandbox:c.sandbox,externalRef:typeof c.body.external_ref==='string'?c.body.external_ref:null});
  return {status:201,body:e};}) as Op,
 getEnrollment:(id:string)=>(async c=>found(await getEnrollment(c.db,c.orgId,c.sandbox,id))) as Op,
 changeEnrollment:(id:string)=>(async c=>({status:200,body:await changeEnrollment(c.db,c.orgId,c.sandbox,id,{months:c.body.months,extendMonths:c.body.extend_months})})) as Op,
 revokeEnrollment:(id:string)=>(async c=>{const r=await revokeEnrollment(c.db,c.orgId,c.sandbox,id);return {status:200,body:{...r.enrollment,seat_returned:r.seatReturned}};}) as Op,
 progress:(id:string)=>(async c=>({status:200,body:await enrollmentProgress(c.db,c.orgId,c.sandbox,id)})) as Op,
};
