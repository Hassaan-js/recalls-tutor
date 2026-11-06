// Signed-in areas show a loading state; public pages render fully first so search engines get real 301 and 404 status codes.
export default function Loading() {return <main id="main" className="wrap missing-page" aria-busy="true" aria-live="polite"><p>Loading…</p></main>;}
