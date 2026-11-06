import type { Metadata, Viewport } from 'next';
import { Open_Sans, Poppins } from 'next/font/google';
import { SiteFooter, SiteHeader } from '@/components/site-shell';
import { ConsentAndAnalytics } from '@/components/seo/consent';
import { JsonLd } from '@/components/seo/json-ld';
import { siteUrl, SITE_NAME } from '@/lib/seo';
import './globals.css';
import './site.css';
import { PublicOnly } from '@/components/public/chrome';

const display = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap' });
const body = Open_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const viewport: Viewport = { themeColor: '#0f766e' };

export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'Recalls Tutor', statusBarStyle: 'default' },
  metadataBase: new URL(siteUrl()),
  title: { default: 'Recalls Tutor — Exam recall question banks, refreshed every sitting', template: '%s | Recalls Tutor' },
  description: 'Reviewed recall questions for postgraduate medical exams, compiled from what students share after each sitting and updated after every exam diet.',
  openGraph: { siteName: SITE_NAME, type: 'website' },
  twitter: { card: 'summary_large_image' },
  ...(process.env.NEXT_PUBLIC_GSC_VERIFICATION ? { verification: { google: process.env.NEXT_PUBLIC_GSC_VERIFICATION } } : {}),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${display.variable} ${body.variable}`}><body><a className="skip-link" href="#main">Skip to content</a>
    <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: siteUrl(), description: 'Recall question banks for postgraduate medical licensing exams, updated after every sitting.' }} />
    <PublicOnly><SiteHeader /></PublicOnly>{children}<PublicOnly><SiteFooter /></PublicOnly>
    <ConsentAndAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID || null} />
  </body></html>;
}
