import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
export type AuthMail = {to:string;subject:string;text:string};
export async function sendAuthMail(message:AuthMail) {
 if (process.env.AUTH_MAIL_MODE === 'file' && process.env.NODE_ENV !== 'production') {
  const directory=path.join(process.cwd(),'.local/mail');
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,`${Date.now()}-${randomUUID()}.json`),JSON.stringify(message,null,2),{mode:0o600});
  return;
 }
 if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) throw new Error('Authentication email delivery is not configured.');
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({from:process.env.AUTH_EMAIL_FROM,...message}),signal:AbortSignal.timeout(15000),
 });
 if (!response.ok) throw new Error('Authentication email delivery failed.');
}
