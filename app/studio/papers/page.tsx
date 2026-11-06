import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {getCatalogueAdmin,topicOptions} from '@/lib/services/catalogue-admin';
import {getPaperAdmin,listPapersAdmin,paperCandidates} from '@/lib/services/papers';
import {NewPaper,PaperEditor,ProposePapers} from '@/components/studio/papers';
import {StudioShell} from '@/components/studio/nav';
import '../studio.css';
export const metadata={title:'Papers'};
export const dynamic='force-dynamic';
const uuid=/^[0-9a-f-]{36}$/i;
export default async function PapersPage(props:PageProps<'/studio/papers'>) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor)return <StudioShell current="papers" actor={actor} title="Staff access required."/>;
 const shell={current:'papers',title:'Papers',sub:'Build complete recall papers and mocks from published questions.'} as const;
 if(actor.role==='reviewer')return <StudioShell {...shell} actor={actor}><p className="studio-help">Papers are built by content managers.</p></StudioShell>;
 const db=getDatabase();const query=await props.searchParams;
 const str=(v:unknown)=>typeof v==='string'?v:'';const paperId=str(query.paper),filter={sittingId:uuid.test(str(query.sitting))?str(query.sitting):'',topicId:uuid.test(str(query.topic))?str(query.topic):'',text:str(query.q)};
 const [papers,catalogue]=await Promise.all([listPapersAdmin(db,actor.id),getCatalogueAdmin(db,actor.id)]);
 const paper=uuid.test(paperId)?await getPaperAdmin(db,actor.id,paperId):null;
 const exam=paper?catalogue.find(e=>e.id===paper.examId):null;
 const candidates=paper&&!paper.locked?await paperCandidates(db,actor.id,paper.id,{sittingId:filter.sittingId||null,topicId:filter.topicId||null,text:filter.text}):[];
 return <StudioShell {...shell} actor={actor}><div className="studio-workspace"><aside className="studio-sidebar">
  <details className="studio-intake" open={!papers.length}><summary>New paper</summary><NewPaper exams={catalogue.map(e=>({id:e.id,name:e.name,sittings:e.sittings.map(s=>({id:s.id,label:s.label})),defaultMinutes:e.settings.durationMinutes??null}))}/></details>
  <details className="studio-intake"><summary>Propose papers per sitting</summary><ProposePapers exams={catalogue.map(e=>({id:e.id,name:e.name}))}/></details>
  <h2>All papers <small>{papers.length}</small></h2>{papers.length?<ul className="studio-queue">{papers.map(p=><li key={p.id}><Link href={`/studio/papers?paper=${p.id}`} aria-current={p.id===paper?.id?'page':undefined}><span>{p.examName}{p.sitting?` · ${p.sitting}`:''}</span><strong>{p.title}</strong><span>{p.status} · {p.questions} questions · {p.minutes} min</span></Link></li>)}</ul>:<p className="studio-help">No papers yet.</p>}</aside>
  <section className="studio-main" aria-label="Paper">{paper&&exam?<PaperEditor key={paper.id} paper={paper} candidates={candidates} sittings={exam.sittings.map(s=>({id:s.id,label:s.label}))} topics={await topicOptions(db,exam.id)} filter={filter}/>:<div className="studio-empty"><h2>{paperId?'Paper not found.':'Choose or create a paper.'}</h2><p>Add published questions, set the order, lock it, then publish. Students sit published papers in Exam Mode with the paper’s time limit.</p></div>}</section></div></StudioShell>;
}
