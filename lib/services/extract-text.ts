import {inflateRawSync} from 'node:zlib';
// AIS-1: turn an uploaded recall file into plain text, or mark it for OCR when it is a scan, photo or screenshot.
const MAX_UNZIPPED=20*1024*1024;
export const UPLOAD_EXTENSIONS=['.txt','.csv','.tsv','.md','.pdf','.docx','.png','.jpg','.jpeg','.webp','.gif'];
export type ScanMediaType='image/png'|'image/jpeg'|'image/webp'|'image/gif'|'application/pdf';
export type PreparedUpload={kind:'text';text:string}|{kind:'scan';mediaType:ScanMediaType};
const IMAGE_TYPES:Record<string,ScanMediaType>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
const ascii=(b:Uint8Array,from:number,to:number)=>new TextDecoder().decode(b.subarray(from,to));
// File signatures, so a renamed file is caught before it is sent anywhere.
const SIGNATURES:Record<ScanMediaType,(b:Uint8Array)=>boolean>={'image/png':b=>b[0]===0x89&&ascii(b,1,4)==='PNG','image/jpeg':b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff,
 'image/gif':b=>ascii(b,0,3)==='GIF','image/webp':b=>ascii(b,0,4)==='RIFF'&&ascii(b,8,12)==='WEBP','application/pdf':b=>ascii(b,0,5)==='%PDF-'};
class ScanNeeded extends Error {}
export async function prepareUpload(name:string,bytes:Uint8Array):Promise<PreparedUpload> {
 const extension=name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]??'';
 if(['.heic','.heif'].includes(extension))throw new Error('HEIC photos from iPhones are not supported. Share the photo as JPG, or take a screenshot, and upload that.');
 const image=IMAGE_TYPES[extension];
 if(image){if(!SIGNATURES[image](bytes))throw new Error(`${name} is not a valid image.`);return {kind:'scan',mediaType:image};}
 if(extension==='.pdf') {
  try {return {kind:'text',text:await pdfText(bytes)};}
  catch(error){if(error instanceof ScanNeeded)return {kind:'scan',mediaType:'application/pdf'};throw error;}
 }
 return {kind:'text',text:await extractUploadText(name,bytes)};
}
export async function extractUploadText(name:string,bytes:Uint8Array):Promise<string> {
 const extension=name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]??'';
 if(['.txt','.csv','.tsv','.md'].includes(extension))return new TextDecoder('utf-8').decode(bytes);
 if(extension==='.docx')return docxText(bytes);
 if(extension==='.pdf')return pdfText(bytes);
 if(extension==='.doc')throw new Error('Older .doc files are not supported. Save the file as .docx or PDF and upload it again.');
 throw new Error('Upload a .txt, .csv, .tsv, .md, .pdf or .docx file, or a PNG, JPG, WebP or GIF image.');
}
async function pdfText(bytes:Uint8Array) {
 if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('This file is not a valid PDF.');
 const {extractText,getDocumentProxy}=await import('unpdf');
 let text:string;
 try {
  const pdf=await getDocumentProxy(new Uint8Array(bytes));
  text=(await extractText(pdf,{mergePages:true})).text;
 } catch(error) {
  throw new Error(/password/i.test(error instanceof Error?error.message:'')?'This PDF is password-protected. Remove the password and upload it again.':'This PDF could not be read.');
 }
 // Little or no selectable text means a scan or photo, which goes to OCR instead.
 if(text.replace(/\s/g,'').length<20)throw new ScanNeeded('This PDF has no selectable text.');
 return text;
}
// A .docx file is a zip archive; the body text lives in word/document.xml.
function docxText(bytes:Uint8Array) {
 const xml=zipEntry(bytes,'word/document.xml');
 if(xml===null)throw new Error('This Word file could not be read. Save it again as .docx and retry.');
 const text=xml.replace(/<w:tab\/>/g,'\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'')
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/g,'&');
 if(!text.trim())throw new Error('This Word file has no text.');
 return text;
}
function zipEntry(bytes:Uint8Array,wanted:string):string|null {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)return null;
 const entries=view.getUint16(end+10,true);let offset=view.getUint32(end+16,true);
 for(let n=0;n<entries&&offset+46<=bytes.length;n++) {
  if(view.getUint32(offset,true)!==0x02014b50)return null;
  const method=view.getUint16(offset+10,true),compressed=view.getUint32(offset+20,true),size=view.getUint32(offset+24,true);
  const nameLength=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
  const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameLength));
  offset+=46+nameLength+extra+comment;
  if(name!==wanted)continue;
  if(size>MAX_UNZIPPED||view.getUint32(local,true)!==0x04034b50)return null;
  const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true),data=bytes.subarray(start,start+compressed);
  if(method===0)return new TextDecoder().decode(data);
  if(method!==8)return null;
  try {return new TextDecoder().decode(inflateRawSync(data,{maxOutputLength:MAX_UNZIPPED}));} catch {return null;}
 }
 return null;
}
