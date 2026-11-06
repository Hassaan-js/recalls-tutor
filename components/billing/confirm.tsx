'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {confirmation} from '@/app/billing/actions';
// The return from Stripe never grants access; this page waits for the webhook to record the payment.
export function ConfirmPayment({sessionId}:{sessionId:string}) {
 const[state,setState]=useState<'pending'|'active'|'not_found'|'slow'>('pending');
 useEffect(()=>{let stopped=false,tries=0;
  const check=async()=>{if(stopped)return;const result=await confirmation(sessionId);if(stopped)return;
   if(result!=='pending'){setState(result);return;}if(++tries>=30){setState('slow');return;}setTimeout(check,2000);};
  check();return()=>{stopped=true;};},[sessionId]);
 if(state==='active')return <><h1>You’re in.</h1><p className="hero-description">Your plan is active. Your progress from any free trial carries over.</p><div className="seo-actions"><Link href="/practice" className="button">Start practising</Link><Link href="/account/plans" className="text-link">View my plans</Link></div></>;
 if(state==='not_found')return <><h1>We couldn’t find that payment.</h1><p className="hero-description">If you were charged, your plan will appear in My plans within a few minutes.</p><Link href="/account/plans" className="text-link">Go to My plans</Link></>;
 if(state==='slow')return <><h1>Payment received. Still confirming.</h1><p className="hero-description">Stripe is taking longer than usual to confirm. Your plan will appear in My plans shortly; you don’t need to pay again.</p><Link href="/account/plans" className="text-link">Go to My plans</Link></>;
 return <><h1>Confirming your payment…</h1><p className="hero-description" role="status">This usually takes a few seconds. Please keep this page open.</p></>;
}
