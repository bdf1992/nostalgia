"""Read-only binding for root's already-owned WS launch. No launch/input/kill.
The caller supplies the trusted WS action receipt; its labels are not authentication.
"""
import argparse,base64,datetime,json,os,re,subprocess,sys,threading
from dataclasses import dataclass
from pathlib import Path
from controller_bridge import read_owned_process_metadata
@dataclass(frozen=True)
class BindingConfig:
 ws_script:Path
 ws_session:str
 game_executable:str
 me3_executable:str
 launcher_executable:str
 conhost_executable:str
 launch_window_ns:tuple[int,int]|None=None
 def validate(self):
  for path in (self.ws_script,self.game_executable,self.me3_executable,self.launcher_executable,self.conhost_executable):
   if not Path(path).is_absolute() or not Path(path).is_file():raise ValueError('Exact existing absolute provider/executable paths required')
  if self.launch_window_ns is not None:
   window=self.launch_window_ns
   if not isinstance(window,tuple) or len(window)!=2 or any(type(v) is not int or v<=0 for v in window) or not 0<=window[1]-window[0]<=45000000000:raise ValueError('Trusted launch interval must be positive ordered integers within45sec')
  if not isinstance(self.ws_session,str) or not 1<=len(self.ws_session)<=128:raise ValueError('Explicit WS session required')
def norm(path):return os.path.normcase(os.path.normpath(path)) if isinstance(path,(str,os.PathLike)) else ''
def bounded_json(path):
 p=Path(path)
 if not p.is_absolute() or p.is_symlink():raise ValueError('Absolute regular receipt required')
 with p.open('rb') as f:raw=f.read(262145)
 if len(raw)>262144:raise ValueError('Receipt exceeds256KiB')
 return json.loads(raw)
def command(args,config,timeout=10):
 p=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=dict(os.environ,WS_SESSION=config.ws_session))
 streams={};errors=[];workers=[]
 def consume(name,stream,limit):
  data=bytearray();exceeded=False
  while True:
   block=stream.read(16384)
   if not block:break
   if len(data)+len(block)>limit:exceeded=True
   elif not exceeded:data.extend(block)
  if exceeded:errors.append(name+' exceeded output bound')
  streams[name]=bytes(data)
 for name,stream,limit in [('out',p.stdout,262144),('err',p.stderr,16384)]:
  worker=threading.Thread(target=consume,args=(name,stream,limit),daemon=True);worker.start();workers.append(worker)
 try:p.wait(timeout=timeout)
 except subprocess.TimeoutExpired:
  p.kill();p.wait(timeout=2);raise RuntimeError('Owned read-only command deadline expired')
 finally:
  for worker in workers:worker.join(timeout=2)
 if errors or any(w.is_alive() for w in workers) or p.returncode:raise RuntimeError('Read-only command refused or exceeded output bound')
 return json.loads(streams['out'])
