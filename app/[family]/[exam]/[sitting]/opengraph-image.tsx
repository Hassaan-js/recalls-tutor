import {getDatabase} from '@/lib/db/client';
import {getSittingPage} from '@/lib/services/site';
import {shareImage,shareSize} from '@/components/seo/share-image';
export const size=shareSize;export const contentType='image/png';export const alt='Recalls Tutor sitting recalls';
export default async function Image({params}:{params:Promise<{family:string;exam:string;sitting:string}>}) {
 const {family,exam,sitting}=await params;const page=await getSittingPage(getDatabase(),family,exam,sitting);
 return shareImage(page?`${page.exam.name} · recalls`:'Recalls Tutor',page?page.sitting.label:'Exam sitting',page&&page.sitting.questions?`${page.sitting.questions} reviewed questions from this sitting`:'Reviewed recall questions');
}
