import {v1} from '@/lib/integrations/partner-jobs';
import {api} from '@/lib/services/partner-api';
export const dynamic='force-dynamic';
// GET /v1/seats: seat balance per product (test seats for a sandbox key).
export async function GET(request:Request) {return v1(request,api.seats);}
