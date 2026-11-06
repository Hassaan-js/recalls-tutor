import type { Database } from '../db/client';
import { claimInvites } from '../services/partners';
export type Actor={id:string;authId:string;name:string;email:string;emailVerified:boolean;role:'student'|'reviewer'|'content_manager'|'super_admin';twoFactorEnabled:boolean;suspended:boolean};
type VerifiedSession={user:{id:string;name:string;email:string;emailVerified:boolean;twoFactorEnabled?:boolean|null}};
// Only call with a database-verified Better Auth session, never a browser-supplied user object.
export async function actorFromSession(db:Database, session:VerifiedSession|null):Promise<Actor|null> {
 if (!session) return null;
 const user=session.user;
 await db.query("INSERT INTO app_users(auth_id,role) VALUES($1,'student') ON CONFLICT(auth_id) DO NOTHING",[user.id]);
 const [account]=await db.query<{id:string;role:Actor['role'];suspended:boolean}>("SELECT id,role,status='suspended' AS suspended FROM app_users WHERE auth_id=$1",[user.id]);
 // PART-3: seats a partner assigned to this email are activated at the first verified sign-in.
 if (user.emailVerified && !account.suspended) await claimInvites(db,account.id,user.email).catch(error=>console.error('Partner seat activation failed',error));
 return {...account,authId:user.id,name:user.name,email:user.email,emailVerified:user.emailVerified,twoFactorEnabled:user.twoFactorEnabled===true};
}
export function staffAccess(actor:Actor|null):'unauthenticated'|'unverified'|'forbidden'|'mfa_required'|'allowed' {
 if (!actor) return 'unauthenticated';
 if (actor.suspended) return 'forbidden';
 if (!actor.emailVerified) return 'unverified';
 if (!['reviewer','content_manager','super_admin'].includes(actor.role)) return 'forbidden';
 if (actor.role==='super_admin' && !actor.twoFactorEnabled) return 'mfa_required';
 return 'allowed';
}
