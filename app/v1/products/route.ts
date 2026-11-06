import {v1} from '@/lib/integrations/partner-jobs';
import {api} from '@/lib/services/partner-api';
export const dynamic='force-dynamic';
// GET /v1/products: the exams and durations this partner may assign.
export async function GET(request:Request) {return v1(request,api.products);}
