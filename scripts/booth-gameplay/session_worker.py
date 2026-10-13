"""Trusted-parent stdio worker. No MCP registration or public launch authority.
The parent owns audio routing/restoration, source saves, and game admission.
"""
from __future__ import annotations
import base64,importlib.util,ctypes,hashlib,json,os,queue,re,struct,subprocess,sys,threading,time,uuid
from ctypes import wintypes as w
from pathlib import Path
from dataclasses import replace
SOURCE=Path(__file__).resolve().parent
# The parent pins this source entry; -I intentionally removes ambient imports.
sys.path.insert(0,str(SOURCE))
from controller_bridge import Controller,ControllerFailure,OwnedBoothTarget,runtime_artifacts,read_owned_process_metadata,_held,_KERNEL,_Entry
from bind_owned import BindingConfig,bind,inventory,command
from booth_driver import Driver
MAX_FRAME=8*1024*1024
class WorkerError(RuntimeError):
 def __init__(self,code,message):super().__init__(message);self.code=code
def fail(code,message):raise WorkerError(code,message)
def absolute(value):
 if not isinstance(value,str) or len(value)>4096 or '\x00' in value or not Path(value).is_absolute():fail('invalid_request','Absolute local path required')
 return Path(value)
def hash_file(path,limit=2*1024*1024*1024):
 digest=hashlib.sha256();total=0
 with Path(path).open('rb') as stream:
  while block:=stream.read(65536):
   total+=len(block)
   if total>limit:fail('artifact_limit','Artifact exceeds streamed limit')
   digest.update(block)
 return digest.hexdigest()
def held_file(path):
 if Path(path).is_symlink() or not Path(path).is_file():fail('artifact_unavailable','Regular non-symlink artifact required')
 h=_KERNEL.CreateFileW(str(path),0x80000000,1,None,3,0x00200000,None)
 if h in (None,ctypes.c_void_p(-1).value):fail('artifact_unavailable','Exact regular artifact cannot be held')
 final=_KERNEL.GetFinalPathNameByHandleW;final.argtypes=[w.HANDLE,w.LPWSTR,w.DWORD,w.DWORD];final.restype=w.DWORD
 name=ctypes.create_unicode_buffer(32768)
 if not final(h,name,len(name),0) or os.path.normcase(os.path.normpath(name.value.removeprefix('\\\\?\\')))!=os.path.normcase(str(path)):
  _KERNEL.CloseHandle(h);fail('artifact_unavailable','Held artifact path differs')
 return h
def provider_command(args,config,timeout):
 # Never inherit the live parent protocol pipe into a provider CLI.
 process=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=dict(os.environ,WS_SESSION=config.ws_session))
 streams={};errors=[];workers=[]
 def consume(name,stream,limit):
  data=bytearray();exceeded=False
  while block:=stream.read(16384):
   if len(data)+len(block)>limit:exceeded=True
   elif not exceeded:data.extend(block)
  if exceeded:errors.append(name+' exceeded bound')
  streams[name]=bytes(data)
 for name,stream,limit in [('out',process.stdout,262144),('err',process.stderr,16384)]:
  worker=threading.Thread(target=consume,args=(name,stream,limit),daemon=True);worker.start();workers.append(worker)
 try:process.wait(timeout=timeout)
 except subprocess.TimeoutExpired:
  process.kill();process.wait(timeout=2);fail('provider_deadline','Owned provider command deadline expired')
 finally:
  for worker in workers:worker.join(timeout=2)
 if errors or any(worker.is_alive() for worker in workers):fail('provider_limit','Provider output exceeds bound')
 if process.returncode:fail('provider_refused','Provider refused: '+streams['err'].decode(errors='replace')[:1024]+streams['out'].decode(errors='replace')[:1024])
 return json.loads(streams['out'])