def inventory(config):
 # Fixed read-only process metadata; no script text comes from receipt paths.
 script="Get-CimInstance Win32_Process | Where-Object {$_.Name -in @('eldenring.exe','me3.exe','me3-launcher.exe','conhost.exe')} | ForEach-Object {[pscustomobject]@{pid=[int]$_.ProcessId;parent_pid=[int]$_.ParentProcessId;executable=$_.ExecutablePath}} | ConvertTo-Json -Compress"
 encoded=base64.b64encode(script.encode('utf-16le')).decode()
 value=command([str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'),'-NoProfile','-NonInteractive','-EncodedCommand',encoded],config)
 return {r['pid']:r for r in ([value] if isinstance(value,dict) else value)}
def chain_for(rows,pid,rootpid,config):
 chain=[]
 for expected in (config.game_executable,config.launcher_executable,config.me3_executable,config.conhost_executable):
  row=rows.get(pid)
  if not row or norm(row.get('executable',''))!=norm(expected):return None
  meta=read_owned_process_metadata(pid,expected);chain.append(dict(row,**{k:v for k,v in meta.items() if k!='pid'}))
  pid=row['parent_pid']
 if chain[-1]['pid']!=rootpid:return None
 ticks=[(r['created_high']<<32)|r['created_low'] for r in chain]
 if not all(ticks[i]>=ticks[i+1] for i in range(3)):raise RuntimeError('Owned process creation ordering refused')
 return chain
def bind(receipt_path,booth,run_directory,config:BindingConfig):
 config.validate()
 if not re.fullmatch(r'nostalgia-[a-z0-9-]{1,100}',booth):raise ValueError('Exact Nostalgia Booth name required')
 run=Path(run_directory)
 if not run.is_absolute() or not run.is_dir() or run.is_symlink():raise ValueError('Existing absolute owned run directory required')
 if any((run/name).exists() for name in ('game-owned.json','owned-process-chain.json','binding-receipt.json')):raise ValueError('Fresh output filenames required; inspect existing binding')
 receipt=bounded_json(receipt_path)
 if receipt.get('action_outcome')!='ok' or receipt.get('booth')!=booth or receipt.get('event_pending') is not False:raise ValueError('Completed trusted WS launch receipt required')
 cmd=receipt.get('command',[]);rootpid=receipt.get('pid')
 if type(rootpid) is not int or rootpid<=0 or len(cmd)<2 or norm(cmd[0])!=norm(config.conhost_executable) or norm(cmd[1])!=norm(config.me3_executable):raise ValueError('Exact pinned launch ancestry required')
 event=re.fullmatch(r'E-(\d{8}T\d{6}Z)-[a-z0-9]+',receipt.get('event_id',''))
 if not event:raise ValueError('WS launch event timestamp required')
 rootmeta=read_owned_process_metadata(rootpid,config.conhost_executable)
 created=((rootmeta['created_high']<<32)|rootmeta['created_low'])/10000000-11644473600
 launched=datetime.datetime.strptime(event[1],'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()
 if config.launch_window_ns is not None:
  created_ns=((rootmeta['created_high']<<32)|rootmeta['created_low'])*100-11644473600000000000
  if not config.launch_window_ns[0]<=created_ns<=config.launch_window_ns[1]:raise RuntimeError('Launch PID creation outside worker-owned launch interval')
 elif abs(created-launched)>2:raise RuntimeError('Launch PID creation does not match owned event')
 rows=inventory(config);candidates=[chain_for(rows,r['pid'],rootpid,config) for r in rows.values() if norm(r.get('executable',''))==norm(config.game_executable)];candidates=[c for c in candidates if c]
 if len(candidates)!=1:raise RuntimeError('Exact owned game ancestry absent or ambiguous')
 chain=candidates[0];windows=command([sys.executable,str(config.ws_script),'booth','--json','do',booth,'windows'],config)
 if windows.get('booth')!=booth:raise RuntimeError('Booth inventory identity changed')
 selected=[w for w in windows.get('windows',[]) if w.get('pid')==chain[0]['pid'] and type(w.get('handle')) is int and w['handle']>0]
 if len(selected)!=1:raise RuntimeError('Exact owned game window absent or ambiguous')
 if chain_for(inventory(config),chain[0]['pid'],rootpid,config)!=chain:raise RuntimeError('Owned process ancestry changed during binding')
 owned={k:chain[0][k] for k in ('pid','created_high','created_low','executable')};owned.update(hwnd=selected[0]['handle'],desktop='ws-booth-'+booth)
 result={'owned':owned,'chain':chain,'launch_receipt':str(Path(receipt_path)),'launch_event':receipt['event_id'],'scope':'trusted root launch receipt plus live read-only identity; no target operation'}
 # Exclusive writes: any prior binding requires root to inspect it explicitly.
 with (run/'owned-process-chain.json').open('x') as f:json.dump(chain,f,indent=2)
 with (run/'game-owned.json').open('x') as f:json.dump(owned,f,indent=2)
 with (run/'binding-receipt.json').open('x') as f:json.dump(result,f,indent=2)
 return result
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('receipt');parser.add_argument('booth');parser.add_argument('run')
 for field in ('ws-script','ws-session','game-exe','me3-exe','launcher-exe','conhost-exe'):parser.add_argument('--'+field,required=True)
 args=parser.parse_args();config=BindingConfig(Path(args.ws_script),args.ws_session,args.game_exe,args.me3_exe,args.launcher_exe,args.conhost_exe)
 print(json.dumps(bind(args.receipt,args.booth,args.run,config),indent=2))
