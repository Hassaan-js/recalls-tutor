import Link from 'next/link';
import { Check } from '@/components/site/icons';
import '@/app/auth.css';

// Sign-in, sign-up and recovery screens: the reason to sign in on the left, the form in one card on the right.
export function AuthShell({ title, description, children, account = false }: { title: string; description: string; children: React.ReactNode; account?: boolean }) {
  return <main id="main" className="hb auth-page"><div className="wrap auth-layout">
    <header className="auth-intro">
      <Link className="auth-back" href={account ? '/dashboard' : '/'}>← {account ? 'Back to your dashboard' : 'Back to Recalls Tutor'}</Link>
      <h1>{title}</h1><p>{description}</p>
      {!account && <ul className="auth-points"><li><Check /> Recall questions for your exam, reviewed before they are published</li><li><Check /> Short sessions on your phone, or full timed papers</li><li><Check /> Results by topic, and a deck of the questions you missed</li></ul>}
    </header>
    <section className="auth-panel" aria-label={title}>{children}</section>
  </div></main>;
}
