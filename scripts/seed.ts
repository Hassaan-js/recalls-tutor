import {getDatabase} from '../lib/db/client';
import {seedCatalogue} from '../lib/db/seed';
import {seedSiteContent} from '../lib/db/seed-site';
async function main() { const db=getDatabase(); try {await seedCatalogue(db); await seedSiteContent(db); console.log('Catalogue and draft site pages seeded. No prices or medical content were invented.');} finally {await db.close();} }
main().catch(()=>{console.error('Seeding failed. Apply migrations first.');process.exitCode=1;});
