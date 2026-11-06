export const day=(v:string|null)=>v?new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'—';
export const when=(v:string|null)=>v?new Date(v).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'—';
export const money=(cents:number|null)=>cents===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export const STATE:Record<string,string>={invited:'Invited',active:'Active',expired:'Expired',revoked:'Revoked'};
