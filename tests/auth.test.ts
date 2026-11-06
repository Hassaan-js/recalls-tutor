import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {embeddedDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {createAuth} from '../lib/auth/server';
import {actorFromSession,staffAccess} from '../lib/auth/actor';
import type {AuthMail} from '../lib/auth/mail';

function totp(secret:string) {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
 const bits=[...secret.toUpperCase().replace(/=/g,'')].map(char=>alphabet.indexOf(char).toString(2).padStart(5,'0')).join('');
 const key=Buffer.from((bits.match(/.{8}/g)??[]).map(byte=>parseInt(byte,2)));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',key).update(counter).digest();const offset=digest[digest.length-1]&15;
 return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
test('Better Auth lifecycle: verify, sign in, permissions, MFA, recovery, revocation and CSRF',async()=>{
 const db=embeddedDatabase(new PGlite());
 const messages:AuthMail[]=[];const origin='http://localhost:3000';
 const auth=createAuth(db,{secret:randomBytes(48).toString('base64url'),baseURL:origin,sendMail:async mail=>{messages.push(mail);},rateLimit:false});
 const jar=new Map<string,string>();
 async function call(path:string,body?:unknown,requestOrigin=origin) {
  const response=await auth.handler(new Request(new URL(path.startsWith('/api/')?path:`/api/auth${path}`,origin),{
   method:body===undefined?'GET':'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }));
  for(const cookie of response.headers.getSetCookie()) {const pair=cookie.split(';')[0];const index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}
  const text=await response.text();
  return {status:response.status,data:text?JSON.parse(text):null,response};
 }
 try {
  await migrate(db);
  assert.equal(staffAccess(null),'unauthenticated');
  assert.equal((await call('/get-session')).data,null);
  const signup=await call('/sign-up/email',{name:'Test Student',email:'student@example.test',password:'A-test-password-827!',role:'super_admin',emailVerified:true,callbackURL:'/dashboard'});
  assert.equal(signup.status,200);
  assert.equal(signup.data.user.emailVerified,false);
  assert.equal((await call('/sign-in/email',{email:'student@example.test',password:'A-test-password-827!'})).status,403);
  assert.ok(messages.length>=1);
  const verificationUrl=messages[0].text.match(/https?:\/\/\S+/)![0];
  const verifyResponse=await auth.handler(new Request(verificationUrl));
  assert.ok([200,302].includes(verifyResponse.status));
  assert.equal((await call('/sign-in/email',{email:'student@example.test',password:'wrong-password'})).status,401);
  assert.equal((await call('/sign-in/email',{email:'student@example.test',password:'A-test-password-827!'})).status,200);
  const session=(await call('/get-session')).data;
  assert.ok(session.user.emailVerified);
  const actor=await actorFromSession(db,session);assert.ok(actor);
  assert.equal(actor.role,'student');assert.equal(staffAccess(actor),'forbidden');
  assert.equal((await call('/update-user',{role:'super_admin'})).status,400);
  assert.equal((await actorFromSession(db,(await call('/get-session')).data))?.role,'student');
  await db.query("UPDATE app_users SET role='super_admin' WHERE id=$1",[actor.id]);
  assert.equal(staffAccess(await actorFromSession(db,(await call('/get-session')).data)),'mfa_required');
  const enable=await call('/two-factor/enable',{password:'A-test-password-827!',method:'totp'});
  assert.equal(enable.status,200);
  const secret=new URL(enable.data.totpURI).searchParams.get('secret')!;
  assert.equal((await call('/two-factor/verify-totp',{code:totp(secret)})).status,200);
  assert.equal(staffAccess(await actorFromSession(db,(await call('/get-session')).data)),'allowed');
  const priorCookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
  await call('/sign-out',{});
  assert.equal((await call('/get-session')).data,null);
  const revoked=await auth.handler(new Request(origin+'/api/auth/get-session',{headers:{Cookie:priorCookie}}));
  assert.equal(await revoked.json(),null);
  const signin=await call('/sign-in/email',{email:'student@example.test',password:'A-test-password-827!'});
  assert.equal(signin.data.twoFactorRedirect,true);
  assert.equal((await call('/get-session')).data,null);
  assert.equal((await call('/two-factor/verify-backup-code',{code:enable.data.backupCodes[0]})).status,200);
  assert.ok((await call('/get-session')).data?.user);
  const goodCookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
  const badOrigin=await call('/sign-out',{},'https://attacker.example');assert.equal(badOrigin.status,403);
  const reset=await call('/request-password-reset',{email:'student@example.test',redirectTo:origin+'/reset-password'});
  assert.equal(reset.status,200);
  const resetMail=messages.findLast(mail=>mail.subject.startsWith('Reset'))!;
  const resetLink=resetMail.text.match(/https?:\/\/\S+/)![0];
  const redirectResponse=await auth.handler(new Request(resetLink));
  const token=new URL(redirectResponse.headers.get('location')!).searchParams.get('token');assert.ok(token);
  assert.equal((await call('/reset-password',{token,newPassword:'A-replacement-password-829!'})).status,200);
  const afterReset=await auth.handler(new Request(origin+'/api/auth/get-session',{headers:{Cookie:goodCookie}}));
  assert.equal(await afterReset.json(),null);
  assert.ok((await call('/reset-password',{token,newPassword:'Another-replacement-829!'})).status>=400);
  const unknown=await call('/request-password-reset',{email:'unknown@example.test',redirectTo:origin+'/reset-password'});
  assert.equal(unknown.status,reset.status);assert.deepEqual(unknown.data,reset.data);
  const [credential]=await db.query<{password:string}>('SELECT password FROM auth_accounts WHERE user_id=$1',[session.user.id]);
  assert.notEqual(credential.password,'A-replacement-password-829!');
  assert.ok(credential.password.length>64);
 } finally {await db.close();}
});

test('auth HTTP rate limiting survives across auth instances through the database',async()=>{
 const db=embeddedDatabase(new PGlite());
 try {
  await migrate(db);
  const options={secret:randomBytes(48).toString('base64url'),baseURL:'http://localhost:3000',sendMail:async()=>{}};
  const first=createAuth(db,options),second=createAuth(db,options);
  const statuses=[];
  for(let i=0;i<6;i++) {
   const response=await (i<3?first:second).handler(new Request('http://localhost:3000/api/auth/request-password-reset',{
    method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json','x-forwarded-for':'192.0.2.1'},
    body:JSON.stringify({email:'nobody@example.test',redirectTo:'http://localhost:3000/reset-password'}),
   }));statuses.push(response.status);
  }
  assert.equal(statuses[5],429);
 } finally {await db.close();}
});
