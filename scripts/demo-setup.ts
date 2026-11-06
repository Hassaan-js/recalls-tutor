import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {getDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
import {seedCatalogue} from '../lib/db/seed';
import {seedSiteContent} from '../lib/db/seed-site';
import {createAuth} from '../lib/auth/server';
// Prepares the isolated meeting-demo database (.local/demo): staff and student accounts, no questions.
// Run with RECALLS_LOCAL_DB=.local/demo while no dev server is using that database.
async function main() {
 if(process.env.RECALLS_LOCAL_DB!=='.local/demo'||process.env.DATABASE_URL)throw new Error('Run with RECALLS_LOCAL_DB=.local/demo and no DATABASE_URL.');
 if(!process.env.BETTER_AUTH_SECRET)throw new Error('BETTER_AUTH_SECRET is required (it is read from .env.local).');
 const db=getDatabase();
 try {
  await migrate(db);await seedCatalogue(db);await seedSiteContent(db);
  if((await db.query('SELECT 1 FROM app_users LIMIT 1')).length)throw new Error('The demo database already has accounts. Delete .local/demo to start again.');
  let link='';
  const auth=createAuth(db,{secret:process.env.BETTER_AUTH_SECRET,baseURL:process.env.BETTER_AUTH_URL??'http://127.0.0.1:3000',sendMail:async mail=>{link=mail.text.match(/https?:\/\/\S+/)![0];},rateLimit:false});
  const accounts:Record<string,{email:string;password:string}>={};
  for(const [role,name] of [['content_manager','Demo Content Manager'],['reviewer','Demo Reviewer'],['student','Demo Student']]) {
   const email=`demo-${role.replace('_','-')}@recalls-tutor.test`,password=randomBytes(18).toString('base64url');
   const created=await auth.api.signUpEmail({body:{name,email,password}});await auth.handler(new Request(link));
   const [user]=await db.query<{id:string}>('INSERT INTO app_users(auth_id,role) VALUES($1,$2) RETURNING id',[created.user.id,role]);
   if(role==='student')await db.query("INSERT INTO entitlements(user_id,exam_id,source,starts_at,ends_at) SELECT $1,id,'complimentary',now(),now()+interval '30 days' FROM exams WHERE slug='mrcog-part-1'",[user.id]);
   accounts[role]={email,password};
  }
  await writeFile('.local/demo-credentials.json',JSON.stringify(accounts,null,1),{mode:0o600});
  console.log('Demo accounts created. Credentials are in .local/demo-credentials.json (git-ignored).');
 } finally {await db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Demo setup failed.');process.exitCode=1;});
