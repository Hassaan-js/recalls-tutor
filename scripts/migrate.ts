import {getDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
async function main() { const db=getDatabase(); try {await migrate(db); console.log('Migrations applied.');} finally {await db.close();} }
main().catch((error:unknown)=>{const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';console.error(`Migration failed. Check database configuration. Error code: ${/^[A-Z0-9_]{1,32}$/.test(code)?code:'unavailable'}`);process.exitCode=1;});