def module_status(ownership,runtime):
 """Identity-guarded read-only PE export sampling; never calls target exports."""
 h,hi,lo=_held(ownership['pid'],ownership['executable'])
 if (hi,lo)!=(ownership['created_high'],ownership['created_low']):_KERNEL.CloseHandle(h);fail('identity_changed','Owned process creation changed')
 readable=_KERNEL.OpenProcess(0x100000|0x1000|0x10,False,ownership['pid'])
 _KERNEL.CloseHandle(h);h=readable
 if not h:fail('early_status_unavailable','Read-only process data handle unavailable')
 def guard():
  probe,a,b=_held(ownership['pid'],ownership['executable'])
  try:
   if (a,b)!=(hi,lo) or _KERNEL.WaitForSingleObject(h,0)!=258:fail('identity_changed','Owned process changed during data read')
  finally:_KERNEL.CloseHandle(probe)
 rpm=_KERNEL.ReadProcessMemory;rpm.argtypes=[w.HANDLE,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_size_t)];rpm.restype=w.BOOL
 def read(address,size):
  guard();buffer=ctypes.create_string_buffer(size);count=ctypes.c_size_t()
  if not rpm(h,address,buffer,size,ctypes.byref(count)) or count.value!=size:fail('early_status_unavailable','Exact exported data cannot be read')
  return buffer.raw
 class Module(ctypes.Structure):_fields_=[('size',w.DWORD),('id',w.DWORD),('pid',w.DWORD),('gusage',w.DWORD),('usage',w.DWORD),('base',ctypes.c_void_p),('bytes',w.DWORD),('hmod',w.HMODULE),('name',w.WCHAR*256),('path',w.WCHAR*260)]
 snap=_KERNEL.CreateToolhelp32Snapshot;snap.argtypes=[w.DWORD,w.DWORD];snap.restype=w.HANDLE
 first=_KERNEL.Module32FirstW;nextm=_KERNEL.Module32NextW
 for f in (first,nextm):f.argtypes=[w.HANDLE,ctypes.POINTER(Module)];f.restype=w.BOOL
 snapshot=None
 try:
  snapshot=snap(0x18,ownership['pid'])
  if snapshot in (None,ctypes.c_void_p(-1).value):fail('early_status_unavailable','Module inventory unavailable')
  entry=Module();entry.size=ctypes.sizeof(entry);ok=first(snapshot,ctypes.byref(entry));selected=[]
  while ok:
   if entry.name.lower()=='protoinputhooks64.dll':selected.append((entry.base,entry.bytes,entry.path))
   ok=nextm(snapshot,ctypes.byref(entry))
  if len(selected)!=1:fail('early_status_unavailable','Exact hooks module absent or ambiguous')
  base,size,path=selected[0];expected=runtime/'bin/ProtoInputHooks64.dll'
  if os.path.normcase(os.path.normpath(path))!=os.path.normcase(str(expected)):fail('early_status_invalid','Loaded hooks path differs')
  with expected.open('rb') as stream:binary=stream.read(16*1024*1024+1)
  manifest=runtime_artifacts(runtime)[1]
  if len(binary)>16*1024*1024 or hashlib.sha256(binary).hexdigest()!=manifest['sha256']['bin/ProtoInputHooks64.dll']:fail('early_status_invalid','Loaded module artifact identity differs')
  def unpack(fmt,at):
   if at<0 or at+struct.calcsize(fmt)>len(binary):fail('early_status_invalid','PE field outside artifact')
   return struct.unpack_from(fmt,binary,at)
  pe=unpack('<I',0x3c)[0];machine,count=unpack('<HH',pe+4);op=pe+24;optional=unpack('<H',pe+20)[0]
  if binary[pe:pe+4]!=b'PE\0\0' or machine!=0x8664 or not 1<=count<=32 or unpack('<H',op)[0]!=0x20b or unpack('<I',op+56)[0]!=size:fail('early_status_invalid','PE image shape differs')
  remote_header=bytearray(read(base,512));image_base=op+24
  if image_base+8>512:fail('early_status_invalid','PE header bounds invalid')
  remote_header[image_base:image_base+8]=binary[image_base:image_base+8]
  if remote_header!=binary[:512]:fail('early_status_invalid','Mapped PE header differs')
  sections=[]
  for i in range(count):
   at=op+optional+40*i;vsize,virtual,rawsize,rawat=unpack('<IIII',at+8);flags=unpack('<I',at+36)[0];sections.append((virtual,vsize,rawat,rawsize,flags))
  def offset(rva,n):
   for virtual,vsize,rawat,rawsize,flags in sections:
    if virtual<=rva and rva+n<=virtual+rawsize:return rawat+rva-virtual
   fail('early_status_invalid','Export outside backed section')
  export_rva,export_size=unpack('<II',op+112);e=offset(export_rva,40);_,functions_count,names_count,functions,names,ordinals=unpack('<IIIIII',e+16)
  if functions_count>2048 or names_count>2048:fail('early_status_invalid','Export table exceeds bound')
  found=None
  for i in range(names_count):
   at=offset(unpack('<I',offset(names+4*i,4))[0],1);end=binary.find(b'\0',at,at+128)
   if end<0:fail('early_status_invalid','Export name exceeds bound')
   if binary[at:end]==b'NostalgiaEarlyXInputStatus':
    index=unpack('<H',offset(ordinals+2*i,2))[0]
    if index>=functions_count:fail('early_status_invalid','Export ordinal outside bound')
    found=unpack('<I',offset(functions+4*index,4))[0];break
  if found is None or found%8 or found+80>size or export_rva<=found<export_rva+export_size or not any(v<=found and found+80<=v+z and flags&0x80000000 and not flags&0x20000000 for v,z,a,b,flags in sections):fail('early_status_invalid','Early status data export admission failed')
  for attempt in range(16):
   before=read(base+found,80);after=read(base+found,80)
   if before==after:
    values=struct.unpack('<10q',after)
    if values[:2]!=(1,80):fail('early_status_invalid','Early status ABI differs')
    guard();return dict(zip(('version','bytes','initializer_calls','stage','result','late_calls','late_stage','bootstrap_count','dll_attach_count','ready_hook_count'),values),export_rva=found,sha256=hashlib.sha256(binary).hexdigest(),snapshot_limit='equal adjacent reads; fields independently atomic')
  fail('early_status_unavailable','Bounded stable-read attempts exhausted')
 finally:
  if snapshot not in (None,ctypes.c_void_p(-1).value):_KERNEL.CloseHandle(snapshot)
  _KERNEL.CloseHandle(h)
