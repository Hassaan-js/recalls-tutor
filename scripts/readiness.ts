import {getDatabase} from '../lib/db/client';
import {readiness} from '../lib/readiness';
// Run with the production environment loaded: lists what is configured and what is missing. Prints no secrets.
async function main() {
 const db=process.env.DATABASE_URL?getDatabase():null;
 try {const r=await readiness(db);for(const c of r.checks)console.log(`${c.ok?'OK  ':c.required?'MISS':'opt '} ${c.name.padEnd(20)} ${c.detail}`);console.log(r.ready?'\nReady to deploy.':'\nNot ready: fix the MISS lines.');process.exitCode=r.ready?0:1;}
 finally {await db?.close();}
}
main().catch(()=>{console.error('Readiness check failed.');process.exitCode=1;});
