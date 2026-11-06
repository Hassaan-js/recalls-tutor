import Link from 'next/link';
import { CookieSettingsLink } from '@/components/seo/consent';
import { Mark } from '@/components/site/icons';

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? '↗' : '→'}</span>;
}

export function SiteHeader() {
  return <header className="hb-nav"><div className="in">
    <Link href="/" className="hb-mark" aria-label="Recalls Tutor home"><Mark />Recalls Tutor</Link>
    <nav aria-label="Main navigation">
      <Link href="/#exams" className="wide">Exams</Link><Link href="/#how" className="wide">How it works</Link><Link href="/pricing" className="wide">Plans</Link><Link href="/faq" className="wide">FAQ</Link>
      <Link href="/sign-in" className="signin">Sign in</Link>
      <Link href="/practice" className="hb-btn primary">Start free</Link>
    </nav>
  </div></header>;
}

export function SiteFooter() {
  return <footer className="hb-foot"><div className="in">
    <div className="about"><Link href="/" className="hb-mark" aria-label="Recalls Tutor home"><Mark />Recalls Tutor</Link>
      <p>Practice questions compiled from what students share after each sitting, reviewed before they are published, with new sittings added after every exam diet.</p></div>
    <nav aria-label="Company and policies"><Link href="/about">About</Link><Link href="/faq">Questions and answers</Link><Link href="/blog">Guides</Link><Link href="/pricing">Plans</Link><Link href="/contact">Contact</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refund-policy">Refund policy</Link><CookieSettingsLink /></nav>
    <p className="fine">© {new Date().getFullYear()} Recalls Tutor. Independent: not affiliated with or endorsed by any exam body. Recall questions are shared by students after their exams and compiled by our team; they are not official exam questions. Exam names only describe the exams our questions help you prepare for.</p>
  </div></footer>;
}
