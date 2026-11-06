import Link from 'next/link';
import { ArrowRight } from '@/components/site/icons';

export default function NotFound() {
  return <main id="main" className="hb"><section className="pg-hero missing" aria-labelledby="missing-title"><div className="wrap">
    <h1 id="missing-title">We couldn’t find that page.</h1><p className="intro">It may have moved, or the link may be mistyped. The exam catalogue is the best place to start.</p>
    <div className="actions"><Link href="/#exams" className="hb-btn primary">Browse the exams<ArrowRight /></Link><Link href="/" className="hb-btn plain">Go to the home page</Link></div>
  </div></section></main>;
}
