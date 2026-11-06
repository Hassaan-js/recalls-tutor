// Vercel build: on a production deployment, apply database migrations first, then build. Preview deployments only
// build, so they can never change the production database. Set MIGRATE_ON_BUILD=false to skip migrations.
import {spawnSync} from 'node:child_process';
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:'inherit',shell:process.platform==='win32'});if(r.status!==0)process.exit(r.status??1);};
if(process.env.VERCEL_ENV==='production'&&process.env.MIGRATE_ON_BUILD!=='false'){
 if(!process.env.DATABASE_URL){console.error('DATABASE_URL is not set for Production. Add it in Vercel → Settings → Environment Variables.');process.exit(1);}
 console.log('Applying database migrations…');run('npx',['tsx','scripts/migrate.ts']);
}
run('npx',['next','build']);
