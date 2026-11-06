import type { Metadata } from 'next';
import Link from 'next/link';
import { getDatabase } from '@/lib/db/client';
import { listExams } from '@/lib/services/catalogue';
import { examPath, getExamPage, listFaqs } from '@/lib/services/site';
import { usd } from '@/lib/seo';
import { ExamFragment, FeedbackFragment, ProductShot, ProgressFragment } from '@/components/site/product';
import { ArrowRight, Chat, Check, Collect, Layers, Plus, Shield } from '@/components/site/icons';
export const metadata: Metadata = { alternates: { canonical: '/' } };
export const dynamic = 'force-dynamic';

// Exam and topic markers cycle through five hues; they only ever colour a marker or a bar, never text or a surface.
const TONES = ['tab-blue', 'tab-teal', 'tab-sky', 'tab-amber', 'tab-violet'];
const TAB_HEX = ['#3b82f6', '#14b8a6', '#0ea5e9', '#f59e0b', '#8b5cf6'];

export default async function Home() {
  const db = getDatabase();
  const summaries = await listExams(db);
  const pages = (await Promise.all(summaries.map(e => getExamPage(db, e.familySlug, e.seoSlug)))).filter(p => p !== null);
  const faqs = (await listFaqs(db, null)).slice(0, 6);
  const trialExam = pages.find(p => p.trial);
  const start = trialExam ? { href: '/practice', label: 'Start your free trial' } : { href: '#exams', label: 'Choose your exam' };

  return <main id="main" className="hb">
    <section className="hero-dark" aria-labelledby="hero-title">
      <div className="wrap hero-copy">
        <h1 id="hero-title">Pass your exam with the questions students remember.</h1>
        <p className="lead">After every sitting, students share the questions they remember. We collect them, compile them into complete questions and review each one, so you can practise what is coming up, a few minutes at a time.</p>
        <div className="actions"><Link className="hb-btn mint" href={start.href}>{start.label}<ArrowRight /></Link><Link className="hb-btn ghost" href="#how">See how it works</Link></div>
        {pages.length > 0 && <ul className="exam-chips" aria-label="Exams">{pages.map((p, i) => <li key={p.id}><Link href={examPath(p.familySlug, p.seoSlug)} style={{ '--tab': TAB_HEX[i % TAB_HEX.length] } as React.CSSProperties}><i aria-hidden="true" />{p.name}</Link></li>)}</ul>}
      </div>
      <div className="wrap"><ProductShot /></div>
    </section>

    <section className="hb-sec wrap" id="how" aria-labelledby="how-title">
      <div className="head center"><h2 id="how-title">Everything you need to prepare, in one place</h2><p>Practise the questions that keep coming up, understand every answer, and know which topics to work on next.</p></div>
      <div className="feature">
        <div className="copy"><h3>Explanations straight after you answer</h3><p>In Revision Mode every answer opens the explanation, why each other option is wrong, and three to five key notes.</p>
          <ul className="ticks"><li><Check /> Five options, one best answer</li><li><Check /> The sittings each question was remembered from</li><li><Check /> Wrong answers return in your mistakes deck</li></ul></div>
        <div className="stage"><FeedbackFragment /></div>
      </div>
      <div className="feature flip">
        <div className="copy"><h3>Sit timed papers like the real exam</h3><p>Exam Mode gives you a clock, flags and a navigator, then your results by topic at the end. Complete recall papers are set out by sitting.</p>
          <ul className="ticks"><li><Check /> High-yield and latest-diet packs</li><li><Check /> Flag questions and come back to them</li><li><Check /> Every explanation after you submit</li></ul></div>
        <div className="stage"><ExamFragment /></div>
      </div>
      <div className="feature">
        <div className="copy"><h3>See which topics need work</h3><p>Results show how you did in every topic and how much of each sitting you have covered, so the next session is always obvious.</p>
          <ul className="ticks"><li><Check /> Coverage by sitting</li><li><Check /> Correct by topic</li><li><Check /> Every past session kept in one place</li></ul></div>
        <div className="stage"><ProgressFragment /></div>
      </div>
    </section>

    <section className="hb-sec wrap" id="exams" aria-labelledby="exams-title">
      <div className="head"><h2 id="exams-title">Choose your exam</h2><p>Start with the exam you are sitting next. Each one has its own sittings, topics and plans.</p></div>
      {pages.length ? <ul className="shelf">{pages.map((p, i) => <li key={p.id}><Link href={examPath(p.familySlug, p.seoSlug)} className={TONES[i % TONES.length]}>
        <span className="fam">{p.familyName}</span><h3>{p.name}</h3><p>{p.description}</p>
        <span className="facts">{p.questionCount > 0 && <span className="ticket">{p.questionCount} reviewed questions</span>}{p.sittings.length > 0 && <span className="ticket">{p.sittings.length} {p.sittings.length === 1 ? 'sitting' : 'sittings'}</span>}{p.highYield > 0 && <span className="ticket hy">{p.highYield} high-yield</span>}{p.trial && <span className="ticket">Free trial</span>}{!p.questionCount && <span className="ticket">In preparation</span>}</span>
        <span className="go">See {p.name}<ArrowRight /></span></Link></li>)}</ul> : <p>The exam catalogue is being prepared.</p>}
    </section>

    <section className="band-dark" id="source" aria-labelledby="source-title">
      <div className="wrap source">
        <div><h2 id="source-title">Remembered by students, organised by us</h2>
          <p className="lede">Recall questions do not come from exam halls or from any exam body. They come from students who have just sat the exam and share what they remember with each other.</p>
          <p className="note"><strong>Not official questions.</strong> Recalls Tutor is independent and is not affiliated with or endorsed by any exam body. Questions are written in our own words from what students shared.</p></div>
        <ol className="trail">
          <li className="tab-amber"><span className="ico"><Chat /></span><h3>Students share what they remember</h3><p>After each sitting, candidates discuss the questions they saw in study groups and online communities.</p></li>
          <li className="tab-blue"><span className="ico"><Collect /></span><h3>We collect them from many sources</h3><p>Names, phone numbers and other personal details are removed before anything is stored.</p></li>
          <li className="tab-sky"><span className="ico"><Layers /></span><h3>We compile and organise them</h3><p>Each recall becomes a complete question with five options, an explanation and references, tagged by topic and sitting.</p></li>
          <li className="tab-teal"><span className="ico"><Shield /></span><h3>Every question is reviewed</h3><p>A reviewer checks the answer, the explanation and the references. Nothing reaches students without that approval.</p></li>
        </ol>
      </div>
    </section>

    <section className="hb-sec wrap" id="plans" aria-labelledby="plans-title">
      <div className="plans">
        <div><h2 id="plans-title">Simple plans, one exam at a time</h2>
          <p className="lede">Choose 3, 6 or 12 months. Every plan includes all published sittings of that exam, and the new ones added while it is active. Turn auto-renew off at any time.</p>
          <div className="cta"><Link className="hb-btn primary" href={start.href}>{start.label}<ArrowRight /></Link><Link className="hb-btn plain" href="/pricing">See plans by exam</Link></div></div>
        <div className="plan-card">
          {pages.map(p => <div key={p.id} className="exam">
            <h3>{p.name}</h3>
            <div className="durations">{p.plans.length ? p.plans.map(plan => <div key={plan.id} className={plan.highlighted ? 'best' : undefined}>{plan.highlighted && <em>Best value</em>}<b>{plan.months===1?'1 month':`${plan.months} months`}</b><span>{usd(plan.priceCents)} · {usd(plan.perMonthCents)} a month</span></div>)
              : [3, 6, 12].map(m => <div key={m}><b>{m} months</b><span>Price to be announced</span></div>)}</div>
          </div>)}
          {pages.every(p => !p.plans.length) && <p className="plan-note">Prices will be published before paid access opens. No payment is being collected yet.</p>}
        </div>
      </div>
    </section>

    {faqs.length > 0 && <section className="hb-sec wrap faq-wrap" aria-labelledby="faq-title">
      <div className="side"><h2 id="faq-title">Questions, answered</h2><p>Straight answers about where the questions come from, how practice works and what a plan includes.</p><Link className="hb-link" href="/faq">All questions and answers<ArrowRight /></Link></div>
      <div className="faq">{faqs.map((f, i) => <details key={f.id} open={i === 0}><summary>{f.question}<Plus /></summary><p>{f.answer}</p></details>)}</div>
    </section>}

    <div className="wrap"><section className="close" aria-labelledby="close-title">
      <div><h2 id="close-title">Your exam has a date. Start with the questions that keep coming back.</h2><p>Practise on your phone in a few minutes a day, and sit full papers when you are ready.</p></div>
      <Link className="hb-btn mint" href={start.href}>{start.label}<ArrowRight /></Link>
    </section></div>
  </main>;
}
