import type {NextConfig} from 'next';
const config:NextConfig={
 // Local QA only: lets an isolated preview build into ignored .local/ beside a running dev server.
 ...(process.env.NEXT_DIST_DIR?.startsWith('.local/')?{distDir:process.env.NEXT_DIST_DIR}:{}),
 // Recall uploads are capped at 4 MB in total in the action; this leaves room for multipart overhead.
 experimental:{serverActions:{bodySizeLimit:'5mb'}},
 serverExternalPackages:['@electric-sql/pglite','postgres'],
 async headers(){return [{source:'/(.*)',headers:[
  {key:'X-Content-Type-Options',value:'nosniff'},
  {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
  {key:'X-Frame-Options',value:'DENY'},
 ]}];},
};
export default config;
