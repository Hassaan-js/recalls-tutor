import Link from 'next/link';
const TABS=[{key:'plans',href:'/studio/billing',label:'Plans and subscriptions'},{key:'coupons',href:'/studio/billing/coupons',label:'Coupons'},{key:'revenue',href:'/studio/billing/revenue',label:'Revenue'}] as const;
export function BillingTabs({current}:{current:typeof TABS[number]['key']}) {
 return <nav className="catalogue-tabs" aria-label="Billing">{TABS.map(t=><Link key={t.key} href={t.href} aria-current={t.key===current?'page':undefined}>{t.label}</Link>)}</nav>;
}
