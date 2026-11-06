// Structured data is serialised with "<" escaped so page text can never close the script element.
const LT=String.fromCharCode(92)+'u003c';
export function JsonLd({data}:{data:object}) {
 return <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(data).replace(/</g,LT)}}/>;
}
export function breadcrumbs(items:{name:string;path:string}[],base:string) {
 return {'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:items.map((item,i)=>({'@type':'ListItem',position:i+1,name:item.name,item:`${base}${item.path}`}))};
}
export function faqSchema(faqs:{question:string;answer:string}[]) {
 return {'@context':'https://schema.org','@type':'FAQPage',mainEntity:faqs.map(f=>({'@type':'Question',name:f.question,acceptedAnswer:{'@type':'Answer',text:f.answer}}))};
}