class Session:
 def __init__(self,cancelled):
  self.cancelled=cancelled;self.phase='new';self.runtime=None;self.home=None;self.booth=None;self.desktop=None;self.config=None;self.controller=None;self.ownership=None;self.target_handle=None;self.open_receipt=None;self.anchor=None;self.pins=[];self.deadline=None;self.sequence=0;self.launch_attempted=False;self.launch_receipt=None;self.win=None;self.capture_authority=None;self.desktop_handle=None
 def record(self,label,value):
  if not self.home:return None
  path=self.home/f'{self.sequence:04d}-{label}.json';self.sequence+=1
  with path.open('x') as f:json.dump(value,f,indent=2)
  return str(path)
 def ws(self,*args,timeout=30):
  if not self.config:fail('invalid_phase','Worker not allocated')
  result=provider_command([sys.executable,str(self.config.ws_script),'booth','--json',*args],self.config,timeout)
  self.record('ws-'+args[0],result);return result
 def allocate(self,request):
  if self.phase!='new':fail('invalid_phase','Allocation already attempted')
  self.runtime,manifest=runtime_artifacts(absolute(request['runtime_root']))
  if manifest['mode']!='early':fail('runtime_invalid','Early runtime required')
  ws=absolute(request['ws_script']);run=absolute(request['run_directory']);minutes=request['lifetime_minutes'];fps=request['capture_fps']
  if type(fps) is not int or not 1<=fps<=24:fail('invalid_request','Capture FPS must be an integer1..24')
  if type(minutes) is not int or not 1<=minutes<=60 or not ws.is_file() or not run.is_dir() or run.is_symlink():fail('invalid_request','Existing local providers and lifetime1..60 required')
  for field in ('ws_session','task'):
   if not isinstance(request[field],str) or not 1<=len(request[field])<=128:fail('invalid_request','Bounded explicit workstation authority required')
  self.home=run/'booth-worker';self.home.mkdir();self.phase='allocating';self.booth='nostalgia-worker-'+uuid.uuid4().hex[:12]
  pythonw=Path(sys.executable).with_name('pythonw.exe');anchor=SOURCE/'anchor.py'
  for path in (pythonw,anchor):self.pins.append(held_file(path))
  self.config=BindingConfig(ws,request['ws_session'],'','','',str(Path(os.environ['SystemRoot'])/'System32/conhost.exe'))
  self.task=request['task'];self.deadline=time.monotonic()+minutes*60
  capture_source=ws.parent.parent/'wskernel/booth_win32.py';self.pins.append(held_file(capture_source))
  self.capture_authority={'path':str(capture_source),'sha256':hash_file(capture_source),'method':'WS booth_win32.capture; PrintWindow(PW_RENDERFULLCONTENT) of exact owned HWND'}
  spec=importlib.util.spec_from_file_location('_nostalgia_owned_ws_capture',capture_source);module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module);self.win=module
  self.record('anchor-intent',{'booth':self.booth,'pythonw':str(pythonw),'pythonw_sha256':hash_file(pythonw),'anchor_sha256':hash_file(anchor)})
  try:
   self.open_receipt=self.ws('open',self.booth,'--kind','desktop','--app',str(pythonw),'--task',self.task,'--size','1280x720','--fps',str(fps),'--record-max-mb','16','--for',str(minutes),'--','-I',str(anchor),'--receipt',str(self.home/'anchor.json'),'--minutes',str(minutes),timeout=35)
   r=self.open_receipt
   if r.get('name')!=self.booth or r.get('desktop_name')!='ws-booth-'+self.booth or r.get('source_session')!=self.config.ws_session or r.get('source_task')!=self.task or len(r.get('started_pids',[]))!=1:fail('anchor_invalid','Actual owned anchor receipt differs')
   self.desktop=r['desktop_name'];pid=r['started_pids'][0];self.anchor=read_owned_process_metadata(pid,str(pythonw))
   actual=((self.anchor['created_high']<<32)|self.anchor['created_low'])/10000000-11644473600
   if abs(actual-r['pid_created'][str(pid)])>.01:fail('anchor_invalid','Actual anchor creation differs')
   self.desktop_handle=self.win.open_desktop(self.desktop)
   if not self.desktop_handle:fail('desktop_unavailable','Owned inactive desktop read/capture context unavailable')
   self.phase='await_parent_audio'
   return {'phase':self.phase,'booth':self.booth,'desktop':self.desktop,'open_receipt':r,'anchor':self.anchor,'appdata':os.environ.get('APPDATA'),'audio_authority':'trusted parent must prepare and verify isolation before launch'}
  except BaseException:
   self.phase='uncertain';self.record('uncertain',{'operation':'allocate','booth':self.booth});raise
 def launch(self,request):
  self.lifetime()
  if self.phase!='await_parent_audio' or self.launch_attempted:fail('invalid_phase','One post-audio parent launch is permitted')
  me3=absolute(request['me3_executable']);game=absolute(request['game_executable']);profile=absolute(request['profile']);launcher=me3.with_name('me3-launcher.exe')
  if me3.name.lower()!='me3.exe' or game.name.lower()!='eldenring.exe' or not profile.is_file() or profile.is_symlink():fail('invalid_request','Pinned ME3/Elden Ring route and regular profile required')
  save=request['savefile']
  if not isinstance(save,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}\.sl2',save) or save.lower()=='er0000.sl2':fail('invalid_request','Explicit alternate save filename required')
  for path,key in ((game,'game_sha256'),(me3,'me3_sha256')):
   expected=request[key]
   if not isinstance(expected,str) or not re.fullmatch('[0-9a-f]{64}',expected):fail('invalid_request','Parent artifact SHA256 required')
   pin=held_file(path);self.pins.append(pin)
   if hash_file(path)!=expected:fail('artifact_changed','Parent game/ME3 identity differs')
  for path in (launcher,profile,self.runtime/'bin/ProtoInputHooks64.dll',self.runtime/'bin/ProtoInputLoader64.dll'):self.pins.append(held_file(path))
  self.config=BindingConfig(self.config.ws_script,self.config.ws_session,str(game),str(me3),str(launcher),self.config.conhost_executable)
  self.config.validate()
  snapshot=_KERNEL.CreateToolhelp32Snapshot(2,0)
  if snapshot in (None,ctypes.c_void_p(-1).value):fail('process_inventory_unavailable','Initial process inventory unavailable')
  try:
   entry=_Entry();entry.dwSize=ctypes.sizeof(entry);more=_KERNEL.Process32FirstW(snapshot,ctypes.byref(entry))
   while more:
    if entry.szExeFile.lower()==game.name.lower():
     try:current=read_owned_process_metadata(entry.th32ProcessID,str(game))
     except OSError:fail('process_inventory_unavailable','Possible existing target identity inaccessible')
     except RuntimeError:current=None
     if current:fail('game_already_running','Exact target game already running; no duplicate launch permitted')
    more=_KERNEL.Process32NextW(snapshot,ctypes.byref(entry))
  finally:_KERNEL.CloseHandle(snapshot)
  self.launch_attempted=True;self.phase='launching'
  arguments=['launch','--game','eldenring','--exe',str(game),'--profile',str(profile),'--savefile',save,'--online=false','--no-mem-patch=true','--show-logos=true','--no-boot-boost=true','--disable-arxan=false','--skip-steam-init=false']
  self.record('launch-intent',{'command':[str(me3),*arguments],'phase':'trusted parent post-audio admission','launcher_sha256':hash_file(launcher),'profile_sha256':hash_file(profile)})
  try:
   before=time.time_ns()
   self.launch_receipt=self.ws('do',self.booth,'run','--',str(me3),*arguments,timeout=20)
   after=time.time_ns();self.config=replace(self.config,launch_window_ns=(before,after));self.config.validate();self.record('launch-clock-interval',{'before_ns':before,'after_ns':after,'authority':'worker-owned clock around actual WS call'})
   launch_path=self.home/'launch.json'
   with launch_path.open('x') as f:json.dump(self.launch_receipt,f)
   until=time.monotonic()+60;last=None
   while time.monotonic()<until:
    output=self.home/'binding'
    if not output.exists():output.mkdir()
    try:bound=bind(str(launch_path),self.booth,str(output),self.config);break
    except RuntimeError as error:
     if last is None:self.record('first-binding-gap',{'message':str(error)})
     last=error;time.sleep(.2)
   else:fail('binding_failed',str(last or 'Owned target did not appear'))
   self.ownership=bound['owned'];self.target_handle,a,b=_held(self.ownership['pid'],self.ownership['executable'])
   if (a,b)!=(self.ownership['created_high'],self.ownership['created_low']):fail('identity_changed','Bound game creation differs')
   self.phase='bound';early=module_status(self.ownership,self.runtime);self.record('early-status',early)
   if not (early['stage']==2 and early['result']==1 and early['late_calls']==0 and early['late_stage']==0 and early['bootstrap_count']==0 and early['dll_attach_count']==1 and early['ready_hook_count']>=3):fail('early_not_ready','Early-only startup admission refused')
   if self.cancelled.is_set():fail('parent_disconnected','Parent disconnected before late attachment')
   self.phase='attaching'
   self.controller=Controller(OwnedBoothTarget(**self.ownership),self.runtime/('worker-'+uuid.uuid4().hex+'-diagnostics.txt'),runtime_root=self.runtime)
   result=self.controller.gamepad_enable()
   if not result['ok']:fail('control_not_ready','Gamepad enable was not written')
   if self.cancelled.is_set():fail('parent_disconnected','Parent disconnected during late attachment')
   self.phase='ready';return {'phase':self.phase,'booth':self.booth,'ownership':self.ownership,'launch_receipt':self.launch_receipt,'binding_receipt':bound,'early_status':early,'controller_receipt':result,'viewer_url':self.open_receipt.get('stream_view'),'start_ticks_utc':str(((self.ownership['created_high']<<32)|self.ownership['created_low'])+504911232000000000)}
  except BaseException as error:
   self.phase='uncertain';self.record('uncertain',{'operation':'launch','message':str(error),'ownership':self.ownership,'launch_receipt':self.launch_receipt});raise
 def identity(self):
  if not self.ownership or not self.target_handle or _KERNEL.WaitForSingleObject(self.target_handle,0)!=258:fail('target_exited','Exact owned game is no longer running')
  current=read_owned_process_metadata(self.ownership['pid'],self.ownership['executable'])
  if any(current[k]!=self.ownership[k] for k in ('pid','created_high','created_low','executable')):fail('identity_changed','Owned target changed')
  if self.win.input_desktop_name() in (None,self.desktop):fail('desktop_changed','Owned target must remain on an inactive desktop')
  windows=self.win.desktop_windows(self.desktop,visible_only=False)
  if not any(r.pid==self.ownership['pid'] and r.handle==self.ownership['hwnd'] for r in windows):fail('window_changed','Owned target window changed')
 def ready(self):
  self.lifetime()
  if self.phase!='ready':fail('invalid_phase','Worker is not ready for gameplay')
  self.identity()
 def lifetime(self):
  if self.deadline and time.monotonic()>=self.deadline:fail('session_expired','Owned session lifetime expired; only cleanup is permitted')
 def inspect(self):
  self.ready();folder=self.home/('frame-'+uuid.uuid4().hex);folder.mkdir();path=folder/'frame.png'
  actual_input=self.win.input_desktop_name();members=self.win.desktop_windows(self.desktop,visible_only=False);root_window=self.ownership['hwnd']
  self.record('capture-admission',{'input_desktop':actual_input,'expected_desktop':self.desktop,'held_hwnd':self.ownership['hwnd'],'root_window':root_window,'members':[{'handle':item.handle,'pid':item.pid} for item in members]})
  if actual_input is None or actual_input==self.desktop or not any(item.handle==root_window and item.pid==self.ownership['pid'] for item in members):fail('frame_invalid','Owned window is not on admitted inactive desktop')
  selected=self.win.describe(self.ownership['hwnd'])
  if selected.pid!=self.ownership['pid'] or not 1<=selected.width<=8192 or not 1<=selected.height<=8192 or selected.width*selected.height>32*1024*1024:fail('frame_invalid','Capture target identity or allocation bounds differ')
  image=self.win.capture(self.ownership['hwnd'])
  if image is None:fail('frame_invalid','Actual exact-window capture failed')
  with path.open('xb') as stream:image.save(stream,format='PNG')
  receipt={'booth':self.booth,'window':self.ownership['hwnd'],'pid':self.ownership['pid'],'desktop':self.desktop,'path':str(path),'size':list(image.size),'authority':self.capture_authority}
  self.record('capture',receipt)
  with path.open('rb') as f:data=f.read(MAX_FRAME+1)
  if len(data)>MAX_FRAME:fail('frame_limit','Actual capture exceeds8MiB')
  Driver._validate_png(data);width,height=struct.unpack('>II',data[16:24])
  if not 1<=width<=8192 or not 1<=height<=8192 or width*height>32*1024*1024 or receipt.get('size')!=[width,height]:fail('frame_invalid','Actual capture dimensions differ')
  self.identity()
  if self.win.input_desktop_name() in (None,self.desktop) or not any(item.handle==self.ownership['hwnd'] and item.pid==self.ownership['pid'] for item in self.win.desktop_windows(self.desktop,visible_only=False)):fail('frame_invalid','Capture desktop identity changed')
  return {'ownership':self.ownership,'frame':{'data_url':'data:image/png;base64,'+base64.b64encode(data).decode(),'width':width,'height':height,'sha256':hashlib.sha256(data).hexdigest(),'path':str(path)},'capture_receipt':receipt}
 def focus(self):self.ready();return {'ownership':self.ownership,'selection':'owned hidden target','owner_desktop_changed':False}
 def gamepad(self,request):
  self.ready();state=request['state'];allowed={'connected','buttons','left_trigger','right_trigger','left_x','left_y','right_x','right_y','lease_ms'}
  if not isinstance(state,dict) or set(state)!=allowed:fail('invalid_request','Complete declared gamepad state required')
  result=self.controller.gamepad(**state);self.record('gamepad',result);return result
 def stop(self):
  if self.phase=='new':return {'game_exited':True,'controller_closed':True,'booth_closed':True,'status':'new'}
  if self.phase=='stopped':return {'game_exited':True,'controller_closed':True,'booth_closed':True,'status':'stopped'}
  if self.phase=='quiescent':return {'game_exited':True,'controller_closed':True,'booth_closed':False,'status':'quiescent','booth':self.booth,'desktop':self.desktop}
  if self.phase=='uncertain' and self.launch_attempted and not self.ownership:fail('shutdown_uncertain','Launch ownership remains unconfirmed; no guessed closure')
  controller_closed=self.controller is None;errors=[]
  if self.controller:
   try:self.controller.close(eof=True);controller_closed=True
   except BaseException as error:
    controller_closed=not self.controller.owned_helper_metadata()['launcher_running'];errors.append(str(error))
  game_exited=self.target_handle is None or _KERNEL.WaitForSingleObject(self.target_handle,0)==0
  if self.target_handle and not game_exited:
   self.identity();post=ctypes.WinDLL('user32',use_last_error=True).PostMessageW;post.argtypes=[w.HWND,w.UINT,w.WPARAM,w.LPARAM];post.restype=w.BOOL
   if not post(self.ownership['hwnd'],0x10,0,0):errors.append('Owned WM_CLOSE refused')
   game_exited=_KERNEL.WaitForSingleObject(self.target_handle,10000)==0
  if not game_exited or not controller_closed:
   self.phase='shutdown_incomplete';result={'game_exited':game_exited,'controller_closed':controller_closed,'booth_closed':False,'status':self.phase,'errors':errors};self.record('stop-incomplete',result);return result
  self.phase='quiescent'
  if self.target_handle:_KERNEL.CloseHandle(self.target_handle);self.target_handle=None
  result={'game_exited':True,'controller_closed':True,'booth_closed':False,'status':'quiescent','booth':self.booth,'desktop':self.desktop,'cleanup_notes':errors};self.record('quiescent',result);return result
 def close(self):
  if self.phase in ('new','stopped'):return self.stop()
  if self.phase!='quiescent':fail('invalid_phase','Quiesce, restore audio on parent, then close')
  if not self.open_receipt:fail('shutdown_uncertain','Anchor allocation outcome unconfirmed')
  if self.desktop_handle:self.win.close_desktop(self.desktop_handle);self.desktop_handle=None
  closed=self.ws('close',self.booth,timeout=20)
  if closed.get('booth')!=self.booth or closed.get('desktop_closed') is not True:fail('shutdown_incomplete','Actual owned Booth closure not confirmed')
  self.phase='stopped'
  for h in self.pins:_KERNEL.CloseHandle(h)
  self.pins=[];result={'game_exited':True,'controller_closed':True,'booth_closed':True,'status':'stopped','close_receipt':closed};self.record('stop',result);return result
