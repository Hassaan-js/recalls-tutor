'use server';
import {redirect} from 'next/navigation';
import {getDatabase} from '@/lib/db/client';
import {setMarketingEmails,validOffersToken} from '@/lib/services/lifecycle';
// Stop offer emails from the link in an email. Service emails (receipts, renewal and trial notices) continue.
export async function stopOffers(form:FormData) {
 const u=String(form.get('u')??''),t=String(form.get('t')??'');
 if(!validOffersToken(u,t))redirect('/email/offers?invalid=1');
 await setMarketingEmails(getDatabase(),u,false);
 redirect('/email/offers?done=1');
}
