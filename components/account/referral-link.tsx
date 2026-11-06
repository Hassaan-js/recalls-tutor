'use client';
import {useState} from 'react';
// Referrals: the student's own link, with a copy button.
export function ReferralLink({url}:{url:string}) {
 const[copied,setCopied]=useState(false);
 return <span className="way-actions referral-link"><code>{url}</code><button type="button" className="practice-ghost" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);}catch{/* the link stays selectable */}}}>{copied?'Copied':'Copy link'}</button></span>;
}
