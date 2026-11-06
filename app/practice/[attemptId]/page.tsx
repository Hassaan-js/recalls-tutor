import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {SuspendedNotice} from '@/components/auth/suspended';
import {getDatabase} from '@/lib/db/client';
import {getPracticeQuestion} from '@/lib/services/practice';
import {QuestionBudgetError} from '@/lib/services/protection';
import {PracticeSession} from '@/components/practice/session';
import {StudentShell} from '@/components/practice/shell';
export const metadata={title:'Practice session',robots:{index:false}};
export const dynamic='force-dynamic';
// The AI tutor answers within the request.
export const maxDuration=60;
export default async function PracticeSessionPage(props:PageProps<'/practice/[attemptId]'>) {
 const actor=await getCurrentActor();
 if(!actor)redirect('/sign-in');if(!actor.emailVerified)redirect('/verify-email');
 if(actor.suspended)return <SuspendedNotice/>;
 const [{attemptId},query]=await Promise.all([props.params,props.searchParams]);
 const position=Number(typeof query.q==='string'?query.q:'1');
 let blocked:string|null=null;
 const view=await getPracticeQuestion(getDatabase(),actor.id,attemptId,position).catch((error:unknown)=>{if(error instanceof QuestionBudgetError)blocked=error.message;return null;});
 if(blocked)return <StudentShell active="session" title="Short break" actor={actor}><div className="app-column"><div className="app-title"><div><h1>Time for a short break.</h1><p className="app-sub" role="alert">{blocked}</p></div></div><div className="panel"><p className="empty">Your session and answers are saved. <Link className="practice-link" href="/practice">Back to practice</Link></p></div></div></StudentShell>;
 if(!view)return <StudentShell active="session" title="Session not found" actor={actor}><div className="app-column"><div className="app-title"><div><h1>Session not found.</h1><p className="app-sub">This practice session does not exist or belongs to another account.</p></div><Link className="practice-button" href="/practice">Back to practice</Link></div></div></StudentShell>;
 return <StudentShell active="session" title={`Question ${view.attempt.position} of ${view.attempt.total}`} actor={actor}><div className="app-column"><PracticeSession key={position} view={view} watermark={`${actor.email} · ${actor.id.slice(0,8)}`}/></div></StudentShell>;
}
