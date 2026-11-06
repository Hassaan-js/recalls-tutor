import {v1} from '@/lib/integrations/partner-jobs';
import {api} from '@/lib/services/partner-api';
export const dynamic='force-dynamic';
// GET /v1/enrollments/{id}/progress: only for students who agreed to share progress with this partner.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {return v1(request,api.progress((await params).id));}
