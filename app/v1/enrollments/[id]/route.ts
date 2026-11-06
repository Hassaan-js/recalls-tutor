import {v1} from '@/lib/integrations/partner-jobs';
import {api} from '@/lib/services/partner-api';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
// GET status and dates; PATCH changes duration (invited) or extends (active); DELETE revokes.
export async function GET(request:Request,{params}:Context) {return v1(request,api.getEnrollment((await params).id));}
export async function PATCH(request:Request,{params}:Context) {return v1(request,api.changeEnrollment((await params).id),true);}
export async function DELETE(request:Request,{params}:Context) {return v1(request,api.revokeEnrollment((await params).id),true);}
