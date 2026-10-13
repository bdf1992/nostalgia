import http from 'node:http';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
async function loadTool(receiptPath){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 process capture required');
 const info=await lstat(receiptPath);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Invalid local tool receipt');
 const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
 if(receipt.format!==1||receipt.provider!=='process-loopback-target-tree'||receipt.status!=='built-no-runtime-validation'||receipt.platform!=='win32'||receipt.arch!=='x64'||receipt.ipc!=='NPCM-v1-44100-stereo-s16le'||!/^[a-f0-9]{64}$/.test(receipt.sha256)||receipt.executable!=='bin/ProcessAudioStream.exe')throw Error('Unsupported local tool receipt');
 const sourceHash=createHash('sha256').update(await readFile(path.join(here,'ProcessAudioStream.cpp'))).digest('hex');if(receipt.source_sha256!==sourceHash)throw Error('Tool receipt belongs to different capture source');
 const helper=path.resolve(path.dirname(receiptPath),receipt.executable);const binary=await lstat(helper);if(!binary.isFile()||binary.isSymbolicLink()||binary.size>16777216)throw Error('Invalid capture executable');
 if(createHash('sha256').update(await readFile(helper)).digest('hex')!==receipt.sha256)throw Error('Streamer digest mismatch');return {helper,admittedHash:receipt.sha256};
}
const expectedHeader=Buffer.from([0x4e,0x50,0x43,0x4d,1,0,0,0,0x44,0xac,0,0,2,0,0,0,16,0,0,0,4,0,0,0]);
function args(argv){const options={};for(let i=0;i<argv.length;i+=2){if(!['--pid','--ticks','--exe','--booth-stream-url','--receipt','--tool-receipt'].includes(argv[i])||!argv[i+1]||options[argv[i]])throw Error('Invalid CLI options');options[argv[i]]=argv[i+1];}if(!/^\d+$/.test(options['--pid']??'')||!/^\d+$/.test(options['--ticks']??'')||!path.isAbsolute(options['--exe']??''))throw Error('Exact target identity required');if(!path.isAbsolute(options['--tool-receipt']??''))throw Error('Absolute local tool receipt required');if(!options['--booth-stream-url'])throw Error('Booth MJPEG URL required');const u=new URL(options['--booth-stream-url']);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.hash)throw Error('Booth URL must be loopback HTTP');return options;}
export async function startGameplayProvider(options,{input,load=loadTool,launch=spawn}={}){
 options=args(Object.entries(options).flat());
 const {helper,admittedHash}=await load(options['--tool-receipt']);
 const token=randomBytes(32).toString('hex');let active=null,closing=false,launching=false,abortLaunching=false;const sessions=[];
 const authorized=req=>{const value=req.headers['x-viewer-token']??new URL(req.url,'http://127.0.0.1').searchParams.get('token')??'';return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(token));};
 const stop=async session=>{if(!session||session.stopPromise)return session?.stopPromise;session.stopPromise=(async()=>{if(!session.finished){session.child.stdin.end('stop\n');await Promise.race([session.exited,new Promise(r=>setTimeout(r,2500))]);if(!session.finished){session.child.kill();await Promise.race([session.exited,new Promise(r=>setTimeout(r,2500))]);}}if(!session.finished)throw Error('Owned audio helper did not exit');})();return session.stopPromise;};
 async function send(res,bytes){if(res.destroyed)throw Error('Viewer disconnected');if(!res.write(bytes)){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('Transport drain deadline')),2000);const drain=()=>finish();const close=()=>finish(Error('Viewer disconnected'));function finish(error){clearTimeout(timer);res.off('drain',drain);res.off('close',close);error?reject(error):resolve();}res.once('drain',drain);res.once('close',close);});}if(res.writableLength>131072)throw Error('Transport queue bound');}
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');if(req.headers.host!==`127.0.0.1:${server.address().port}`||!authorized(req)){res.writeHead(403).end();return;}if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${server.address().port}`){res.writeHead(403).end();return;}
  if(req.method==='POST'&&url.pathname==='/input'){
   if(closing||typeof input!=='function'){res.writeHead(409).end();return;}
   let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384){res.writeHead(413).end();return;}chunks.push(chunk);}
   const state=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));
   const result=await input(state);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(result));return;
  }
  if(req.method==='GET'&&url.pathname==='/status'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({active:!!active,sessions}));return;}
  if(req.method==='POST'&&url.pathname==='/stop'){abortLaunching=true;await stop(active);res.writeHead(200).end();return;}
  if(req.method!=='POST'||url.pathname!=='/audio'){res.writeHead(404).end();return;}if(active||launching||closing){res.writeHead(409).end('Capture already active');return;}
  launching=true;abortLaunching=false;try{const refreshed=await load(options['--tool-receipt']);if(refreshed.helper!==helper||refreshed.admittedHash!==admittedHash)throw Error('Streamer admission changed');if(closing||abortLaunching||res.destroyed)throw Error('Capture launch cancelled');}finally{launching=false;}
  const child=launch(helper,[options['--pid'],options['--ticks'],options['--exe'],'120'],{windowsHide:true,stdio:['pipe','pipe','pipe']});const session={child,pid:child.pid,bytes:0,records:0,clean:false,interrupted:false,stderr:''};active=session;session.exited=new Promise(resolve=>{child.once('exit',(code,signal)=>{session.code=code;session.signal=signal;session.finished=true;resolve();});child.once('error',e=>{session.error=e.message;session.finished=true;resolve();});});child.stdin.on('error',()=>{});child.stderr.on('data',data=>{if(session.stderr.length<8192)session.stderr+=data.toString().slice(0,8192-session.stderr.length);});
  const disconnect=()=>{void stop(session).catch(e=>{session.error=e.message;});};res.once('close',disconnect);const deadline=setTimeout(()=>{session.interrupted=true;res.destroy();disconnect();},122500);
  let buffer=Buffer.alloc(0),header=false,total=0;
  try{for await(const chunk of child.stdout){if(chunk.length>65536||buffer.length+chunk.length>131096)throw Error('NPCM input queue bound');buffer=Buffer.concat([buffer,chunk]);if(!header&&buffer.length>=24){if(!buffer.subarray(0,24).equals(expectedHeader))throw Error('Unsupported NPCM header');header=true;buffer=buffer.subarray(24);res.writeHead(200,{'content-type':'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});await send(res,expectedHeader);}
    while(header&&buffer.length>=4){const length=buffer.readUInt32LE(0);if(length===0){if(buffer.length!==4)throw Error('Trailing NPCM bytes after terminator');await send(res,buffer);buffer=Buffer.alloc(0);session.clean=true;break;}if(length>65536||length%4)throw Error('Invalid NPCM record length');if(buffer.length<4+length)break;total+=length;if(total>120*176400+65536)throw Error('PCM lifetime bound');await send(res,buffer.subarray(0,4+length));session.bytes=total;session.records++;buffer=buffer.subarray(4+length);}if(session.clean)break;}
   if(!header)throw Error('Capture failed before format header');if(!session.clean||buffer.length)session.interrupted=true;
  }catch(e){session.error=e.message;session.interrupted=true;if(!res.headersSent)res.writeHead(502,{'content-type':'text/plain'});}
  finally{clearTimeout(deadline);await stop(session);res.off('close',disconnect);if(!res.destroyed)res.end();sessions.push({pid:session.pid,bytes:session.bytes,records:session.records,clean:session.clean,interrupted:session.interrupted,exit:session.code,signal:session.signal,error:session.error,stderr:session.stderr});if(sessions.length>16)sessions.shift();active=null;}
 }catch(e){if(!res.headersSent)res.writeHead(500);if(!res.destroyed)res.end('Viewer operation failed');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const url=`http://127.0.0.1:${server.address().port}`;
 const close=async()=>{closing=true;await stop(active);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};return {url,token,server,close,sessions};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const options=args(process.argv.slice(2));const provider=await startGameplayProvider(options);try{if(options['--receipt'])await writeFile(options['--receipt'],JSON.stringify({url:provider.url,target_pid:options['--pid'],target_ticks:options['--ticks'],target_exe:options['--exe'],tool_receipt:options['--tool-receipt']},null,2),{flag:'wx'});}catch(e){await provider.close();throw e;}process.stdout.write('Private gameplay provider started\n');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void provider.close().then(()=>process.exit(0)).catch(e=>{process.stderr.write('Owned capture shutdown failed: '+e.message+'\n');process.exitCode=1;});});}
