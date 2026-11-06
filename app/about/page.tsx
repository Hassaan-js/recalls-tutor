import {SitePage,sitePageMetadata} from '@/components/seo/site-page';
export const dynamic='force-dynamic';
export function generateMetadata() {return sitePageMetadata('about');}
export default function Page() {return <SitePage slug="about"/>;}
