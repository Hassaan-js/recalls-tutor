import {getDatabase} from '../lib/db/client';
// One-time operator action. Signup and verification must happen first; never infer admin from first signup.
async function main() {
 const email=process.argv[2]?.trim().toLowerCase();
 if (!email) throw new Error('Provide the verified email of the initial administrator.');
 const db=getDatabase();
 try {await db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(17948302)');
  if ((await tx.query("SELECT id FROM app_users WHERE role='super_admin'")).length) throw new Error('An administrator already exists. Use an authorised role-management workflow.');
  const [user]=await tx.query<{id:string}>('SELECT id FROM auth_users WHERE email=$1 AND email_verified=true',[email]);
  if (!user) throw new Error('A verified account is required.');
  const [actor]=await tx.query<{id:string}>("INSERT INTO app_users(auth_id,role) VALUES($1,'super_admin') ON CONFLICT(auth_id) DO UPDATE SET role='super_admin' RETURNING id",[user.id]);
  await tx.query("INSERT INTO audit_log(actor_id,action,entity_id,after_json) VALUES($1,'bootstrap_admin',$1,'{\"role\":\"super_admin\"}')",[actor.id]);
 }); console.log('Initial administrator assigned. Two-factor enrollment is required before staff access.');}
 finally {await db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Administrator setup failed.');process.exitCode=1;});
