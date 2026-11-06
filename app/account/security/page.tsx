import { redirect } from 'next/navigation';
import { SecurityForm } from '@/components/auth/forms';
import { getCurrentActor } from '@/lib/auth/session';
import { StudentShell } from '@/components/practice/shell';
import '@/app/auth.css';
export const metadata = { title: 'Account security', robots: { index: false } };
export default async function SecurityPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect('/sign-in');
  return <StudentShell active="account" title="Account security" actor={actor}><div className="app-column">
    <div className="app-title"><div><h1>Account security</h1><p className="app-sub">{actor.twoFactorEnabled ? 'Two-factor authentication is on for ' : 'Add two-factor authentication to '}{actor.email}.</p></div></div>
    <section className="panel white security-panel"><SecurityForm enabled={actor.twoFactorEnabled} email={actor.email} /></section>
  </div></StudentShell>;
}
