import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createBoothWorker} from '../scripts/booth-gameplay/worker-client.mjs';
async function late(w){const end=Date.now()+2000;while(!w.status().late_completion&&Date.now()<end&&!w.status().exited)await new Promise(r=>setTimeout(r,20));assert.ok(w.status().late_completion,JSON.stringify(w.status()));}
async function fixture(t,mode){
 const dir=await mkdtemp(path.join(tmpdir(),'owned-worker-test-'));
 const code=String.raw`let b='',expected=1;process.stdin.on('data',x=>{b+=x;while(b.includes('\n')){let i=b.indexOf('\n'),q=JSON.parse(b.slice(0,i));b=b.slice(i+1);let r={seq:q.seq,ok:true,result:{op:q.op}};if(q.seq!==expected++)r={seq:q.seq,ok:false,error:{code:'strict_sequence',message:'authored worker sequence mismatch'}};if('${mode}'==='refuse')r={seq:q.seq,ok:false,error:{code:'refused',message:'authored'}};if('${mode}'==='wrong')r.seq++;setTimeout(()=>{process.stdout.write(JSON.stringify(r)+'\n');if('${mode}'==='duplicate')process.stdout.write(JSON.stringify(r)+'\n');},q.op==='inspect'?80:0);}});process.stdin.on('end',()=>process.exit(0));`;
 const w=await createBoothWorker({python:process.execPath,diagnostics_directory:dir},{spawn:(exe,args,options)=>spawn(exe,['-e',code],options)});
 t.after(async()=>{assert.equal((await w.close()).exited,true);await rm(dir,{recursive:true,force:true});});return w;
}
test('late inspect is retained, cannot replay gameplay, but permits owned cleanup',async t=>{
 const w=await fixture(t,'normal');assert.equal((await w.request('focus',{},1000)).op,'focus');
 await assert.rejects(w.request('inspect',{},10),e=>e.code==='booth_worker_uncertain');
 await assert.rejects(w.request('stop'),e=>e.code==='booth_worker_unavailable');
 await late(w);
 assert.deepEqual(w.status().late_completion,{seq:2,op:'inspect',ok:true,error_code:undefined});
 await assert.rejects(w.request('gamepad'),e=>e.code==='booth_worker_unavailable');
 assert.equal((await w.request('stop')).op,'stop');assert.equal((await w.request('close')).op,'close');
 assert.equal((await w.close()).exited,true);assert.equal((await w.close()).exited,true);
 await assert.rejects(w.request('focus'),e=>e.code==='booth_worker_unavailable');
});
test('late refusal is recorded and permits cleanup without treating input as successful',async t=>{
 const w=await fixture(t,'refuse');await assert.rejects(w.request('inspect',{},10));await late(w);
 assert.equal(w.status().late_completion.ok,false);await assert.rejects(w.request('stop'),e=>e.code==='refused');
});
for(const mode of ['wrong','duplicate'])test('protocol '+mode+' remains quarantined',async t=>{
 const w=await fixture(t,mode);
 if(mode==='wrong')await assert.rejects(w.request('inspect',{},1000),e=>e.code==='booth_worker_protocol');
 else assert.equal((await w.request('inspect',{},1000)).op,'inspect');
 await new Promise(r=>setTimeout(r,30));assert.equal(w.status().uncertain,true);await assert.rejects(w.request('stop'),e=>e.code==='booth_worker_unavailable');
});
test('request bounds reject oversized payload before sending it',async t=>{const w=await fixture(t,'normal');await assert.rejects(w.request('focus',{data:'x'.repeat(4096)}),e=>e.code==='booth_worker_limit');assert.equal((await w.request('focus',{},1000)).op,'focus');});
