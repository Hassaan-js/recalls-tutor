import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { SuspendedNotice } from '@/components/auth/suspended';
import { StudentShell } from '@/components/practice/shell';
export const metadata = { title: 'Your dashboard', robots: { index: false } };
// Students land on their practice home; staff get a short way into the Studio as well.
export default async function DashboardPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect('/sign-in');
  if (actor.suspended) return <SuspendedNotice />;
  if (!actor.emailVerified) redirect('/verify-email');
  if (actor.role === 'student') redirect('/practice');
  return <StudentShell active="practice" title="Dashboard" actor={actor}><div className="app-column">
    <div className="app-title"><div><h1 className="app-greeting">{actor.name.split(/\s+/)[0]}, the Studio is ready.</h1><p className="app-sub">Signed in as {actor.role.replaceAll('_', ' ')}.</p></div><Link className="practice-button" href="/studio">Open the Studio</Link></div>
    <div className="grid12 tiles">
      <section className="panel span6"><div className="panel-head"><h2>Content</h2></div><p className="empty">Upload recalls, review drafts, build papers and edit the website.</p><div className="practice-shortcuts"><Link className="practice-ghost" href="/studio">Questions</Link><Link className="practice-ghost" href="/studio/papers">Papers</Link><Link className="practice-ghost" href="/studio/catalogue">Exam catalogue</Link></div></section>
      <section className="panel span6"><div className="panel-head"><h2>Practice</h2></div><p className="empty">See the student view for any exam you have access to.</p><div className="practice-shortcuts"><Link className="practice-ghost" href="/practice">Open practice</Link></div></section>
    </div></div></StudentShell>;
}
