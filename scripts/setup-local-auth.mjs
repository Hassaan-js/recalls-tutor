import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const filename=new URL('../.env.local',import.meta.url);
let existing='';
try {existing=await readFile(filename,'utf8');} catch(error) {if(error.code!=='ENOENT') throw error;}
const additions=[];
for (const [key,value] of Object.entries({BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),BETTER_AUTH_URL:'http://127.0.0.1:3000',AUTH_MAIL_MODE:'file'})) {
 if (!new RegExp(`^${key}=.+$`,'m').test(existing)) {
  existing=existing.replace(new RegExp(`^${key}=.*$`,'gm'),'');
  additions.push(`${key}=${value}`);
 }
}
if(additions.length) await writeFile(filename,existing+'\n'+additions.join('\n')+'\n',{mode:0o600});
console.log('Local authentication settings ready. Secret values were not printed.');
