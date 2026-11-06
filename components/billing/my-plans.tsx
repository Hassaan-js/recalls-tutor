'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {toggleAutoRenew} from '@/app/billing/actions';
// BILL-3: auto-renew is on by default and can be switched off at any time; access lasts to the period end.
export function AutoRenewToggle({subscriptionId,autoRenew,disabled}:{subscriptionId:string;autoRenew:boolean;disabled:boolean}) {
 const router=useRouter();const[busy,start]=useTransition();const[error,setError]=useState('');
 return <div className="plan-renew"><label><input type="checkbox" checked={autoRenew} disabled={disabled||busy} onChange={e=>{const next=e.target.checked;start(async()=>{const r=await toggleAutoRenew(subscriptionId,next);setError(r.error??'');router.refresh();});}}/>Auto-renew {busy?'(saving…)':autoRenew?'on':'off'}</label>{error&&<p className="practice-feedback practice-error" role="alert">{error}</p>}</div>;
}
