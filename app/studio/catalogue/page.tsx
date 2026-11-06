import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {staffAccess} from '@/lib/auth/actor';
import {getDatabase} from '@/lib/db/client';
import {getCatalogueAdmin} from '@/lib/services/catalogue-admin';
import {listSittingProposals} from '@/lib/services/proposals';
import {SittingProposals} from '@/components/studio/proposals';
import {ExamSettingsForm,SittingList,TopicList,NewExamForm} from '@/components/studio/catalogue';
import {StudioShell} from '@/components/studio/nav';
import '../studio.css';
export const metadata={title:'Exam catalogue'};
export const dynamic='force-dynamic';
export default async function CataloguePage(props:PageProps<'/studio/catalogue'>) {
 const actor=await getCurrentActor();const access=staffAccess(actor);
 if(access==='unauthenticated')redirect('/sign-in');if(access==='unverified')redirect('/verify-email');if(access==='mfa_required')redirect('/account/security');
 if(access!=='allowed'||!actor)return <StudioShell current="catalogue" actor={actor} title="Staff access required."/>;
 const [exams,query]=await Promise.all([getCatalogueAdmin(getDatabase(),actor.id),props.searchParams]);
 const sittingProposals=actor.role==='reviewer'?[]:await listSittingProposals(getDatabase(),actor.id);
 const selected=exams.find(e=>e.slug===query.exam)??exams[0];
 const manager=actor.role==='content_manager'||actor.role==='super_admin';
 const families=actor.role==='super_admin'?await getDatabase().query<{slug:string;name:string}>('SELECT slug,name FROM exam_families ORDER BY name'):[];
 return <StudioShell current="catalogue" actor={actor} title="Exam catalogue" sub="Timings, pass marks, sittings, topics and trial rules. Nothing here is hard-coded.">
  <SittingProposals items={sittingProposals}/>
  <nav className="catalogue-tabs" aria-label="Exams">{exams.map(e=><Link key={e.id} href={`/studio/catalogue?exam=${e.slug}`} aria-current={e.id===selected?.id?'page':undefined}>{e.name}</Link>)}</nav>
  {selected&&<div className="catalogue-columns" key={selected.id}><section className="catalogue-panel"><h2>{selected.name}</h2><ExamSettingsForm exam={selected} manager={manager} superAdmin={actor.role==='super_admin'}/></section>
   <div><section className="catalogue-panel"><h2>Sittings</h2><p className="studio-help">Each real exam occasion. Questions link to every sitting they were recalled in; year and diet tags come from here.</p><SittingList exam={selected} manager={manager}/></section>
    <section className="catalogue-panel"><h2>Topics</h2><TopicList exam={selected} manager={manager}/></section></div></div>}
  {actor.role==='super_admin'&&<details className="studio-intake catalogue-add-exam"><summary>Add an exam</summary><NewExamForm families={families}/></details>}
 </StudioShell>;
}
