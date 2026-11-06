'use client';
import Link from 'next/link';
import Script from 'next/script';
import {useEffect,useState} from 'react';
// SEO-8: analytics load only after an explicit "Accept"; declining (or ignoring the banner) sets no analytics cookies.
const COOKIE='rt_consent';
function readConsent():'granted'|'denied'|null {const match=document.cookie.match(/(?:^|;\s*)rt_consent=(granted|denied)/);return match?match[1] as 'granted'|'denied':null;}
function writeConsent(value:'granted'|'denied') {document.cookie=`${COOKIE}=${value}; Max-Age=${60*60*24*365}; Path=/; SameSite=Lax`;}
export function ConsentAndAnalytics({gaId}:{gaId:string|null}) {
 const[consent,setConsent]=useState<'granted'|'denied'|null|undefined>(undefined);
 useEffect(()=>{setConsent(readConsent());const reopen=()=>setConsent(null);window.addEventListener('rt-consent-reopen',reopen);return()=>window.removeEventListener('rt-consent-reopen',reopen);},[]);
 if(!gaId)return null;// no analytics configured, so there is nothing to consent to
 const choose=(value:'granted'|'denied')=>{writeConsent(value);setConsent(value);};
 return <>{consent==='granted'&&<><Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`} strategy="afterInteractive"/>
   <Script id="ga-init" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(gaId)},{anonymize_ip:true});`}</Script></>}
  {consent===null&&<div className="consent" role="dialog" aria-live="polite" aria-label="Cookie choices"><p>We use analytics cookies, only with your permission, to understand how the site is used. See our <Link href="/privacy">privacy policy</Link>.</p>
   <div><button type="button" className="consent-secondary" onClick={()=>choose('denied')}>Decline</button><button type="button" className="consent-primary" onClick={()=>choose('granted')}>Accept analytics</button></div></div>}</>;
}
export function CookieSettingsLink() {
 return <button type="button" className="footer-link-button" onClick={()=>{document.cookie=`${COOKIE}=; Max-Age=0; Path=/`;window.dispatchEvent(new Event('rt-consent-reopen'));}}>Cookie settings</button>;
}
