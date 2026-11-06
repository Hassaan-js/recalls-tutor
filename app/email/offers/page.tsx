import Link from 'next/link';
import {stopOffers} from './actions';
export const metadata={title:'Offer emails',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
// A button rather than a plain link, so email scanners that open links never unsubscribe anyone.
export default async function OffersPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const q=await props.searchParams;const one=(v:unknown)=>typeof v==='string'?v:'';
 return <main id="main" className="hb"><section className="hb-sec wrap"><div className="email-pref">
  <h1>Offer emails</h1>
  {q.done?<p>Done. We won’t send you offers by email. Receipts, renewal reminders and trial notices still arrive. You can turn offers back on in your <Link className="hb-link" href="/account/profile">profile</Link>.</p>
  :q.invalid||!one(q.u)||!one(q.t)?<p>This link isn’t valid. You can change offer emails in your <Link className="hb-link" href="/account/profile">profile</Link> after signing in.</p>
  :<><p>Stop emails with discounts and offers? Receipts, renewal reminders and trial notices will still arrive.</p>
   <form action={stopOffers}><input type="hidden" name="u" value={one(q.u)}/><input type="hidden" name="t" value={one(q.t)}/><button className="hb-btn primary">Stop offer emails</button></form></>}
 </div></section></main>;
}
