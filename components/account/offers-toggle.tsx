'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {setOfferEmails} from '@/app/account/email-actions';
// BILL-7 / TRIAL-2: offers (win-back and trial discounts) can be turned off; service emails always arrive.
export function OffersToggle({on}:{on:boolean}) {
 const router=useRouter();const[busy,start]=useTransition();const[error,setError]=useState('');
 return <span className="way-actions"><label className="partner-share"><input type="checkbox" checked={on} disabled={busy} onChange={e=>{const next=e.target.checked;start(async()=>{const r=await setOfferEmails(next);setError(r.error??'');if(!r.error)router.refresh();});}}/> Send me offers by email</label>
  {error&&<span className="practice-error" role="alert">{error}</span>}</span>;
}
