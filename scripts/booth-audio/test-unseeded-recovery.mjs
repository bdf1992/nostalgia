// Pure retained-evidence admission tests. No subprocess, endpoint or game operations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isProvenPreInitializerFailure} from './route.mjs';
const pins={files:{'Seeder.cpp':'34808b3866b0fda995c3e5d0550eda4c9a60806f646370f0724e08ab8d9a72f9','SuspendedPreflight.cpp':'4fe51e2051d708f2b7bbbbb4cc9740d85468a71fde1a483658180d14c84728ba'}};
const roles=['render','capture'].flatMap(flow=>['console','multimedia','communications'].map(role=>({flow,role,hresult:0,endpoint:'authored endpoint'})));
const result={mode:'seed',helper:{code:72,signal:null,timeout:false,overflow:false,stdout:'child_pid=123 start_ticks=639273184689154336\n',stderr:'exact remote DLL not loaded\nowned_process=123 cleanup_stopped=true main_thread_resumed=false\n'},owned_child_cleanup:{pid:123,start_ticks_utc:'639273184689154336',verified:true},observed:null,snapshot_sha256:null,defaults_before:roles,defaults_after:roles,defaults_unchanged:true};
test('reviewed exact legacy pre-initializer error is eligible for fresh checks',()=>assert.equal(isProvenPreInitializerFailure(result,pins,'new-source'),true));
test('missing snapshot alone, unknown source, active initializer and uncertainty refuse',()=>{
 for(const edit of [r=>r.helper.stderr='owned initializer process deadline',r=>r.helper.timeout=true,r=>r.helper.overflow=true,r=>r.helper.signal='SIGTERM',r=>r.helper.code=71,r=>r.owned_child_cleanup.verified=false,r=>r.observed={status:'failure'},r=>r.snapshot_sha256='hash',r=>r.defaults_after=[],r=>r.defaults_before[0].hresult=1,r=>r.defaults_before[0].role='bogus',r=>r.owned_child_cleanup.pid=999]){const copy=structuredClone(result);edit(copy);assert.equal(isProvenPreInitializerFailure(copy,pins,'new-source'),false);}
 assert.equal(isProvenPreInitializerFailure(result,{files:{...pins.files,'SuspendedPreflight.cpp':'unknown'}},'new-source'),false);
 assert.equal(isProvenPreInitializerFailure(null,pins,'new-source'),false);
});
test('current helper requires explicit pre-initializer diagnostic',()=>{
 const current={files:{...pins.files,'SuspendedPreflight.cpp':'current'}};assert.equal(isProvenPreInitializerFailure(result,current,'current',pins.files['Seeder.cpp']),false);
 const copy=structuredClone(result);copy.helper.stdout+='remote_load_thread_exit=0 initializer_started=false primary_suspended=true\n';assert.equal(isProvenPreInitializerFailure(copy,current,'current',pins.files['Seeder.cpp']),true);
});
test('current LF or CRLF bytes require both trusted import hashes; legacy pair stays exact',async()=>{
 const copy=structuredClone(result);copy.helper.stdout+='remote_load_thread_exit=0 initializer_started=false primary_suspended=true\n';
 const sources=Object.fromEntries(await Promise.all(['Seeder.cpp','SuspendedPreflight.cpp'].map(async name=>[name,(await readFile(new URL('./experimental/'+name,import.meta.url),'utf8')).replaceAll('\r\n','\n')])));
 for(const ending of ['\n','\r\n']){const hashes=Object.fromEntries(Object.entries(sources).map(([name,text])=>[name,createHash('sha256').update(text.replaceAll('\n',ending)).digest('hex')]));const current={files:hashes};assert.equal(isProvenPreInitializerFailure(copy,current,hashes['SuspendedPreflight.cpp'],hashes['Seeder.cpp']),true);assert.equal(isProvenPreInitializerFailure(copy,current,hashes['SuspendedPreflight.cpp'],'changed-seeder'),false);assert.equal(isProvenPreInitializerFailure(copy,current,'changed-helper',hashes['Seeder.cpp']),false);assert.equal(isProvenPreInitializerFailure(copy,current,hashes['SuspendedPreflight.cpp']),false);}
 assert.equal(isProvenPreInitializerFailure(result,{files:{...pins.files,'Seeder.cpp':'LF-seeder'}},'current','LF-seeder'),false);
 assert.equal(isProvenPreInitializerFailure(result,pins,'different-current-helper','different-current-seeder'),true);
});
