import {shareImage,shareSize} from '@/components/seo/share-image';
// The default share image for the home page and every page without its own.
export const size=shareSize;export const contentType='image/png';export const alt='Recalls Tutor: recall questions for medical exams, reviewed by our team';
export default function Image() {
 return shareImage('Medical exam recalls','Practise the questions students remember.','Reviewed recall questions, updated after every sitting');
}
