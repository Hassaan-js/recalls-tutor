import {listExams} from '@/lib/services/catalogue';
export const dynamic='force-dynamic';
export async function GET() {
 try {return Response.json({exams:await listExams()});}
 catch {return Response.json({code:'SERVICE_UNAVAILABLE',message:'The catalogue is temporarily unavailable.'},{status:503});}
}
