import {getDatabase} from '@/lib/db/client';
import {listApiKeys,listApiRequests,listWebhookEndpoints,TEST_SEATS} from '@/lib/services/partners';
import {RATE_LIMIT} from '@/lib/services/partner-api';
import {NotPartner,PartnerShell,partnerContext} from '@/components/partner/shell';
import {DisableWebhook,KeyForm,KeyIpForm,RetryWebhook,RevokeKey,RotateKey,RotateWebhook,WebhookForm} from '@/components/partner/forms';
import {day,when} from '@/components/partner/format';
export const metadata={title:'API and webhooks',robots:{index:false}};
export const dynamic='force-dynamic';
const ENDPOINTS:[string,string][]=[['GET /v1/products','Exams and durations you may assign'],['GET /v1/seats','Seat balance per product'],['POST /v1/enrollments','Give a student a seat by email'],['GET /v1/enrollments','List enrolments (filter by email, status)'],
 ['GET /v1/enrollments/{id}','Status, access dates, activation'],['PATCH /v1/enrollments/{id}','Change duration (invited) or extend (active)'],['DELETE /v1/enrollments/{id}','Revoke; the seat returns if not yet activated'],['GET /v1/enrollments/{id}/progress','Progress, if the student agreed to share it']];
// PART-4: keys (shown once, rotatable, optional IP allow-list), signed webhooks with their delivery history, the
// request log, and a short reference. Managing keys and webhooks needs two-step sign-in.
export default async function PartnerDevelopers(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const ctx=await partnerContext('/partner/developers',await props.searchParams);
 if(!ctx)return <NotPartner/>;
 const db=getDatabase(),base=(process.env.BETTER_AUTH_URL??'https://recallstutor.com').replace(/\/$/,'');
 const [keys,hooks,requests]=await Promise.all([listApiKeys(db,ctx.org.id),listWebhookEndpoints(db,ctx.org.id),listApiRequests(db,ctx.org.id,100)]);
 const live=keys.filter(k=>!k.revokedAt);
 const keyState=(k:typeof keys[number])=>k.revokedAt?'Revoked':k.suspendedAt?'Suspended by Recalls Tutor':k.expiresAt?(new Date(k.expiresAt)>new Date()?`Rotated, stops ${when(k.expiresAt)}`:'Expired'):'Active';
 return <PartnerShell ctx={ctx} current="developers" title="API and webhooks" sub="Connect your course checkout so students get access automatically. Sandbox keys use test seats and never create accounts or send emails.">
  {!ctx.org.mfa&&<p className="partner-banner" role="status">Turn on two-step sign-in in <a href="/account/security">Account security</a> to create API keys and webhooks.</p>}
  <section className="catalogue-panel" aria-labelledby="keys-title"><h2 id="keys-title">API keys</h2>
   {live.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Key</th><th scope="col">Status</th><th scope="col">Last used</th><th scope="col">IP allow-list</th><th scope="col"><span className="studio-sr-only">Actions</span></th></tr></thead><tbody>
    {live.map(k=><tr key={k.id}><th scope="row"><code>{k.prefix}…</code><span className="studio-help team-email">{k.mode==='live'?'Live':'Sandbox'}{k.label?` · ${k.label}`:''} · created {day(k.createdAt)}</span></th><td>{keyState(k)}</td><td>{when(k.lastUsedAt)}</td>
     <td>{ctx.org.mfa?<KeyIpForm orgId={ctx.org.id} keyId={k.id} current={k.ipAllow}/>:k.ipAllow.length?k.ipAllow.join(', '):'Any'}</td>
     <td>{!k.suspendedAt&&!k.expiresAt&&ctx.org.mfa&&<RotateKey orgId={ctx.org.id} id={k.id}/>}<RevokeKey orgId={ctx.org.id} id={k.id}/></td></tr>)}</tbody></table></div>
    :<p className="studio-empty">No API keys yet.</p>}
   <h3 className="security-sub">New key</h3><KeyForm orgId={ctx.org.id} liveAllowed={ctx.org.status==='active'} mfa={ctx.org.mfa}/>
  </section>
  <section className="catalogue-panel" aria-labelledby="hooks-title"><h2 id="hooks-title">Webhooks</h2>
   <p className="studio-help">We POST a JSON event to your URL and sign it with <code>Recalls-Signature: t=…,v1=…</code> (HMAC-SHA256 of <code>t.body</code> with your signing secret). Answer with any 2xx. Failed deliveries are retried for about two days.</p>
   {hooks.map(h=><div key={h.id} className="security-row"><p><strong>{h.url}</strong> <span className="studio-help">{h.mode==='live'?'Live':'Sandbox'} · {h.events.join(', ')}</span></p>
    <span className="partner-row-actions">{ctx.org.mfa&&<RotateWebhook orgId={ctx.org.id} id={h.id}/>}<DisableWebhook orgId={ctx.org.id} id={h.id}/></span>
    {h.deliveries.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">Event</th><th scope="col">Sent</th><th scope="col">Result</th><th scope="col"><span className="studio-sr-only">Actions</span></th></tr></thead><tbody>
     {h.deliveries.map(d=><tr key={d.id}><td><code>{d.event}</code></td><td>{when(d.created_at)}</td><td>{d.delivered_at?`Delivered${d.last_status?` (${d.last_status})`:''}`:d.gave_up?`Gave up after ${d.attempts} tries: ${d.last_error??''}`:d.attempts?`Retrying (${d.attempts} ${d.attempts===1?'try':'tries'}): ${d.last_error??''}`:'Queued'}</td>
      <td>{!d.delivered_at&&<RetryWebhook orgId={ctx.org.id} id={d.id}/>}</td></tr>)}</tbody></table></div>:<p className="studio-help">No events sent yet.</p>}</div>)}
   <h3 className="security-sub">Add an endpoint</h3><WebhookForm orgId={ctx.org.id} mfa={ctx.org.mfa}/>
  </section>
  <section className="catalogue-panel" aria-labelledby="log-title"><h2 id="log-title">Request log <small className="studio-help">latest 100 · kept 90 days</small></h2>
   {requests.length?<div className="partner-scroll"><table className="catalogue-table"><thead><tr><th scope="col">When</th><th scope="col">Request</th><th scope="col">Result</th><th scope="col">Key</th><th scope="col">From</th></tr></thead><tbody>
    {requests.map(r=><tr key={r.id}><td>{when(r.at)}</td><td><code>{r.method} {r.path}</code></td><td>{r.status}{r.replayed?' · replayed':''} <span className="studio-help">{r.ms} ms</span></td><td><code>{r.prefix??'—'}</code></td><td>{r.ip??'—'}</td></tr>)}</tbody></table></div>
    :<p className="studio-empty">No requests yet.</p>}
  </section>
  <section className="catalogue-panel partner-docs" aria-labelledby="docs-title"><h2 id="docs-title">Quick reference</h2>
   <p className="studio-help">Base URL <code>{base}/v1</code>. Send <code>Authorization: Bearer &lt;key&gt;</code> and JSON. Every POST, PATCH and DELETE needs an <code>Idempotency-Key</code> header, such as your order id: a retry with the same key returns the first answer and never uses a second seat. Up to {RATE_LIMIT} requests a minute per key. Sandbox keys have {TEST_SEATS} test seats per product.</p>
   <div className="partner-scroll"><table className="catalogue-table"><tbody>{ENDPOINTS.map(([e,d])=><tr key={e}><th scope="row"><code>{e}</code></th><td>{d}</td></tr>)}</tbody></table></div>
   <h3 className="security-sub">Give a student a seat</h3>
   <pre>{`curl ${base}/v1/enrollments \\
  -H "Authorization: Bearer $RECALLS_KEY" \\
  -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"student@example.com","product":"<product id from /v1/products>","external_ref":"order-1001"}'`}</pre>
   <p className="studio-help">The answer is the enrolment, with <code>status</code> <code>active</code> (the student already had an account and has access now) or <code>invited</code> (we emailed them; the seat activates when they sign up with that email). Errors look like <code>{'{"error":{"code":"no_seats","message":"…"}}'}</code>.</p>
  </section>
 </PartnerShell>;
}
