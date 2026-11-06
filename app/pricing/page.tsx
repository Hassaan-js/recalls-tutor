import type { Metadata } from 'next';
import Link from 'next/link';
import { getDatabase } from '@/lib/db/client';
import { listExams } from '@/lib/services/catalogue';
import { examPath, getExamPage } from '@/lib/services/site';
import { PlanSelector } from '@/components/seo/plans';
import { ArrowRight } from '@/components/site/icons';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Plans', alternates: { canonical: '/pricing' }, description: 'Recalls Tutor plans by exam: 3, 6 or 12 months in US dollars, including every published sitting of the exam.' };

export default async function PricingPage() {
  const db = getDatabase();
  const pages = (await Promise.all((await listExams(db)).map(e => getExamPage(db, e.familySlug, e.seoSlug)))).filter(p => p !== null);
  return <main id="main" className="hb">
    <section className="pg-hero" aria-labelledby="pricing-title"><div className="wrap">
      <h1 id="pricing-title">Plans by exam</h1><p className="intro">One exam at a time, for 3, 6 or 12 months. Every plan includes all published sittings of that exam, and new sittings added while it is active.</p>
      {pages.length > 1 && <nav className="jump" aria-label="Exams">{pages.map(p => <a key={p.id} href={`#${p.seoSlug}`}>{p.name}</a>)}</nav>}
    </div></section>
    {pages.map(p => <section key={p.id} className="hb-sec wrap split" id={p.seoSlug} aria-labelledby={`plans-${p.id}`}>
      <div className="title"><h2 id={`plans-${p.id}`}>{p.name}</h2><p>{p.description}</p><p><Link className="hb-link" href={examPath(p.familySlug, p.seoSlug)}>About {p.name}<ArrowRight /></Link></p></div>
      <div className="body"><PlanSelector plans={p.plans} examName={p.name} trial={p.trial} checkoutEnabled={Boolean(process.env.STRIPE_SECRET_KEY)} returnPath={`/pricing#${p.seoSlug}`} /></div></section>)}
    <section className="hb-sec wrap split" aria-labelledby="renew-title"><div className="title"><h2 id="renew-title">How plans work</h2></div>
      <ul className="trust-grid body"><li><strong>Renews until you stop it</strong>Plans renew automatically. Turn auto-renew off in My plans at any time and keep access to the end of the period.</li>
        <li><strong>If a payment fails</strong>You keep access for 7 days while the payment is retried.</li>
        <li><strong>Your progress stays</strong>If you come back after a break, your answers and mistakes deck are still there.</li>
        <li><strong>Refunds</strong>See the <Link className="hb-link" href="/refund-policy">refund policy</Link>, which is also shown at checkout.</li></ul></section>
  </main>;
}
