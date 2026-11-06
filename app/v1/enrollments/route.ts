import {v1} from '@/lib/integrations/partner-jobs';
import {api} from '@/lib/services/partner-api';
export const dynamic='force-dynamic';
// GET /v1/enrollments lists enrolments; POST assigns a seat to a student email (Idempotency-Key required).
export async function GET(request:Request) {return v1(request,api.listEnrollments);}
export async function POST(request:Request) {return v1(request,api.createEnrollment,true);}
