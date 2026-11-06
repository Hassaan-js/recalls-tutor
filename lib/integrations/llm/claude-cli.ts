import {spawn} from 'node:child_process';
import {existsSync,readdirSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export type ModelRequest={system:string;prompt:string;schema:object};
export type ModelResponse={output:unknown;model:string;costUsd:number|null};
export interface RecallModel {name:string;complete(request:ModelRequest):Promise<ModelResponse>}
const TIMEOUT_MS=6*60*1000;
// Prefer an explicit path, then the CLI bundled with the Claude desktop app, then PATH.
export function resolveClaudeBinary() {
 if(process.env.CLAUDE_CLI_PATH)return process.env.CLAUDE_CLI_PATH;
 const root=path.join(process.env.APPDATA??path.join(os.homedir(),'AppData','Roaming'),'Claude','claude-code');
 if(existsSync(root)) {
  const candidates=readdirSync(root).flatMap(version=>{const dir=path.join(root,version);return statSync(dir).isDirectory()?readdirSync(dir).map(build=>path.join(dir,build,'claude.exe')):[];}).filter(file=>existsSync(file));
  candidates.sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
  if(candidates[0])return candidates[0];
 }
 return process.platform==='win32'?'claude.exe':'claude';
}
// The child runs on the user's Claude login, never an API key, and never inherits a parent Claude session.
export function childEnvironment() {
 const env:Record<string,string|undefined>={};
 for(const [key,value] of Object.entries(process.env)) {
  if(key==='CLAUDECODE'||key.startsWith('ANTHROPIC_')||(key.startsWith('CLAUDE_')&&key!=='CLAUDE_CODE_OAUTH_TOKEN'&&key!=='CLAUDE_CONFIG_DIR'))continue;
  env[key]=value;
 }
 return env as NodeJS.ProcessEnv;
}
export function claudeCliModel(model=process.env.RECALLS_CLAUDE_MODEL||'sonnet'):RecallModel {
 return {name:`claude-cli:${model}`,complete:request=>new Promise((resolve,reject)=>{
  // No tools, MCP servers, settings or saved sessions: uploaded text can never trigger an action.
  const args=['-p','--output-format','json','--model',model,'--tools','','--strict-mcp-config','--setting-sources','','--no-session-persistence','--system-prompt',request.system,'--json-schema',JSON.stringify(request.schema)];
  const child=spawn(/*turbopackIgnore: true*/ resolveClaudeBinary(),args,{cwd:os.tmpdir(),env:childEnvironment(),windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('Claude did not respond within 6 minutes.'));},TIMEOUT_MS);
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.on('error',error=>{clearTimeout(timer);reject(new Error((error as NodeJS.ErrnoException).code==='ENOENT'?'Claude Code CLI was not found. Set CLAUDE_CLI_PATH.':'Claude Code CLI could not start.'));});
  child.on('close',code=>{clearTimeout(timer);
   let result:{is_error?:boolean;result?:string;structured_output?:unknown;total_cost_usd?:number;modelUsage?:Record<string,unknown>};
   try{result=JSON.parse(stdout);}catch{return reject(new Error(code?`Claude Code CLI exited with code ${code}. ${stderr.slice(0,300)}`.trim():'Claude returned an unreadable response.'));}
   if(result.is_error)return reject(new Error(/log ?in/i.test(result.result??'')?'Claude is not signed in on the server yet. Ask your administrator to connect Claude, then press Retry.':`Claude reported an error: ${(result.result??'unknown').slice(0,300)}`));
   let output=result.structured_output;
   if(output===undefined) {try{output=JSON.parse((result.result??'').replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{return reject(new Error('Claude did not return structured output.'));}}
   resolve({output,model:Object.keys(result.modelUsage??{})[0]??model,costUsd:typeof result.total_cost_usd==='number'?result.total_cost_usd:null});
  });
  child.stdin.end(request.prompt);
 })};
}
