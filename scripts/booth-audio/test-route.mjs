// Authored silent fixture only. Supply a retained actual owned Booth receipt in options JSON.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createBoothAudioRoute } from './route.mjs';

const options=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
assert.equal(path.basename(options.target.path),'NativeAudioFixture.exe');
assert.match(options.target.path,/fixture/i);
const root=options.destination;
await fs.mkdir(root); // Exact fresh caller-owned proof directory; route adds its own fresh children.
const proof={status:'pending',scope:'authored fixture; no game or nonzero PCM playback',runs:[]};
const write=fs.writeFile,clock=Date.now;
let route;const routes=[];
try{
 route=await createBoothAudioRoute({...options,destination:path.join(root,'normal')});routes.push(route);
 proof.runs.push({seed:await route.seed(),restore:await route.restore()});
 const recovery=await createBoothAudioRoute({...options,destination:path.join(root,'recovery')});routes.push(recovery);
 let injected=false;
 fs.writeFile=async function(p,...args){if(!injected&&path.basename(p).startsWith('seed-')&&String(p).endsWith('-controller.json')){injected=true;throw new Error('Authored publication failure after native seed');}return write.call(this,p,...args);};
 try{await recovery.seed();assert.fail('Injected publication failure passed');}catch(e){assert.equal(e.details?.recovery?.ok,true);proof.publication_failure_recovery=e.details;}finally{fs.writeFile=write;}
 assert(injected);
 const lease=await createBoothAudioRoute({...options,destination:path.join(root,'expired-cleanup')});routes.push(lease);
 const seeded=await lease.seed();Date.now=()=>clock()+3600000;
 try{proof.expired_lease_restore={seed:seeded,restore:await lease.restore()};assert(proof.expired_lease_restore.restore.ok);}finally{Date.now=clock;}
 // Forced helper death: its already-admitted private job must stop its suspended child.
 // The retained config is restore-mode with original preferences already restored.
 const helper=path.join(route.destination,'bin','SuspendedPreflight.exe');
 const child=spawn(helper,[options.target.path,path.join(route.destination,'bin','Seeder.dll'),options.desktop],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='',errors='',identity=null,forced=false;
 const deadline=setTimeout(()=>child.kill(),50000);
 child.stdout.on('data',b=>{output+=b;const match=/child_pid=(\d+) start_ticks=(\d+)/.exec(output);if(match&&!forced){identity={pid:match[1],ticks:match[2]};forced=true;child.kill();}});
 child.stderr.on('data',b=>{errors+=b;});
 const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(deadline);
 assert(identity&&forced,'No owned job-bound child captured for forced-death proof');
 const probe=spawn(options.toolchain.pwsh,['-NoProfile','-Command',`$ErrorActionPreference='Stop'; $p=Get-Process -Id ${identity.pid} -ErrorAction SilentlyContinue; if($p -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq '${identity.ticks}'){throw 'Owned suspended child survived helper death'}; exit 0`],{windowsHide:true});
 const code=await new Promise((resolve,reject)=>{probe.once('error',reject);probe.once('close',resolve);});assert.equal(code,0);
 proof.forced_helper_death={identity,ended,stdout:output,stderr:errors,owned_child_gone:true};
 proof.status='passed';
}catch(e){proof.status='failed';proof.error=e.message;proof.details=e.details;throw e;}
finally{fs.writeFile=write;Date.now=clock;proof.final_cleanup=[];for(const r of routes){try{await fs.stat(path.join(r.destination,'original.ini'));proof.final_cleanup.push(await r.restore());}catch(e){proof.final_cleanup.push({error:e.message,details:e.details});proof.status='failed';}}await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(proof,null,2));}
console.log(path.join(root,'receipt.json'));
