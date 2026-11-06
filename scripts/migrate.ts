import {getDatabase} from '../lib/db/client';
import {migrate} from '../lib/db/migrate';
async function main() { const db=getDatabase(); try {await migrate(db); console.log('Migrations applied.');} finally {await db.close();} }
main().catch(()=>{console.error('Migration failed. Check database configuration.');process.exitCode=1;});
