import {getDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
async function main() { const db=getDatabase(); try {await migrate(db); console.log('Migrations applied.');} finally {await db.close();} }
main().catch((error:unknown)=>{
 const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
 let format='invalid-uri',host='unknown',port='unknown',placeholder='unknown';
 try {const url=new URL(process.env.DATABASE_URL??'');format=['postgres:','postgresql:'].includes(url.protocol)?'postgres-uri':'other-protocol';host=url.hostname.endsWith('.pooler.supabase.com')?'supabase-pooler':url.hostname.endsWith('.supabase.co')?'supabase-direct':'other';port=url.port==='6543'?'transaction-6543':url.port==='5432'?'session-5432':'other';placeholder=/\[|\]|your-password|your_password/i.test(decodeURIComponent(url.password))?'present':'not-detected';}catch{}
 console.error(`Migration failed. Error code: ${/^[A-Z0-9_]{1,32}$/.test(code)?code:'unavailable'}. URI format: ${format}; host category: ${host}; port category: ${port}; password placeholder: ${placeholder}.`);
 process.exitCode=1;
});
