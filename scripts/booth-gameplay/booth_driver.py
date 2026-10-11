"""Local Booth/ProtoInput driver. Trusted root callbacks own admission and binding.
Only an explicit caller-approved launch plan is operated; metadata is not authentication.
"""
from __future__ import annotations
import hashlib,json,os,queue,struct,subprocess,sys,threading,time,uuid,zlib
from dataclasses import dataclass
from pathlib import Path
_CONTROLLER_ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(_CONTROLLER_ROOT))
from controller_bridge import Controller,OwnedBoothTarget,read_owned_process_metadata
_ROOT=Path(__file__).resolve().parent

CAPABILITIES={'screenshot':True,'discrete_keyboard':True,'synthetic_gamepad_state':True,'focus_select_owned_window':True,'click':False,'controller_axes':False,'game_launch_admitted_by_default':False}
class Refusal(RuntimeError):pass
@dataclass(frozen=True)
class LaunchSpec:
 executable:str
 arguments:tuple[str,...]
 target_executable:str
 task:str
 ws_session:str
 width:int=320
 height:int=240
 fps:int=4
 duration_minutes:int=2
class Driver:
 def __init__(self,*,verify_preflight,bind_owned_target,ws_script:Path,runtime_root:Path,workspace_root:Path):
  if not callable(verify_preflight) or not callable(bind_owned_target):raise Refusal('Trusted root admission and process-binding hooks are required')
  self._ws_script=Path(ws_script);self._runtime=Path(runtime_root);self._workspace=Path(workspace_root)
  for path in (self._ws_script,self._runtime,self._workspace):
   if not path.is_absolute() or path.is_symlink() or not path.exists():raise Refusal('Explicit existing local provider paths required')
  self._verify=verify_preflight;self._bind=bind_owned_target;self._lock=threading.Lock();self._callback_busy=False;self.controller=None;self.target=None;self.receipt=None;self.name=None;self.run=None;self.spec=None;self.status='idle';self._owned=False;self._opening=False;self._sequence=0
 def _callback(self,hook,*args):
  if self._callback_busy:raise Refusal('Previous trusted callback remains unresolved')
  result=queue.Queue(maxsize=1);self._callback_busy=True
  def execute():
   try:result.put((True,hook(*args)))
   except BaseException as error:result.put((False,error))
  thread=threading.Thread(target=execute,daemon=True);thread.start()
  try:ok,value=result.get(timeout=5)
  except queue.Empty:raise Refusal('Trusted read-only callback deadline expired') from None
  self._callback_busy=False
  if not ok:raise value
  return value
 def _record(self,kind,value):
  file=self.run/f'{self._sequence:04d}-{kind}.json';self._sequence+=1
  with file.open('x',encoding='utf-8') as out:json.dump(value,out,indent=2);out.write('\n')
 def _ws(self,*args,timeout=25):
  env=dict(os.environ,WS_SESSION=self.spec.ws_session)
  proc=subprocess.Popen([sys.executable,str(self._ws_script),'booth','--json',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
  streams={};errors=[];threads=[]
  def read(name,stream):
   data=bytearray()
   try:
    while True:
     chunk=stream.read(16384)
     if not chunk:break
     if len(data)+len(chunk)>256*1024:raise Refusal('WS response exceeds 256KiB')
     data.extend(chunk)
    streams[name]=bytes(data)
   except BaseException as error:errors.append(error)
  for name,stream in [('out',proc.stdout),('err',proc.stderr)]:
   worker=threading.Thread(target=read,args=(name,stream),daemon=True);worker.start();threads.append(worker)
  try:proc.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   proc.kill();proc.wait(timeout=5);raise Refusal(f'Owned WS command timed out; effect may be incomplete: {args[0]}') from None
  finally:
   for worker in threads:worker.join(timeout=2)
  if errors:raise errors[0]
  if any(worker.is_alive() for worker in threads):raise Refusal('WS output channel remained open')
  raw=streams.get('out',b'')
  try:result=json.loads(raw)
  except (UnicodeDecodeError,json.JSONDecodeError):raise Refusal('WS did not return bounded JSON') from None
  if not isinstance(result,dict):raise Refusal('WS response must be an object')
  self._record('ws-'+args[0],{'arguments':list(args),'returncode':proc.returncode,'result':result,'stderr':streams.get('err',b'').decode('utf-8',errors='replace')})
  if proc.returncode:raise Refusal('WS refused operation: '+str(result.get('code','unknown')))
  return result
 def _validate(self,spec):
  if not isinstance(spec,LaunchSpec):raise Refusal('Declared launch spec required')
  for path in [spec.executable,spec.target_executable]:
   if not isinstance(path,str) or len(path)>32760 or '\x00' in path or not Path(path).is_absolute():raise Refusal('Exact absolute executable required')
  if not isinstance(spec.arguments,tuple) or len(spec.arguments)>32 or any(not isinstance(a,str) or len(a)>2048 or '\x00' in a for a in spec.arguments):raise Refusal('Bounded declared arguments required')
  if not isinstance(spec.task,str) or not 1<=len(spec.task)<=128 or not isinstance(spec.ws_session,str) or not 1<=len(spec.ws_session)<=128:raise Refusal('Root task and WS session required')
  for value,lo,hi in [(spec.width,320,2560),(spec.height,240,1440),(spec.fps,1,30),(spec.duration_minutes,1,20)]:
   if type(value) is not int or not lo<=value<=hi:raise Refusal('Capture limits refused')
 def start(self,spec:LaunchSpec,preflight_admission):
  with self._lock:
   self._validate(spec)
   if self.status!='idle':raise Refusal('Driver already used; no implicit target replacement')
   # No filesystem/Booth writes occur before explicit root preflight validation.
   admitted=self._callback(self._verify,preflight_admission,spec)
   if admitted is not True:raise Refusal('Explicit verified root preflight admission required')
   self.spec=spec;self.name='nostalgia-driver-'+uuid.uuid4().hex[:12];self.run=self._workspace/self.name;self.run.mkdir();self.status='starting'
   self._record('intent',{'booth':self.name,'launch':{'executable':spec.executable,'arguments':list(spec.arguments),'target_executable':spec.target_executable},'preflight':'accepted by trusted root callback; supplied labels not treated as authentication'})
   try:
    # A unique intent is not proof that an external launch completed.
    self._opening=True
    self.receipt=self._ws('open',self.name,'--kind','desktop','--app',spec.executable,'--task',spec.task,'--size',f'{spec.width}x{spec.height}','--fps',str(spec.fps),'--record-max-mb','16','--for',str(spec.duration_minutes),'--',*spec.arguments)
    if self.receipt.get('name')!=self.name or self.receipt.get('kind')!='desktop' or self.receipt.get('source_session')!=spec.ws_session or self.receipt.get('source_task')!=spec.task or not str(self.receipt.get('desktop_name','')).startswith('ws-booth-'):raise Refusal('Actual Booth launch receipt binding refused')
    self._opening=False;self._owned=True
    inventory=self._ws('do',self.name,'windows')
    target=self._callback(self._bind,self.receipt,inventory,spec)
    if not isinstance(target,OwnedBoothTarget) or target.desktop!=self.receipt['desktop_name'] or os.path.normcase(os.path.normpath(target.executable))!=os.path.normcase(os.path.normpath(spec.target_executable)):raise Refusal('Trusted owned-process binding refused')
    windows=inventory.get('windows')
    if not isinstance(windows,list) or not any(isinstance(w,dict) and w.get('handle')==target.hwnd and w.get('pid')==target.pid for w in windows):raise Refusal('Owned HWND/PID absent from actual Booth inventory')
    self.target=target
    diagnostics=self._runtime/('booth-driver-'+self.name+'-diagnostics.txt')
    self.controller=Controller(target,diagnostics,runtime_root=self._runtime)
    enabled=self.controller.enable()
    if not enabled['ok']:raise Refusal('Controller synthetic enable refused')
    self.status='running'
    result=self.describe();self._record('bound',result);return result
   except BaseException:
    if self._opening:
     self.status='uncertain';self._record('start-uncertain',{'booth':self.name,'status':'possible external launch effect; ownership not confirmed; root reconciliation required'})
     raise
    self.status='failed'
    try:self._stop_owned()
    except BaseException as cleanup:self._record('cleanup-failure',{'error':str(cleanup),'booth':self.name,'status':'incomplete'})
    raise
 def describe(self):
  if self.target is None:raise Refusal('No owned target bound')
  return {'status':self.status,'booth':self.name,'launch_receipt':self.receipt,'owned_target':{'pid':self.target.pid,'created_high':self.target.created_high,'created_low':self.target.created_low,'executable':self.target.executable,'hwnd':self.target.hwnd,'desktop':self.target.desktop},'owned_helpers':self.controller.owned_helper_metadata(),'capabilities':CAPABILITIES}
 def recovery(self):
  # Read-only report; intent names and receipts do not authorize a guessed close.
  with self._lock:
   return {'status':self.status,'booth':self.name,'run':str(self.run) if self.run else None,'launch_unconfirmed':self._opening,'booth_ownership_confirmed':self._owned,'launch_receipt':self.receipt,'owned_helpers':self.controller.owned_helper_metadata() if self.controller else None,'root_reconciliation_required':self._opening}
 def _running(self):
  if self.status!='running' or self.controller is None:raise Refusal('No running owned environment')
 def _identity(self):
  observed=read_owned_process_metadata(self.target.pid,self.target.executable)
  if (observed['created_high'],observed['created_low'])!=(self.target.created_high,self.target.created_low):raise Refusal('Owned process creation identity changed')
  inventory=self._ws('do',self.name,'windows')
  if inventory.get('booth')!=self.name or not any(w.get('handle')==self.target.hwnd and w.get('pid')==self.target.pid for w in inventory.get('windows',[]) if isinstance(w,dict)):raise Refusal('Owned window inventory changed')
  return inventory
 def focus(self):
  with self._lock:
   self._running();self._identity();result={'booth':self.name,'pid':self.target.pid,'hwnd':self.target.hwnd,'selection':'owned hidden target','owner_desktop_changed':False};self._record('focus-selection',result);return result
 def focus_on(self,*,pid=None,hwnd=None):
  # Optional supplied identities only verify the held target; never select another.
  with self._lock:
   self._running()
   if pid is not None and (type(pid) is not int or pid!=self.target.pid):raise Refusal('Foreign PID selection refused')
   if hwnd is not None and (type(hwnd) is not int or hwnd!=self.target.hwnd):raise Refusal('Foreign HWND selection refused')
   self._identity();result={'booth':self.name,'pid':self.target.pid,'hwnd':self.target.hwnd,'selection':'owned hidden target','owner_desktop_changed':False};self._record('focus-selection',result);return result
 def gamepad_enable(self):
  with self._lock:
   self._running();result=self.controller.gamepad_enable();self._record('gamepad-enable-write',result);return result
 def gamepad(self,connected:bool,*,buttons:int=0,left_trigger:int=0,right_trigger:int=0,left_x:int=0,left_y:int=0,right_x:int=0,right_y:int=0,lease_ms:int=100):
  with self._lock:
   self._running();result=self.controller.gamepad(connected,buttons,left_trigger,right_trigger,left_x,left_y,right_x,right_y,lease_ms);self._record('gamepad-state-write',result);return result
 def gamepad_disable(self):
  with self._lock:
   self._running();result=self.controller.gamepad_disable();self._record('gamepad-disable-write',result);return result
 def key(self,vk:int,scan:int,*,flags:int=0,lease_ms:int=100):
  with self._lock:
   self._running();result=self.controller.key(vk,scan,flags,lease_ms);self._record('key-write',result);return result
 def screenshot(self):
  with self._lock:
   self._running();self._identity();frame_dir=self.run/('frame-'+uuid.uuid4().hex);frame_dir.mkdir();path=frame_dir/'frame.png'
   capture=self._ws('shot',self.name,str(path))
   if capture.get('booth')!=self.name or capture.get('window')!=self.target.hwnd or Path(str(capture.get('path','')))!=path:raise Refusal('Captured frame window/path binding refused')
   if path.is_symlink() or not path.is_file() or path.stat().st_size>8*1024*1024:raise Refusal('Captured frame exceeds limits or is not regular')
   data=bytearray()
   with path.open('rb') as file:
    while True:
     chunk=file.read(65536)
     if not chunk:break
     if len(data)+len(chunk)>8*1024*1024:raise Refusal('Captured frame exceeds streamed limit')
     data.extend(chunk)
   self._validate_png(data)
   width,height=struct.unpack('>II',data[16:24])
   if not 1<=width<=8192 or not 1<=height<=8192 or width*height>32*1024*1024 or capture.get('size')!=[width,height]:raise Refusal('Actual capture dimensions refused')
   result={'booth':self.name,'pid':self.target.pid,'hwnd':self.target.hwnd,'path':str(path),'mime_type':'image/png','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'width':width,'height':height,'capture_receipt':capture,'quality':'actual PrintWindow pixels; rendering usability not certified'}
   self._record('frame',result);return result
 @staticmethod
 def _validate_png(data):
  if len(data)<57 or data[:8]!=b'\x89PNG\r\n\x1a\n':raise Refusal('Actual capture PNG signature/truncation invalid')
  at=8;header=False;pixels=False;end=False
  while at<len(data):
   if at+12>len(data):raise Refusal('Truncated PNG chunk')
   size=struct.unpack('>I',data[at:at+4])[0];kind=bytes(data[at+4:at+8]);limit=at+12+size
   if size>8*1024*1024 or limit>len(data):raise Refusal('PNG chunk exceeds frame')
   payload=data[at+8:at+8+size];crc=struct.unpack('>I',data[at+8+size:limit])[0]
   if zlib.crc32(kind+payload)&0xffffffff!=crc:raise Refusal('PNG chunk CRC mismatch')
   if not header:
    if kind!=b'IHDR' or size!=13:raise Refusal('PNG first chunk must be IHDR')
    header=True
   elif kind==b'IHDR':raise Refusal('Duplicate PNG header')
   if kind==b'IDAT':pixels=True
   if kind==b'IEND':
    if size or not pixels or limit!=len(data):raise Refusal('PNG end/pixel sequence invalid')
    end=True;break
   at=limit
  if not end:raise Refusal('PNG completion record missing')
 def click(self,*args,**kwargs):raise Refusal('Click is not implemented by this backend')
 def controller_axis(self,*args,**kwargs):raise Refusal('Controller axes are not implemented by this backend')
 def _stop_owned(self):
  if self._opening:raise Refusal('Unconfirmed external launch requires root reconciliation; no guessed Booth closure')
  failures=[]
  if self.controller:
   try:self.controller.close(eof=True)
   except BaseException as error:failures.append('controller: '+str(error))
  close=None
  if self._owned:
   try:
    close=self._ws('close',self.name)
    if close.get('booth')!=self.name or close.get('desktop_closed') is not True:raise Refusal('Owned Booth closure not confirmed')
    self._owned=False
   except BaseException as error:failures.append('booth: '+str(error))
  if failures:raise Refusal('Owned shutdown incomplete; '+'; '.join(failures))
  self.status='stopped';return {'status':'stopped','booth':self.name,'close_receipt':close,'owned_only':True}
 def stop(self):
  with self._lock:
   if self.status=='idle':return {'status':'idle','booth':None}
   if self.status=='stopped':return {'status':'stopped','booth':self.name,'already_stopped':True}
   result=self._stop_owned();self._record('stop',result);return result
