import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as z from 'zod/v4';
import { StudyError, diagnostic } from '../dist/errors.js';
import { verifyFileCheckpoint, restoreFileCheckpoint } from '../dist/fileCheckpoint.js';
import { admitNativePath, readNativeFile, nativeFileDigest, nativeStartInput, nativeStartOutput, nativeSessionReceiptSchema,
  nativeBridgeReceiptSchema, nativeActionSchema, nativeInspectOutput, nativeActOutput, nativeFocusOutput, nativeStopOutput } from '../dist/nativeGameplayEnvironment.js';
import { validateImage } from './native-sky-bridge.mjs';
import { createBoothWorker } from './booth-gameplay/worker-client.mjs';
import { createBoothAudioRoute } from './booth-audio/route.mjs';
import { startViewer } from './booth-audio/server.mjs';

const fail = (code, message) => { throw new StudyError(code, message); };
const same = (a,b) => a.dev === b.dev && a.ino === b.ino;
const hash = b => createHash('sha256').update(b).digest('hex');
const overlap = (a,b) => { a=resolve(a).toLowerCase();b=resolve(b).toLowerCase();return a===b||a.startsWith(b+sep)||b.startsWith(a+sep); };
const equalTarget = (a,b) => a && b && ['pid','created_high','created_low','hwnd','desktop','executable'].every(k=>a[k]===b[k]);
const ownedTarget = (o,exe,desktop) => o && ['pid','created_high','created_low','hwnd'].every(k=>Number.isSafeInteger(o[k])&&o[k]>=0) && o.pid>0 && o.hwnd>0 && resolve(o.executable)===resolve(exe)&&o.desktop===desktop;
function viewerStream(raw){
  const match=typeof raw==='string'&&/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/stream(?:\.mjpg)?$/.exec(raw);
  if(!match||raw.length>2048)fail('native_viewer_route_invalid','Owned viewer requires an exact loopback HTTP stream route');
  let url;try{url=new URL(raw);}catch{fail('native_viewer_route_invalid','Owned stream URL is invalid');}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.hash||url.search||Number(match[1])>65535)fail('native_viewer_route_invalid','Owned stream URL authority is invalid');
  return url.pathname==='/stream'?raw+'.mjpg':raw;
}
async function absent(path) { try { await lstat(path); } catch(e) { if(e.code==='ENOENT')return;throw e; } fail('native_destination_exists','Owned destination must be absent'); }
async function primarySaves(appdata) {
  const root=join(appdata,'EldenRing');try {await admitNativePath(root,true);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const paths=[];for(const name of await readdir(root))if(/^\d{17}$/.test(name)){const path=join(root,name,'ER0000.sl2');try{await admitNativePath(path);paths.push(path);}catch(e){if(e.code!=='ENOENT')throw e;}}return paths;
}

/** Trusted local configuration supplies providers; public RPC cannot supply commands or authority. */
export async function createNativeBoothBridge({destination,runtime,configuration}, deps={}) {
  if(runtime?.platform!=='win32'||typeof runtime.appdata!=='string'||!isAbsolute(runtime.appdata)||!configuration||typeof destination!=='string'||!isAbsolute(destination))fail('native_runtime_invalid','Explicit Windows runtime and trusted Booth configuration required');
  for(const name of ['runtime_root','python','ws_script'])if(typeof configuration[name]!=='string'||!isAbsolute(configuration[name]))fail('native_runtime_invalid','Absolute private provider paths required');
  for(const name of ['ws_session','task'])if(typeof configuration[name]!=='string'||configuration[name].length<1||configuration[name].length>128)fail('native_runtime_invalid','Bounded private workstation authority required');
  if(!configuration.audio?.toolchain||typeof configuration.audio.cable_endpoint!=='string'||typeof configuration.audio.tool_receipt!=='string'||!isAbsolute(configuration.audio.tool_receipt))fail('native_runtime_invalid','Explicit audio toolchain, endpoint and capture receipt required');
  for(const name of ['msbuild','pwsh'])if(typeof configuration.audio.toolchain[name]!=='string'||!isAbsolute(configuration.audio.toolchain[name]))fail('native_runtime_invalid','Absolute audio compiler and PowerShell paths required');
  destination=resolve(destination);await admitNativePath(dirname(destination),true);await absent(destination);await mkdir(destination);
  const bridgeIdentity=await admitNativePath(destination,true),bridgePath=join(destination,'bridge.json');
  const cfg=structuredClone(configuration),workerFactory=deps.workerFactory??createBoothWorker,audioFactory=deps.audioFactory??createBoothAudioRoute,viewerFactory=deps.viewerFactory??startViewer;
  const audioObserver=deps.audioObserver??(async options=>(await import('./booth-audio/route.mjs')).observeBoothAudio(options));
  const savePaths=deps.originalSavePaths??(()=>primarySaves(runtime.appdata));
  const receipt={version:1,provider:'windows-native-booth-bridge',bridge_id:randomUUID(),bridge_path:bridgePath,url:'',token:randomBytes(32).toString('hex'),status:'running'};
  const sessions=new Map(),bridgeFiles=new Map();let closed=false,closing=false,closePending,tail=Promise.resolve(),queued=0;
  async function write(directory,identity,registry,name,value){
    if(!same(await admitNativePath(directory,true),identity))fail('native_path_refused','Owned directory identity changed');
    const path=join(directory,name),known=registry.get(name),f=await open(path,known?constants.O_RDWR|(constants.O_NOFOLLOW??0):'wx',0o600);
    try{const stat=await f.stat(),named=await admitNativePath(path);if(!stat.isFile()||stat.nlink!==1||!same(stat,named)||known&&!same(stat,known)||!same(await admitNativePath(directory,true),identity))fail('native_path_refused','Owned metadata identity changed');await f.truncate(0);await f.writeFile(JSON.stringify(value));await f.sync();registry.set(name,await f.stat());}finally{await f.close();}
  }
  const record=(s,name,value)=>write(s.directory,s.identity,s.files,name,value);
  async function guardSession(s){
    if(!same(await admitNativePath(s.directory,true),s.identity)||!same(await admitNativePath(s.receipt.session_path),s.files.get('session.json')))fail('native_path_refused','Session identity changed');
    const actual=JSON.parse(await readNativeFile(s.receipt.session_path,512*1024));if(JSON.stringify(actual)!==JSON.stringify(s.receipt))fail('native_session_invalid','Owned session metadata changed');
  }
  const serialize=fn=>{if(closed||closing||queued>=32)return Promise.reject(new StudyError('native_host_busy','Bridge closed, closing or queue full'));queued++;const result=tail.then(fn);tail=result.catch(()=>{}).finally(()=>queued--);return result;};
  async function protect(s){for(const p of s.saves){if(p.exists){if(await nativeFileDigest(p.path)!==p.sha256)fail('native_original_save_changed','Original save or backup changed');}else await absent(p.path);}}
  async function artifacts(){
    await admitNativePath(cfg.runtime_root,true);const manifest=JSON.parse(await readNativeFile(join(cfg.runtime_root,'artifacts.json'),65536));
    const names=['proto-controller.exe','desktop-launcher.exe','bin/ProtoInputLoader64.dll','bin/ProtoInputHooks64.dll','gamepad-fixture.exe'];
    if(manifest.version!==1||manifest.mode!=='early'||Object.keys(manifest.sha256??{}).sort().join()!==names.sort().join())fail('native_runtime_invalid','Exact early runtime manifest required');
    for(const name of names)if(!/^[a-f0-9]{64}$/.test(manifest.sha256[name])||await nativeFileDigest(join(cfg.runtime_root,...name.split('/')))!==manifest.sha256[name])fail('native_artifact_changed','Early runtime artifact differs');return manifest;
  }
  async function audioStatus(s){
    const result=await audioObserver({target:{pid:s.ownership.pid,start_ticks_utc:s.startTicks,executable:s.ownership.executable},cable_endpoint:cfg.audio.cable_endpoint,pwsh:cfg.audio.toolchain.pwsh});
    if(result.identity_verified!==true||result.target?.pid!==s.ownership.pid||result.target?.start_ticks_utc!==s.startTicks||typeof result.target?.executable!=='string'||resolve(result.target.executable).toLowerCase()!==resolve(s.ownership.executable).toLowerCase())fail('native_audio_unproven','Audio observation target identity differs');
    if(!Number.isSafeInteger(result.active_on_cable)||result.active_on_cable<0||!Number.isSafeInteger(result.active_off_cable)||result.active_off_cable<0)fail('native_audio_unproven','Actual session audio counts unavailable');
    await record(s,'audio-observation.json',result);if(result.active_off_cable>0)fail('native_audio_isolation_failed','Owned target has active audio outside admitted Cable');return result;
  }
  async function observe(s){
    await audioStatus(s);
    const raw=await s.worker.request('inspect');if(!equalTarget(raw.ownership,s.ownership))fail('native_ownership_unproven','Frame ownership differs');
    const image=validateImage(raw.frame.data_url);if(image.mime!=='image/png'||image.width!==raw.frame.width||image.height!==raw.frame.height||hash(Buffer.from(image.encoded,'base64'))!==raw.frame.sha256)fail('native_frame_invalid','Actual frame dimensions or digest differ');
    const output=nativeInspectOutput.parse({provider:'windows-native',session_path:s.receipt.session_path,session_id:s.receipt.session_id,checkpoint_id:s.receipt.checkpoint_id,status:s.receipt.status==='starting'?'running':s.receipt.status,url:s.public.gameplay_url,visible_text:'',screenshot_image_base64:image.encoded,screenshot_mime_type:'image/png',window:{app:'process:'+s.ownership.executable,id:s.ownership.hwnd},screenshots:[{id:raw.frame.sha256,url:'',width:image.width,height:image.height,zIndex:0}],input_behavior:'owned-hidden-desktop-virtual-input'});
    await protect(s);s.observation=output;await record(s,'observation.json',output);return output;
  }
  async function cleanup(s,publish=true){
    if(s.receipt?.status==='stopped')return nativeStopOutput.parse({provider:'windows-native',session_path:s.public.session_path,session_id:s.public.session_id,checkpoint_id:s.public.checkpoint_id,status:'stopped'});
    if(s.cleanupComplete){if(publish){s.receipt.status='stopped';await record(s,'session.json',s.receipt);if(s.observation)await record(s,'observation.json',{...s.observation,status:'stopped'});}return nativeStopOutput.parse({provider:'windows-native',session_path:s.public.session_path,session_id:s.public.session_id,checkpoint_id:s.public.checkpoint_id,status:'stopped'});}
    clearTimeout(s.timer);const evidence={};
    try{
      let quiesceError;try{if(s.worker)evidence.quiesce=await s.worker.request('stop',{},30000);}catch(e){quiesceError=e;}
      if(s.viewer&&!s.viewerClosed){await s.viewer.close();s.viewerClosed=true;}evidence.viewer_closed=true;
      if(quiesceError)throw quiesceError;if(s.worker&&(evidence.quiesce.game_exited!==true||evidence.quiesce.controller_closed!==true))fail('native_shutdown_incomplete','Owned game/controller quiescence unproven');
      if(s.audioAttempted&&!s.audioRestored){evidence.audio=await s.audio.restore();if(evidence.audio.ok!==true)fail('native_shutdown_incomplete','Saved audio preferences not restored');s.audioRestored=true;}
      if(s.worker&&!s.boothClosed){evidence.booth=await s.worker.request('close',{},30000);if(evidence.booth.booth_closed!==true)fail('native_shutdown_incomplete','Owned desktop closure unproven');s.boothClosed=true;}
      if(s.worker&&!s.channelClosed){evidence.channel=await s.worker.close();if(evidence.channel.exited!==true)fail('native_shutdown_incomplete','Owned worker exit unproven');s.channelClosed=true;}
      await protect(s);await record(s,'cleanup.json',evidence);s.cleanupComplete=true;
      if(publish){s.receipt.status='stopped';await record(s,'session.json',s.receipt);if(s.observation)await record(s,'observation.json',{...s.observation,status:'stopped'});}
      return nativeStopOutput.parse({provider:'windows-native',session_path:s.public.session_path,session_id:s.public.session_id,checkpoint_id:s.public.checkpoint_id,status:'stopped'});
    }catch(e){await record(s,'cleanup-failure.json',{...diagnostic(e),evidence}).catch(()=>{});throw e;}
  }
  async function start(input,signal){
    if(input.backend!=='booth')fail('native_backend_unsupported','Booth backend must be explicit');
    if(resolve(input.bridge_path)!==bridgePath||input.lifetime_seconds>3600)fail('native_bridge_invalid','Selected bridge or lifetime differs');
    if([...sessions.values()].some(s=>!s.boothClosed))fail('native_host_busy','Resolve the existing owned session first');
    for(const p of [input.checkpoint,destination,dirname(input.game_executable),dirname(input.me3_executable),cfg.runtime_root,runtime.appdata])if(overlap(input.destination,p))fail('native_path_refused','Session overlaps protected input/provider path');
    await admitNativePath(dirname(input.destination),true);await absent(input.destination);const checkpoint=await verifyFileCheckpoint(input.checkpoint);
    const game={path:input.game_executable,sha256:await nativeFileDigest(input.game_executable)},me3={path:input.me3_executable,sha256:await nativeFileDigest(input.me3_executable)};
    if(checkpoint.files.find(f=>f.path==='game/eldenring.exe')?.sha256!==game.sha256)fail('native_baseline_mismatch','Captured game identity differs');
    const pins=await artifacts(),paths=await savePaths(),saves=[];for(const path of paths){await absent(join(dirname(path),input.savefile));await absent(join(dirname(path),input.savefile+'.bak'));for(const p of [path,path+'.bak'])try{saves.push({path:p,exists:true,sha256:await nativeFileDigest(p)});}catch(e){if(e.code!=='ENOENT')throw e;saves.push({path:p,exists:false});}}
    let seed;if(input.save_seed){if(paths.length!==1||overlap(input.destination,input.save_seed.checkpoint))fail('native_seed_target_ambiguous','Seed needs one separate primary-save directory');const cp=await verifyFileCheckpoint(input.save_seed.checkpoint),member=cp.files.find(f=>f.path===input.save_seed.path);if(!member||member.bytes>64*1024**2)fail('native_seed_invalid','Bounded captured save member required');const bytes=await readNativeFile(join(cp.checkpoint,'payload',...member.path.split('/')),64*1024**2);if(hash(bytes)!==member.sha256||bytes.length!==member.bytes)fail('native_seed_invalid','Seed identity differs');seed={bytes,metadata:{checkpoint_id:cp.checkpoint_id,member:member.path,sha256:member.sha256,created_save_path:join(dirname(paths[0]),input.savefile)}};}
    signal?.throwIfAborted();await mkdir(input.destination);const s={directory:resolve(input.destination),identity:await admitNativePath(input.destination,true),files:new Map(),saves,input};
    try{
      await restoreFileCheckpoint({checkpoint:input.checkpoint,destination:join(s.directory,'game')});
      const profilePath=join(s.directory,'baseline.me3'),profileText=`profileVersion = "v1"\nsavefile = ${JSON.stringify(input.savefile)}\npackages = []\nstart_online = false\nmem_patch = false\ndisable_arxan = false\n\n[[natives]]\npath = ${JSON.stringify(join(cfg.runtime_root,'bin','ProtoInputHooks64.dll').replaceAll('\\','/'))}\noptional = false\nenabled = true\nload_early = true\ninitializer = { function = "NostalgiaEarlyXInputInitialize" }\n\n[[supports]]\ngame = "eldenring"\n\n[debug_properties]\n`;
      const f=await open(profilePath,'wx',0o600);try{await f.writeFile(profileText);}finally{await f.close();}
      s.public=nativeStartOutput.parse({provider:'windows-native',session_path:join(s.directory,'session.json'),session_id:randomUUID(),checkpoint_id:checkpoint.checkpoint_id,gameplay_url:'native://'+randomUUID(),audience:input.audience,working_directory:join(s.directory,'game'),savefile:input.savefile,runtime:{provider:'windows-native-booth-protoinput',game,me3,profile:{path:profilePath,sha256:hash(profileText)},mode:'application-offline'},...(seed?{save_seed:seed.metadata}:{}),coverage:'declared-files-copied-shared-game-assets-referenced',input_behavior:'owned-hidden-desktop-virtual-input',guarantees:['Owned inactive desktop and exact process/window identity required','Original saves and backups hashed before and after operations','Alternate save filename and explicit virtual-input leases'],limitations:['Shared game assets remain referenced','Application offline flags are not an OS network sandbox','ME3 may copy an original save into an absent alternate filename','Game imported DLL initialization and TLS silence is not established','Fixture validation does not establish game compatibility']});
      s.receipt=nativeSessionReceiptSchema.parse({...s.public,bridge_path:bridgePath,status:'starting',expires_at:new Date(Date.now()+input.lifetime_seconds*1000).toISOString()});sessions.set(s.receipt.session_path,s);await record(s,'session.json',s.receipt);await record(s,'protected-saves.json',saves);await record(s,'runtime-pins.json',pins);
      if(seed){const parent=await admitNativePath(dirname(seed.metadata.created_save_path),true),f=await open(seed.metadata.created_save_path,'wx',0o600);try{if(!same(parent,await admitNativePath(dirname(seed.metadata.created_save_path),true)))fail('native_path_refused','Seed parent changed');await f.writeFile(seed.bytes);}finally{await f.close();}if(await nativeFileDigest(seed.metadata.created_save_path)!==seed.metadata.sha256)fail('native_seed_invalid','Created seed differs');await record(s,'seed.json',seed.metadata);}
      s.worker=await workerFactory({python:cfg.python,diagnostics_directory:s.directory});signal?.throwIfAborted();
      const allocated=await s.worker.request('allocate',{runtime_root:cfg.runtime_root,ws_script:cfg.ws_script,ws_session:cfg.ws_session,task:cfg.task,run_directory:s.directory,lifetime_minutes:Math.min(60,Math.ceil(input.lifetime_seconds/60)+2)},40000);s.allocation=allocated;await record(s,'allocation.json',allocated);
      if(allocated.phase!=='await_parent_audio'||typeof allocated.desktop!=='string'||!Number.isSafeInteger(allocated.open_receipt?.ends_ms))fail('native_ownership_unproven','Actual allocation lease is absent');
      if(typeof allocated.appdata!=='string'||!isAbsolute(allocated.appdata)||resolve(allocated.appdata).toLowerCase()!==resolve(runtime.appdata).toLowerCase())fail('native_profile_unknown','Actual worker APPDATA differs from protected save directory');
      const expires=Math.min(Date.parse(s.receipt.expires_at),allocated.open_receipt.ends_ms-120000);if(expires<=Date.now())fail('native_lifetime_invalid','Booth lease has no cleanup reserve');s.receipt.expires_at=new Date(expires).toISOString();await record(s,'session.json',s.receipt);
      s.audio=await audioFactory({destination:join(s.directory,'audio-route'),target:game,desktop:allocated.desktop,booth_receipt:allocated.open_receipt,toolchain:cfg.audio.toolchain,cable_endpoint:cfg.audio.cable_endpoint});s.audioAttempted=true;const audio=await s.audio.seed();await record(s,'audio-seed.json',audio);if(audio.ok!==true)fail('native_audio_failed','Owned audio routing not verified');signal?.throwIfAborted();
      await artifacts();const launch=await s.worker.request('launch',{me3_executable:me3.path,game_executable:game.path,profile:profilePath,savefile:input.savefile,game_sha256:game.sha256,me3_sha256:me3.sha256},110000);await record(s,'launch.json',launch);
      if(launch.phase!=='ready'||!ownedTarget(launch.ownership,game.path,allocated.desktop)||launch.early_status?.stage!==2||launch.early_status?.result!==1||launch.early_status?.late_calls!==0)fail('native_ownership_unproven','Early owned game admission differs');s.ownership=launch.ownership;
      const ticks=(BigInt(s.ownership.created_high)*4294967296n+BigInt(s.ownership.created_low)+504911232000000000n).toString();s.startTicks=ticks;
      const audioDeadline=Date.now()+30000;let actualAudio;do{signal?.throwIfAborted();actualAudio=await audioStatus(s);if(Date.now()>audioDeadline)fail('native_audio_unproven','Actual audio observation arrived after30second admission deadline');if(actualAudio.active_on_cable>0)break;await new Promise(r=>setTimeout(r,250));}while(Date.now()<audioDeadline);
      if(actualAudio.active_on_cable<1)fail('native_audio_unproven','No active owned Cable session appeared within30seconds');await record(s,'audio-admission.json',actualAudio);
      s.viewer=await viewerFactory({'--pid':String(s.ownership.pid),'--ticks':ticks,'--exe':game.path,'--booth-stream-url':viewerStream(launch.viewer_url),'--tool-receipt':cfg.audio.tool_receipt,'--receipt':join(s.directory,'viewer.json')});s.public.gameplay_url=s.viewer.url;s.receipt.gameplay_url=s.viewer.url;
      await observe(s);await protect(s);for(const a of [game,me3,s.public.runtime.profile])if(await nativeFileDigest(a.path)!==a.sha256)fail('native_artifact_changed','Launch artifact changed');signal?.throwIfAborted();
      s.receipt.status='running';await record(s,'session.json',s.receipt);s.timer=setTimeout(()=>{void serialize(()=>cleanup(s)).catch(()=>{});},Math.max(0,Date.parse(s.receipt.expires_at)-Date.now()));return s.public;
    }catch(e){if(s.receipt){s.receipt.status='failed';await record(s,'session.json',s.receipt).catch(()=>{});}await record(s,'failure.json',diagnostic(e)).catch(()=>{});try{await cleanup(s,false);}catch{}throw e;}
  }
  const requestSchema=z.discriminatedUnion('operation',[z.strictObject({operation:z.literal('start'),input:nativeStartInput}),...['inspect','focus','stop'].map(operation=>z.strictObject({operation:z.literal(operation),session_path:z.string().max(4096)})),z.strictObject({operation:z.literal('act'),session_path:z.string().max(4096),action:nativeActionSchema})]);
  async function operationInner(raw,signal){signal?.throwIfAborted();if(!same(await admitNativePath(destination,true),bridgeIdentity))fail('native_path_refused','Bridge directory identity changed');const request=requestSchema.parse(raw);if(request.operation==='start')return start(request.input,signal);const s=sessions.get(resolve(request.session_path));if(!s)fail('native_session_unknown','Bridge does not own selected session');if(request.operation==='stop')return cleanup(s);await guardSession(s);if(s.receipt.status!=='running'||Date.now()>=Date.parse(s.receipt.expires_at))fail('native_session_stopped','Session is not running within its lifetime');
    if(request.operation==='inspect')return observe(s);if(request.operation==='focus'){const focus=await s.worker.request('focus');if(!equalTarget(focus.ownership,s.ownership)||focus.owner_desktop_changed!==false)fail('native_ownership_unproven','Hidden selection differs');return nativeFocusOutput.parse({focused:true,observation:await observe(s)});}
    const action=request.action;if(!['gamepad','wait'].includes(action.kind))fail('native_action_unsupported','Booth bridge currently supports leased gamepad and bounded wait');if((s.actionSequence??0)>=10000)fail('native_limit','Session reached its10000action record bound');await artifacts();for(const a of [s.public.runtime.game,s.public.runtime.me3,s.public.runtime.profile])if(await nativeFileDigest(a.path)!==a.sha256)fail('native_artifact_changed','Selected launch artifact changed');await observe(s);
    s.actionSequence=(s.actionSequence??0)+1;const prefix='action-'+String(s.actionSequence).padStart(4,'0');await record(s,prefix+'-attempt.json',{action,at:new Date().toISOString()});
    try{signal?.throwIfAborted();if(Date.now()>=Date.parse(s.receipt.expires_at))fail('native_session_stopped','Session lifetime ended before input');let result;if(action.kind==='wait'){await new Promise(r=>setTimeout(r,action.milliseconds));result={bounded_wait_complete:true};}else{const {kind,...state}=action;result=await s.worker.request('gamepad',{state});if(result.ok!==true||result.pid!==s.ownership.pid||result.hwnd!==s.ownership.hwnd)fail('native_input_unproven','Owned controller acknowledgment differs');}await record(s,prefix+'-receipt.json',result);const observation=await observe(s);await record(s,prefix+'-observed.json',{session_id:observation.session_id,checkpoint_id:observation.checkpoint_id,frame_sha256:observation.screenshots[0].id});return nativeActOutput.parse({action,observation});}catch(e){await record(s,prefix+'-failure.json',diagnostic(e)).catch(()=>{});throw e;}
  }
  async function operation(raw,signal){try{return await operationInner(raw,signal);}catch(error){if(error.code==='native_audio_isolation_failed'&&typeof raw?.session_path==='string'){const s=sessions.get(resolve(raw.session_path));if(s){s.receipt.status='failed';await record(s,'session.json',s.receipt).catch(()=>{});await record(s,'audio-isolation-failure.json',diagnostic(error)).catch(()=>{});try{await cleanup(s);}catch{/* Exact cleanup failure retained; input remains disabled. */}}}throw error;}}
  const server=createServer((req,res)=>{void(async()=>{const auth=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+receipt.token);if(req.method!=='POST'||req.url!=='/control'||req.headers.host!==`127.0.0.1:${server.address().port}`||req.headers.origin!==undefined||auth.length!==expected.length||!timingSafeEqual(auth,expected)){res.writeHead(403).end();return;}const signal=new AbortController();res.once('close',()=>{if(!res.writableEnded)signal.abort();});let count=0,chunks=[];for await(const b of req){count+=b.length;if(count>16384)fail('native_limit','Request exceeds16KiB');chunks.push(b);}const raw=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks))),output=await serialize(()=>operation(raw,signal.signal));const body=JSON.stringify(output);if(Buffer.byteLength(body)>24*1024**2)fail('native_limit','Response exceeds24MiB');res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',connection:'close'}).end(body);})().catch(e=>{if(!res.destroyed)res.writeHead(400,{'content-type':'application/json',connection:'close'}).end(JSON.stringify(diagnostic(e)));});});server.requestTimeout=350000;server.headersTimeout=10000;
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});receipt.url=`http://127.0.0.1:${server.address().port}/control`;try{await write(destination,bridgeIdentity,bridgeFiles,'bridge.json',nativeBridgeReceiptSchema.parse(receipt));}catch(e){server.close();throw e;}
  return {bridge_path:bridgePath,dispatch:(r,s)=>serialize(()=>operation(r,s)),async close(){if(closed)return {status:'closed',bridge_path:bridgePath};if(closePending)return closePending;const pending=serialize(async()=>{for(const s of sessions.values())if(s.receipt?.status!=='stopped')await cleanup(s,s.receipt?.status!=='failed');receipt.status='closed';await write(destination,bridgeIdentity,bridgeFiles,'bridge.json',receipt);closed=true;await new Promise((done,reject)=>server.close(e=>e?reject(e):done()));return {status:'closed',bridge_path:bridgePath};});closing=true;closePending=pending.catch(e=>{closing=false;closePending=undefined;throw e;});return closePending;}};
}
