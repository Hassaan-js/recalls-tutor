import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { staffAccess } from '@/lib/auth/actor';
import { getDatabase } from '@/lib/db/client';
import { listExams } from '@/lib/services/catalogue';
import { getStudioQuestion, listStudioQuestions } from '@/lib/services/studio';
import { listStudioJobs } from '@/lib/services/ai-studio';
import { getCatalogueAdmin, topicOptions } from '@/lib/services/catalogue-admin';
import {StudioShell} from '@/components/studio/nav';
import {ReportList} from '@/components/studio/reports';
import {ProposalList} from '@/components/studio/proposals';
import {listProposals} from '@/lib/services/proposals';
import {listPendingComments} from '@/lib/services/discussion';
import {CommentQueue} from '@/components/studio/moderation';
import {listQuestionReports} from '@/lib/services/student';
import { RecallIntake, QuestionEditor, GrantAccess, RecallUpload, JobList } from '@/components/studio/workspace';
import './studio.css';
export const metadata = { title: 'Recall Studio' };
export const dynamic = 'force-dynamic';
// AI jobs started from this page keep running after the response; Vercel Pro allows up to 300 seconds.
export const maxDuration=300;
const STATUS:Record<string,string>={raw:'Raw recall',ai_refined:'AI draft',in_review:'In review',approved:'Approved',published:'Published',retired:'Retired',rejected:'Rejected'};
const FILTERS=[{key:'all',label:'All',statuses:Object.keys(STATUS)},{key:'drafts',label:'Drafts',statuses:['raw','ai_refined']},{key:'review',label:'In review',statuses:['in_review']},{key:'approved',label:'Approved',statuses:['approved']},{key:'published',label:'Published',statuses:['published']},{key:'closed',label:'Closed',statuses:['retired','rejected']}];
export default async function StudioPage({ searchParams }: { searchParams: Promise<{ question?: string; status?: string }> }) {
 const actor=await getCurrentActor(); const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in'); if(access==='unverified')redirect('/verify-email'); if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor)return <StudioShell current="queue" actor={actor} title="Staff access required." sub="Your account cannot access the content workspace."/>;
 const db=getDatabase(); const [exams,questions,jobs,catalogue,selected,reports]=await Promise.all([listExams(db),listStudioQuestions(db,actor.id),listStudioJobs(db,actor.id),getCatalogueAdmin(db,actor.id),searchParams,listQuestionReports(db,actor.id)]);
 const proposals=await listProposals(db,actor.id);
 const pendingComments=await listPendingComments(db,actor.id);
 const question=selected.question?await getStudioQuestion(db,actor.id,selected.question):null;
 const review=questions.filter(q=>q.status==='in_review').length,published=questions.filter(q=>q.status==='published').length;
 const manager=actor.role==='content_manager'||actor.role==='super_admin';
 const examOptions=exams.map(e=>({id:e.id,name:e.name,sittings:catalogue.find(c=>c.id===e.id)?.sittings.map(s=>({id:s.id,label:s.label}))??[]}));
 const taxonomy=question?{topics:await topicOptions(db,question.examId),sittings:catalogue.find(c=>c.id===question.examId)?.sittings.map(s=>({id:s.id,label:s.label}))??[]}:null;
 const count=(group:string)=>questions.filter(q=>FILTERS.find(f=>f.key===group)!.statuses.includes(q.status)).length;
 const filter=FILTERS.find(f=>f.key===selected.status)??FILTERS[0];const shown=questions.filter(q=>filter.statuses.includes(q.status));
 const sub=[review?`${review} waiting for review`:'Nothing waiting for review',reports.length?`${reports.length} student ${reports.length===1?'report':'reports'} open`:null,count('approved')?`${count('approved')} approved, not yet published`:null,`${published} published`].filter(Boolean).join(' · ');
 return <StudioShell current="queue" actor={actor} title="Questions" sub={sub}><div className="studio-workspace"><aside className="studio-sidebar">
  {manager&&<details className="studio-intake" open={!questions.length}><summary>Upload recalls</summary><RecallUpload exams={examOptions}/></details>}
  <h2>Question queue <small>{shown.length}{filter.key!=='all'?` of ${questions.length}`:''}</small></h2>
  <nav className="studio-filters" aria-label="Filter by status">{FILTERS.map(f=>{const n=f.key==='all'?questions.length:count(f.key);return <Link key={f.key} href={f.key==='all'?'/studio':`/studio?status=${f.key}`} aria-current={f.key===filter.key?'page':undefined}>{f.label} <small>{n}</small></Link>;})}</nav>
  {shown.length?<ul className="studio-queue">{shown.map(q=><li key={q.id}><Link href={`/studio?question=${q.id}${filter.key!=='all'?`&status=${filter.key}`:''}`} aria-current={q.id===question?.id?'page':undefined}><span>{q.examName}</span><strong>{q.stem||'Untitled recall draft'}</strong><span className="studio-queue-state"><b className={`is-${q.status}`}>{STATUS[q.status]??q.status}</b> v{q.version}{q.confidence!==null?` · ${q.confidence}% confidence`:''}{q.needsExpert&&q.ai?' · needs expert':''}{reports.some(r=>r.questionId===q.id)?` · ${reports.filter(r=>r.questionId===q.id).length} reported`:''}</span></Link></li>)}</ul>
   :<p className="studio-help">{questions.length?`Nothing is ${filter.label.toLowerCase()} right now.`:manager?'No questions yet. Upload recalls to begin.':'No questions yet. A content manager adds recalls for review.'}</p>}
  <h2>Proposed edits <small>{proposals.length}</small></h2><ProposalList proposals={proposals} canDecide={actor.role==='content_manager'||actor.role==='super_admin'}/>
  <h2>Comments to moderate <small>{pendingComments.length}</small></h2><CommentQueue comments={pendingComments}/>
  <h2>Student reports <small>{reports.length}</small></h2><ReportList reports={question?[...reports.filter(r=>r.questionId===question.id),...reports.filter(r=>r.questionId!==question.id)]:reports} status={filter.key!=='all'?filter.key:undefined}/>
  <h2>AI jobs <small>{jobs.length}</small></h2><JobList jobs={jobs} manager={manager}/>
  {manager&&<details className="studio-intake studio-intake-quiet"><summary>Write a question manually</summary><RecallIntake exams={exams.map(e=>({id:e.id,name:e.name}))}/></details>}{actor.role==='super_admin'&&<details className="studio-intake studio-intake-quiet"><summary>Grant practice access</summary><GrantAccess exams={exams.map(e=>({id:e.id,name:e.name}))}/></details>}
 </aside><section className="studio-main" aria-label="Question workspace">{question?<QuestionEditor key={question.versionId} question={question} manager={manager} taxonomy={taxonomy!}/>:<div className="studio-empty"><h2>{selected.question?'Question not found.':'Every question starts with evidence.'}</h2><p>Select a draft to compare its source, shape the question and move it through human review.</p><ol><li><strong>Upload recalls.</strong> A chat export, PDF or Word file from candidates.</li><li><strong>Claude drafts.</strong> Each recall becomes a five-option question with an explanation and references.</li><li><strong>People review, approve, then publish.</strong> Nothing reaches students before that.</li></ol><p className="studio-help">Drafts and source evidence are private to authorised staff.</p></div>}</section></div></StudioShell>;
}
