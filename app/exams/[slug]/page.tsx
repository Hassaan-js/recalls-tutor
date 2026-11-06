import {notFound,permanentRedirect} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {examPath} from '@/lib/services/site';
export const dynamic='force-dynamic';
// Old /exams/{slug} addresses move permanently to the canonical /{family}/{exam}-recalls pages.
export default async function LegacyExamPage({params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params;
 const [exam]=await getDatabase().query<{family:string;exam:string}>('SELECT f.slug AS family,e.seo_slug AS exam FROM exams e JOIN exam_families f ON f.id=e.family_id WHERE e.slug=$1',[slug]);
 if(!exam)notFound();
 permanentRedirect(examPath(exam.family,exam.exam));
}
