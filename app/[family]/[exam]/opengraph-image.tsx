import {getDatabase} from '@/lib/db/client';
import {getExamPage} from '@/lib/services/site';
import {shareImage,shareSize} from '@/components/seo/share-image';
export const size=shareSize;export const contentType='image/png';export const alt='Recalls Tutor exam recalls';
export default async function Image({params}:{params:Promise<{family:string;exam:string}>}) {
 const {family,exam}=await params;const page=await getExamPage(getDatabase(),family,exam);
 return shareImage(page?.familyName??'Recalls Tutor',page?`${page.name} recalls`:'Exam recalls',page&&page.questionCount?`${page.questionCount} reviewed questions, ${page.sittings.length} sittings`:'Reviewed recall questions, every sitting');
}
