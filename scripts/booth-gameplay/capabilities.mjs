import {lstat,open,unlink,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function regular(path,limit=65536){
 const before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>limit)throw Error('Booth registration requires a bounded regular file');
 const file=await open(path,'r');try{const held=await file.stat();if(held.dev!==before.dev||held.ino!==before.ino)throw Error('Booth registration identity changed');const data=await file.readFile();const after=await file.stat();if(data.length>limit||after.size!==held.size||after.mtimeMs!==held.mtimeMs)throw Error('Booth registration changed during read');return {data,identity:held};}finally{await file.close();}
}

/** Register capabilities on the existing owned Booth; this creates no viewer or desktop. */
export async function attachBoothCapabilities({runtime_root,viewer_url,allocation,provider,expires_at,ws_session,task}){
 if(!isAbsolute(runtime_root??'')||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(allocation.booth??''))throw Error('Explicit Booth runtime and name required');
 const root=resolve(runtime_root),home=join(root,allocation.booth),record=allocation.open_receipt;
 for(const dir of [root,home]){const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink()||resolve(await realpath(dir)).toLowerCase()!==dir.toLowerCase())throw Error('Booth directory alias refused');}
 const actual=JSON.parse((await regular(join(root,allocation.booth+'.json'))).data);
 const meta=JSON.parse((await regular(join(home,'meta.json'))).data);
 if(actual.name!==allocation.booth||actual.source_session!==ws_session||actual.source_task!==task||actual.desktop_name!==allocation.desktop||actual.recording_id!==record.recording_id||meta.recording_id!==record.recording_id||meta.opened_ms!==record.opened_ms)throw Error('Booth recording ownership differs');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.recording_id)||!Number.isSafeInteger(record.opened_ms)||!Number.isFinite(Date.parse(expires_at))||Date.parse(expires_at)<=Date.now())throw Error('Booth recording lease invalid');
 const endpoint=new URL(provider.url);if(!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(provider.url)||Number(endpoint.port)>65535||!/^[a-f0-9]{64}$/.test(provider.token))throw Error('Private gameplay provider identity invalid');
 const viewer=new URL(viewer_url);if(viewer.protocol!=='http:'||viewer.hostname!=='127.0.0.1'||!viewer.port||viewer.username||viewer.password||viewer.pathname!=='/booth/watch'||viewer.search||viewer.hash)throw Error('Existing Booth watch page required');
 const path=join(home,'gameplay.json'),bytes=Buffer.from(JSON.stringify({version:1,recording_id:record.recording_id,opened_ms:record.opened_ms,expires_at,provider_url:provider.url,provider_token:provider.token}));
 const file=await open(path,'wx',0o600);let identity;try{await file.writeFile(bytes);identity=await file.stat();}finally{await file.close();}
 viewer.hash='r='+record.recording_id;let revoked=false;
 return {url:viewer.toString(),recording_id:record.recording_id,async close(){if(revoked)return;const current=await regular(path);if(current.identity.dev!==identity.dev||current.identity.ino!==identity.ino||digest(current.data)!==digest(bytes))throw Error('Owned Booth capabilities replaced; refusing removal');await unlink(path);revoked=true;}};
}
