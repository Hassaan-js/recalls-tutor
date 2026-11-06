'use client';
import {useActionState} from 'react';
import {changeRole} from '@/app/studio/admin-actions';
const ROLES:[string,string][]=[['reviewer','Reviewer'],['content_manager','Content manager'],['super_admin','Super Admin'],['student','Student (remove from team)']];
// ADM-4: a Super Admin adds an existing account to the team or changes its role. The account is signed out.
export function RoleForm({userId,current}:{userId?:string;current?:string}) {
 const[state,action,pending]=useActionState(changeRole,{});
 return <form action={action} className={userId?'team-row-form':'students-form'}>
  {userId?<input type="hidden" name="userId" value={userId}/>:<label className="studio-field">Email of an existing account<input name="email" type="email" required maxLength={254} placeholder="They create an account first, then you add them"/></label>}
  <span className="catalogue-inline team-inline"><label className="studio-field">{userId?<span className="studio-sr-only">Role</span>:'Role'}<select name="role" defaultValue={current&&current!=='student'?current:'reviewer'}>{ROLES.filter(([v])=>userId||v!=='student').map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <button className="studio-button studio-button-secondary" disabled={pending}>{pending?'Saving…':userId?'Change role':'Add to team'}</button></span>
  {state.error&&<p className="studio-feedback studio-error" role="alert">{state.error}</p>}{state.success&&<p className="studio-feedback" role="status">{state.success}</p>}
 </form>;
}
