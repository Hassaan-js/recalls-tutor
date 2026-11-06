'use client';
export default function ErrorPage({ reset }: {reset:()=>void}) {
 return <main id="main" className="hb"><section className="pg-hero missing" aria-labelledby="error-title"><div className="wrap">
  <h1 id="error-title">Something went wrong loading this page.</h1><p className="intro">Please try again in a moment.</p>
  <div className="actions"><button type="button" className="hb-btn primary" onClick={reset}>Try again</button></div>
 </div></section></main>;
}
