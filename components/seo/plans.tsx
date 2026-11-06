import Link from 'next/link';
import type {PublicPlan} from '@/lib/services/site';
import {usd} from '@/lib/seo';
import {checkout} from '@/app/billing/actions';
// SEO-7: plans side by side, the 6-month plan highlighted, with price per month and savings.
type Promo={code:string;valid:true;discount:string;expiresAt:string|null}|{code:string;valid:false}|null;
export function PlanSelector({plans,examName,trial,checkoutEnabled,returnPath,promo=null,fromSitting=''}:{plans:PublicPlan[];examName:string;trial:{days:number;questionLimit:number}|null;checkoutEnabled:boolean;returnPath:string;promo?:Promo;fromSitting?:string}) {
 if(!plans.length)return <div className="plan-pending"><h3>Pricing hasn’t been announced</h3><p>3, 6 and 12-month plans for {examName} will be published before paid access opens. No payment is being collected.</p>{trial&&<p><Link href="/practice" className="hb-link">Start a free trial instead</Link></p>}</div>;
 const code=promo?.valid?promo.code:'';
 return <>{promo&&<p className={`plan-promo${promo.valid?'':' bad'}`} role="status">{promo.valid?<>Code <strong>{promo.code}</strong>: {promo.discount}, applied at checkout{promo.expiresAt?`. Use it by ${new Date(promo.expiresAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',timeZone:'UTC'})}`:''}.</>:<>The code <strong>{promo.code}</strong> can’t be used for {examName}. It may have expired or been used up.</>}</p>}
 <ul className="plan-menu">{plans.map(p=><li key={p.id} className={p.highlighted?'best':''}>{p.highlighted&&<span className="flag">Best value</span>}
  <span className="months">{p.months===1?'1 month':`${p.months} months`}</span><span className="price">{usd(p.priceCents)}</span><span className="per">{p.months===1?'Renews monthly':<>{usd(p.perMonthCents)} a month{p.savingsPercent?`, save ${p.savingsPercent}%`:''}</>}</span>
  <span className="incl">Every published {examName} sitting, including new ones added during your plan. Renews automatically; turn it off any time.</span>
  {checkoutEnabled&&p.purchasable?<form action={checkout}><input type="hidden" name="planId" value={p.id}/><input type="hidden" name="returnPath" value={returnPath}/>{code&&<input type="hidden" name="promoCode" value={code}/>}{fromSitting&&<input type="hidden" name="fromSitting" value={fromSitting}/>}<button className="hb-btn primary">Choose {p.months===1?'1 month':`${p.months} months`}</button></form>:<span className="soon">Checkout opens soon</span>}</li>)}</ul>
  <p className="fineprint">Prices in US dollars{code?'':'. Have a promotion code? Enter it on the checkout page'}. Secure checkout by Stripe: cards, Apple Pay, Google Pay and Link. See the <Link href="/refund-policy">refund policy</Link>.</p></>;
}
// Phones only: one pinned action while an exam page scrolls. With no trial and no prices there is nothing to act on, so no bar.
export function StickyBuy({trial,hasPlans,plansHref='#plans'}:{trial:boolean;hasPlans:boolean;plansHref?:string}) {
 if(!trial&&!hasPlans)return null;
 return <div className="sticky-buy" role="region" aria-label="Get started">{trial?<Link href="/practice" className="hb-btn primary">Start free trial</Link>:<Link href={plansHref} className="hb-btn primary">See plans</Link>}</div>;
}
export function TrustBlocks({trial}:{trial:boolean}) {
 return <ul className="trust-grid"><li><strong>Reviewed by people</strong>Every question is checked by a qualified reviewer before students see it.</li>
  <li><strong>Refreshed every sitting</strong>New recalls are added after each exam diet, tagged with the sittings they came from.</li>
  <li><strong>High-yield, made visible</strong>Questions recalled in more than one sitting are marked, so you can prioritise them.</li>
  <li><strong>{trial?'Free trial, no card':'Practise like the real exam'}</strong>{trial?'Try reviewed questions before you choose a plan.':'Timed papers, a navigator and results by topic.'}</li></ul>;
}
