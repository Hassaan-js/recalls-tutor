import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {exportNotes} from '@/lib/services/review';
export const dynamic='force-dynamic';
// STU-13: notes export. Only the student's own words, never question content (PROT-4).
export async function GET() {
 const actor=await getCurrentActor();
 if(!actor||!actor.emailVerified||actor.suspended)return new Response('Sign in to download your notes.',{status:401});
 const text=await exportNotes(getDatabase(),actor.id);
 return new Response(text,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="recalls-tutor-notes-${new Date().toISOString().slice(0,10)}.md"`,'Cache-Control':'no-store'}});
}