def serve():
 cancelled=threading.Event();requests=queue.Queue(maxsize=32);session=Session(cancelled)
 def receive():
  try:
   pending=bytearray()
   while True:
    block=os.read(sys.stdin.fileno(),4096)
    if not block:break
    pending.extend(block)
    while b'\n' in pending:
     line,_,rest=pending.partition(b'\n');pending=bytearray(rest)
     if len(line)+1>4096:requests.put(('invalid',None));return
     requests.put(('request',json.loads(line)))
    if len(pending)>=4096:requests.put(('invalid',None));return
   if pending:requests.put(('invalid',None))
  except BaseException:requests.put(('invalid',None))
  finally:cancelled.set();requests.put(('eof',None))
 threading.Thread(target=receive,daemon=True).start();expected=1
 schemas={'allocate':{'runtime_root','ws_script','ws_session','task','run_directory','lifetime_minutes','capture_fps'},'launch':{'me3_executable','game_executable','profile','savefile','game_sha256','me3_sha256'},'inspect':set(),'focus':set(),'gamepad':{'state'},'stop':set(),'close':set()}
 try:
  while True:
   try:kind,request=requests.get(timeout=.25)
   except queue.Empty:
    if session.deadline and time.monotonic()>=session.deadline and session.phase not in ('new','stopped'):session.stop()
    continue
   if kind=='eof':break
   seq=request.get('seq') if isinstance(request,dict) else None
   try:
    if kind!='request' or not isinstance(request,dict) or type(seq) is not int or seq!=expected:fail('invalid_request','Strict sequential request required')
    expected+=1;op=request.get('op')
    if op not in schemas or set(request)!={'seq','op',*schemas[op]}:fail('invalid_request','Strict operation fields required')
    if op in ('allocate','launch','gamepad'):result=getattr(session,op)(request)
    elif op in ('stop','close'):result=getattr(session,op)()
    else:result=getattr(session,op)()
    response={'seq':seq,'ok':True,'result':result}
   except BaseException as error:response={'seq':seq,'ok':False,'error':{'code':getattr(error,'code','operation_failed'),'message':str(error)[:2048]}}
   encoded=json.dumps(response,separators=(',',':')).encode();limit=12*1024*1024 if isinstance(request,dict) and request.get('op')=='inspect' else 65536
   if len(encoded)>limit:encoded=json.dumps({'seq':seq,'ok':False,'error':{'code':'response_limit','message':'Operation response exceeds bound'}}).encode()
   sys.stdout.buffer.write(encoded+b'\n');sys.stdout.buffer.flush()
   if isinstance(request,dict) and request.get('op')=='close' and response.get('ok') and response.get('result',{}).get('status')=='stopped':break
 finally:
  try:
   result=session.stop()
   if not result.get('booth_closed'):session.record('parent-eof-desktop-retained',{'quiescence':result,'parent_action':'restore audio, then close actual owned Booth','open_receipt':session.open_receipt})
  except BaseException as error:session.record('parent-eof-cleanup-failed',{'code':getattr(error,'code','shutdown_incomplete'),'message':str(error)[:2048],'phase':session.phase,'ownership':session.ownership,'booth':session.booth})
if __name__=='__main__':serve()
