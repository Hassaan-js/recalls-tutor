import type {Database} from './db/client';
import {MIGRATIONS} from './db/migrate';
// Deployment readiness: which services are configured, without revealing any secret. Used by /api/health
// (when called with the cron secret) and by `pnpm readiness` before and after the first deploy.
export type Check={name:string;ok:boolean;required:boolean;detail:string};
const set=(k:string)=>Boolean(process.env[k]?.trim());
export async function readiness(db:Database|null):Promise<{ready:boolean;checks:Check[]}> {
 const site=process.env.NEXT_PUBLIC_SITE_URL??'',auth=process.env.BETTER_AUTH_URL??'',stripe=process.env.STRIPE_SECRET_KEY??'';
 const checks:Check[]=[
  {name:'Database',required:true,ok:set('DATABASE_URL'),detail:set('DATABASE_URL')?'DATABASE_URL is set':'Add the hosted Postgres connection string (pooled) as DATABASE_URL'},
  {name:'Site address',required:true,ok:site.startsWith('https://'),detail:site.startsWith('https://')?site:'NEXT_PUBLIC_SITE_URL must be the https address of the site'},
  {name:'Sign-in address',required:true,ok:auth.startsWith('https://'),detail:auth.startsWith('https://')?auth:'BETTER_AUTH_URL must be the same https address'},
  {name:'Sign-in secret',required:true,ok:(process.env.BETTER_AUTH_SECRET??'').length>=32,detail:'BETTER_AUTH_SECRET: a random value of 32 characters or more'},
  {name:'Email',required:true,ok:set('RESEND_API_KEY')&&set('AUTH_EMAIL_FROM'),detail:'RESEND_API_KEY and AUTH_EMAIL_FROM (an address on the verified domain)'},
  {name:'Stripe',required:true,ok:stripe.startsWith('sk_live_')||(stripe.startsWith('sk_test_')&&process.env.STRIPE_ALLOW_TEST_MODE==='true'),detail:stripe.startsWith('sk_live_')?'Live key':stripe.startsWith('sk_test_')?'Test key (staging only, needs STRIPE_ALLOW_TEST_MODE=true)':'STRIPE_SECRET_KEY is missing'},
  {name:'Stripe webhook',required:true,ok:set('STRIPE_WEBHOOK_SECRET'),detail:'STRIPE_WEBHOOK_SECRET from the endpoint /api/webhooks/stripe'},
  {name:'Scheduled jobs',required:true,ok:(process.env.CRON_SECRET??'').length>=24,detail:'CRON_SECRET: a random value of 24 characters or more (Vercel Cron sends it)'},
  {name:'Claude API',required:true,ok:set('ANTHROPIC_API_KEY'),detail:'ANTHROPIC_API_KEY for AI drafting, scanned files, fixes and the tutor on the server'},
  {name:'Google sign-in',required:false,ok:set('GOOGLE_CLIENT_ID')&&set('GOOGLE_CLIENT_SECRET'),detail:'Optional: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'},
  {name:'Analytics',required:false,ok:set('NEXT_PUBLIC_GA_ID'),detail:'Optional: NEXT_PUBLIC_GA_ID'},
 ];
 if(db){
  try{
   const [m]=await db.query<{n:number;last:string|null}>(`SELECT count(*)::int AS n,max(version) AS last FROM schema_migrations`);
   checks.push({name:'Migrations',required:true,ok:m.last===MIGRATIONS.at(-1)&&m.n===MIGRATIONS.length,detail:`${m.n} of ${MIGRATIONS.length} applied, latest ${m.last??'none'}`});
   const [a]=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM app_users a JOIN auth_users u ON u.id=a.auth_id WHERE a.role='super_admin' AND u.two_factor_enabled`);
   checks.push({name:'Super Admin',required:true,ok:a.n>0,detail:a.n?`${a.n} with two-step sign-in`:'Sign up, verify, then run db:bootstrap-admin and turn on two-step sign-in'});
   const [p]=await db.query<{n:number;synced:number}>(`SELECT count(*)::int AS n,count(stripe_price_id)::int AS synced FROM plans WHERE active`);
   checks.push({name:'Prices',required:false,ok:p.n>0&&p.synced===p.n,detail:p.n?`${p.synced} of ${p.n} prices in Stripe`:'No prices set yet (Studio → Billing)'});
  }catch{checks.push({name:'Database connection',required:true,ok:false,detail:'Could not query the database'});}
 }
 return {ready:checks.every(c=>c.ok||!c.required),checks};
}
