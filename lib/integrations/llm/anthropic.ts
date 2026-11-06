import Anthropic from '@anthropic-ai/sdk';
import {claudeCliModel,type RecallModel} from './claude-cli';
// Production AI drafting: the Claude API through the official SDK, with JSON output constrained by the request's
// schema (structured outputs) and server-side fallback if a request is declined. The local Claude app CLI remains
// the fallback for development when no API key is set (decision 2026-11-01).
const MODEL='claude-opus-5-5';
// Structured outputs accept a subset of JSON Schema: numeric bounds and item counts above 1 are moved into the
// description, and every draft is still validated in code before it is saved.
export function apiSchema(schema:unknown):unknown {
 if(Array.isArray(schema))return schema.map(apiSchema);
 if(!schema||typeof schema!=='object')return schema;
 const out:Record<string,unknown>={},notes:string[]=[];
 for(const [key,value] of Object.entries(schema as Record<string,unknown>)){
  if(key==='minimum'||key==='maximum'){notes.push(`${key} ${value}`);continue;}
  if(key==='maxItems'||(key==='minItems'&&Number(value)>1)){notes.push(`${key==='maxItems'?'at most':'at least'} ${value} items`);continue;}
  out[key]=apiSchema(value);
 }
 if(notes.length)out.description=[out.description,`(${notes.join(', ')})`].filter(Boolean).join(' ');
 return out;
}
// Claude Opus 5.5 list prices ($4 / $20 per million tokens) give an estimate for the job's cost column (AIS-13).
const estimate=(usage:{input_tokens:number;output_tokens:number})=>Math.round((usage.input_tokens*4+usage.output_tokens*20)/1e6*10000)/10000;
export function anthropicRecallModel(client=new Anthropic(),effort:'low'|'medium'|'high'='medium'):RecallModel {
 return {name:`anthropic:${MODEL}`,async complete(request) {
  let message:Anthropic.Beta.BetaMessage;
  try {
   message=await client.beta.messages.stream({model:MODEL,max_tokens:64000,betas:['server-side-fallback-2026-07-01'],fallbacks:'default',
    output_config:{effort,format:{type:'json_schema',schema:apiSchema(request.schema) as Record<string,unknown>}},
    system:request.system,messages:[{role:'user',content:request.prompt}]}).finalMessage();
  } catch(error) {
   if(error instanceof Anthropic.AuthenticationError)throw new Error('The Claude API key is not valid. Ask your administrator to check ANTHROPIC_API_KEY.');
   if(error instanceof Anthropic.RateLimitError)throw new Error('Claude is busy right now. Press Retry in a minute.');
   if(error instanceof Anthropic.BadRequestError)throw new Error('Claude could not process this request. Try a shorter source.');
   if(error instanceof Anthropic.APIError)throw new Error('Claude could not be reached. Press Retry.');
   throw error;
  }
  if(message.stop_reason==='refusal')throw new Error('Claude declined this request.');
  if(message.stop_reason==='max_tokens')throw new Error('The answer was too long for one request. Split the source and retry.');
  const text=message.content.filter((b):b is Anthropic.Beta.BetaTextBlock=>b.type==='text').map(b=>b.text).join('').trim();
  let output:unknown;
  try{output=JSON.parse(text);}catch{throw new Error('Claude did not return structured output.');}
  return {output,model:message.model,costUsd:estimate(message.usage)};
 }};
}
// The API is used whenever a key is configured; otherwise the local Claude login.
export function defaultRecallModel():RecallModel {return process.env.ANTHROPIC_API_KEY?anthropicRecallModel():claudeCliModel();}
