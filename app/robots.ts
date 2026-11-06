import type {MetadataRoute} from 'next';
import {siteUrl} from '@/lib/seo';
// Private areas are excluded from crawling; they also require sign-in and never render paid content publicly.
export default function robots():MetadataRoute.Robots {
 return {rules:[{userAgent:'*',allow:'/',disallow:['/api/','/studio','/practice','/dashboard','/account','/sign-in','/sign-up','/verify-email','/two-factor','/forgot-password','/reset-password']}],sitemap:`${siteUrl()}/sitemap.xml`};
}
