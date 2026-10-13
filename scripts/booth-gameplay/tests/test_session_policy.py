import sys,threading,ctypes,hashlib,io,json,struct,subprocess,time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import session_worker as worker

def make_session(monkeypatch):
 s=worker.Session(threading.Event());s.ownership={'pid':41,'created_high':1,'created_low':2,'executable':'owned.exe','hwnd':73};s.target_handle=99;s.desktop='owned-hidden'
 monkeypatch.setattr(worker._KERNEL,'WaitForSingleObject',lambda *args:258)
 monkeypatch.setattr(worker,'read_owned_process_metadata',lambda *args:dict(s.ownership))
 class Window: handle=73;pid=41
 class Win:
  def desktop_windows(self,*args,**kwargs):return [Window()]
  def input_desktop_name(self):return 'Default'
 s.win=Win()
 s.ws=lambda *args,**kwargs:pytest.fail('Identity must not spawn a nested CLI with its own30sec deadline')
 return s

def test_identity_does_not_traverse_cli(monkeypatch):
 make_session(monkeypatch).identity()

@pytest.mark.parametrize('change',['process','window','active'])
def test_identity_refuses_changed_owner(monkeypatch,change):
 s=make_session(monkeypatch)
 if change=='process':monkeypatch.setattr(worker,'read_owned_process_metadata',lambda *args:{**s.ownership,'created_low':3})
 if change=='window':s.win.desktop_windows=lambda *args,**kwargs:[]
 if change=='active':s.win.input_desktop_name=lambda:s.desktop
 with pytest.raises(worker.WorkerError):s.identity()

class Function:
 def __init__(self,call):self.call=call
 def __call__(self,*args):return self.call(*args)

def stub_kernel(monkeypatch,**functions):
 for name,call in functions.items():monkeypatch.setattr(worker._KERNEL,name,Function(call))

@pytest.mark.parametrize('value',[None,'relative','x\x00y',3])
def test_absolute_refuses_ambient_paths(value):
 with pytest.raises(worker.WorkerError,match='Absolute'):worker.absolute(value)

def test_stream_hash_and_artifact_limit(tmp_path):
 p=tmp_path/'bytes';p.write_bytes(b'abc'*30000)
 assert worker.hash_file(p)==hashlib.sha256(p.read_bytes()).hexdigest()
 with pytest.raises(worker.WorkerError,match='limit'):worker.hash_file(p,2)

@pytest.mark.parametrize('mode',['success','error','overflow','timeout'])
def test_provider_protocol_is_bounded_and_never_inherits_stdin(monkeypatch,mode):
 process=SimpleNamespace(stdout=io.BytesIO(b'{"owned":true}' if mode!='overflow' else b'x'*262145),stderr=io.BytesIO(b'diagnostic'),returncode=1 if mode=='error' else 0)
 def wait(timeout):
  if mode=='timeout' and timeout!=2:raise subprocess.TimeoutExpired('fixture',timeout)
 process.wait=wait;process.kill=Mock()
 launch=Mock(return_value=process);monkeypatch.setattr(worker.subprocess,'Popen',launch)
 if mode=='success':assert worker.provider_command(['authored'],SimpleNamespace(ws_session='fixture'),1)=={'owned':True}
 else:
  with pytest.raises(worker.WorkerError):worker.provider_command(['authored'],SimpleNamespace(ws_session='fixture'),1)
 assert launch.call_args.kwargs['stdin']==subprocess.DEVNULL
 assert launch.call_args.kwargs['env']['WS_SESSION']=='fixture'
 assert process.kill.call_count==(mode=='timeout')

@pytest.fixture
def session_fixture(monkeypatch,tmp_path):
 s=make_session(monkeypatch);s.ownership['desktop']=s.desktop;s.phase='ready';s.home=tmp_path;s.runtime=tmp_path/'runtime';s.runtime.mkdir();s.booth='fixture';s.open_receipt={'stream_view':'authored'};s.desktop_handle=55;s.capture_authority={'method':'authored'}
 closed=[];stub_kernel(monkeypatch,CloseHandle=lambda h:closed.append(h))
 class Controller:
  def gamepad(self,**state):return {'ok':True,'state':state}
  def close(self,**kwargs):pass
  def owned_helper_metadata(self):return {'launcher_running':False}
 s.controller=Controller()
 window=SimpleNamespace(handle=73,pid=41,width=2,height=2)
 class Image:
  size=(2,2)
  def save(self,stream,**kwargs):stream.write(b'\x89PNG\r\n\x1a\n'+b'\0'*8+struct.pack('>II',2,2))
 s.win.describe=lambda h:window;s.win.capture=lambda h:Image();s.win.close_desktop=lambda h:closed.append(h)
 monkeypatch.setattr(worker.Driver,'_validate_png',lambda data:None)
 return s,window,closed

def test_inspect_focus_and_gamepad_preserve_exact_owned_identity(session_fixture):
 s,window,_=session_fixture
 result=s.inspect();assert result['frame']['width']==2;assert result['ownership']==s.ownership
 assert result['frame']['sha256']==hashlib.sha256(Path(result['frame']['path']).read_bytes()).hexdigest()
 assert s.focus()['owner_desktop_changed'] is False
 state=dict(connected=False,buttons=0,left_trigger=0,right_trigger=0,left_x=0,left_y=0,right_x=0,right_y=0,lease_ms=0)
 assert s.gamepad({'state':state})['state']==state
 with pytest.raises(worker.WorkerError):s.gamepad({'state':{}})
 s.deadline=time.monotonic()-1
 with pytest.raises(worker.WorkerError,match='lifetime'):s.focus()
 s.deadline=None;s.phase='bound'
 with pytest.raises(worker.WorkerError,match='ready'):s.focus()

@pytest.mark.parametrize('change',['unknown','pid','width','missing','huge','dimensions','postowner'])
def test_capture_refusals(session_fixture,monkeypatch,change):
 s,window,_=session_fixture
 if change=='unknown':s.win.input_desktop_name=lambda:None
 if change=='pid':window.pid=7
 if change=='width':window.width=8193
 if change=='missing':s.win.capture=lambda h:None
 if change=='huge':monkeypatch.setattr(worker,'MAX_FRAME',4)
 if change=='dimensions':s.win.capture=lambda h:SimpleNamespace(size=(3,2),save=lambda stream,**kwargs:stream.write(b'\x89PNG\r\n\x1a\n'+b'\0'*8+struct.pack('>II',2,2)))
 if change=='postowner':
  calls=[0]
  def metadata(*args):
   calls[0]+=1;return {**s.ownership,'created_low':3 if calls[0]>1 else 2}
  monkeypatch.setattr(worker,'read_owned_process_metadata',metadata)
 with pytest.raises(worker.WorkerError):s.inspect()

def test_identity_unknown_desktop_and_exited_handle(monkeypatch):
 s=make_session(monkeypatch);s.win.input_desktop_name=lambda:None
 with pytest.raises(worker.WorkerError,match='inactive'):s.identity()
 stub_kernel(monkeypatch,WaitForSingleObject=lambda *a:0)
 with pytest.raises(worker.WorkerError,match='running'):s.identity()

@pytest.mark.parametrize('mode',['success','post_refused','controller_failure','alive'])
def test_stop_quiescence_never_closes_booth_before_audio_restore(session_fixture,monkeypatch,mode):
 s,_,closed=session_fixture;posted=[]
 post=Function(lambda *a:posted.append(a) or mode!='post_refused')
 monkeypatch.setattr(worker.ctypes,'WinDLL',lambda *a,**k:SimpleNamespace(PostMessageW=post))
 stub_kernel(monkeypatch,WaitForSingleObject=lambda h,ms:258 if ms==0 or mode=='alive' else 0)
 if mode=='controller_failure':s.controller.close=lambda **kwargs:(_ for _ in ()).throw(RuntimeError('authored close failure'))
 result=s.stop();assert posted[0]==(73,0x10,0,0);assert result['booth_closed'] is False
 if mode=='alive':assert result['status']=='shutdown_incomplete';return
 assert result['status']=='quiescent';assert s.stop()['status']=='quiescent'
 s.pins=[12,13];s.ws=lambda *a,**k:{'booth':s.booth,'desktop_closed':True}
 assert s.close()['status']=='stopped';assert 55 in closed and 12 in closed and 13 in closed
 assert s.close()['status']=='stopped'

def test_cleanup_refuses_unknown_launch_or_missing_confirmation(session_fixture):
 s,_,_=session_fixture;s.phase='uncertain';s.launch_attempted=True;s.ownership=None
 with pytest.raises(worker.WorkerError,match='unconfirmed'):s.stop()
 s.phase='quiescent';s.open_receipt=None
 with pytest.raises(worker.WorkerError):s.close()
 s.open_receipt={};s.phase='ready'
 with pytest.raises(worker.WorkerError):s.close()
 fresh=worker.Session(threading.Event());assert fresh.close()['status']=='new'

@pytest.fixture
def allocation_fixture(monkeypatch,tmp_path):
 runtime=tmp_path/'runtime';runtime.mkdir();ws=tmp_path/'scripts/ws.py';ws.parent.mkdir();ws.write_text('authored')
 (tmp_path/'wskernel').mkdir();(tmp_path/'wskernel/booth_win32.py').write_text('authored')
 s=worker.Session(threading.Event());calls=[]
 monkeypatch.setattr(worker,'runtime_artifacts',lambda p:(runtime,{'mode':'early'}));monkeypatch.setattr(worker,'held_file',lambda p:1);monkeypatch.setattr(worker,'hash_file',lambda p:'a'*64)
 win=SimpleNamespace(open_desktop=lambda d:77)
 monkeypatch.setattr(worker.importlib.util,'spec_from_file_location',lambda *a:SimpleNamespace(name='authored_capture',loader=SimpleNamespace(exec_module=lambda m:None)))
 monkeypatch.setattr(worker.importlib.util,'module_from_spec',lambda spec:win)
 created=int((time.time()+11644473600)*10000000)
 monkeypatch.setattr(worker,'read_owned_process_metadata',lambda *a:dict(pid=5,created_high=created>>32,created_low=created&0xffffffff,executable=a[1]))
 def provider(*args,**kwargs):
  calls.append((args,kwargs));return {'name':s.booth,'desktop_name':'ws-booth-'+s.booth,'source_session':'fixture-session','source_task':'fixture-task','started_pids':[5],'pid_created':{'5':created/10000000-11644473600}}
 s.ws=provider
 request=dict(runtime_root=str(runtime),ws_script=str(ws),ws_session='fixture-session',task='fixture-task',run_directory=str(tmp_path),lifetime_minutes=1,capture_fps=12)
 return s,request,calls,win

def test_allocate_forwards_12fps_and_pins_owned_capture(allocation_fixture):
 s,request,calls,_=allocation_fixture;result=s.allocate(request)
 args=calls[0][0];assert args[args.index('--fps')+1]=='12';assert result['phase']=='await_parent_audio';assert s.desktop_handle==77
 with pytest.raises(worker.WorkerError):s.allocate(request)

@pytest.mark.parametrize('field,value',[('capture_fps',0),('capture_fps',25),('capture_fps',True),('lifetime_minutes',0),('task',''),('ws_session',None)])
def test_allocate_invalid_admission_has_no_provider_effect(allocation_fixture,field,value):
 s,request,calls,_=allocation_fixture;request[field]=value
 with pytest.raises(worker.WorkerError):s.allocate(request)
 assert not calls

def test_allocate_unconfirmed_desktop_is_uncertain(allocation_fixture):
 s,request,_,win=allocation_fixture;win.open_desktop=lambda d:None
 with pytest.raises(worker.WorkerError,match='desktop'):s.allocate(request)
 assert s.phase=='uncertain'

@pytest.fixture
def launch_fixture(monkeypatch,tmp_path):
 s=worker.Session(threading.Event());s.phase='await_parent_audio';s.home=tmp_path;s.runtime=tmp_path/'runtime';s.runtime.mkdir();s.booth='fixture';s.open_receipt={'stream_view':'authored'}
 s.config=SimpleNamespace(ws_script=tmp_path/'ws.py',ws_session='session',conhost_executable='conhost.exe')
 for name in ['me3.exe','eldenring.exe','profile.me3','me3-launcher.exe']:(tmp_path/name).write_bytes(b'authored')
 request=dict(me3_executable=str(tmp_path/'me3.exe'),game_executable=str(tmp_path/'eldenring.exe'),profile=str(tmp_path/'profile.me3'),savefile='alternate.sl2',game_sha256='a'*64,me3_sha256='a'*64)
 monkeypatch.setattr(worker,'held_file',lambda p:1);monkeypatch.setattr(worker,'hash_file',lambda p:'a'*64)
 # Binding admission is tested separately; this fixture exercises worker ownership transitions.
 from dataclasses import make_dataclass
 Config=make_dataclass('AuthoredConfig',[('ws_script',object),('ws_session',object),('game_executable',object),('me3_executable',object),('launcher_executable',object),('conhost_executable',object),('launch_window_ns',object,None)],namespace={'validate':lambda self:None})
 monkeypatch.setattr(worker,'BindingConfig',Config)
 stub_kernel(monkeypatch,CreateToolhelp32Snapshot=lambda *a:11,Process32FirstW=lambda *a:False,Process32NextW=lambda *a:False,CloseHandle=lambda *a:None)
 owned=dict(pid=41,created_high=1,created_low=2,executable=request['game_executable'],hwnd=73,desktop='hidden')
 monkeypatch.setattr(worker,'bind',lambda *a:{'owned':owned});monkeypatch.setattr(worker,'_held',lambda *a:(99,1,2))
 early=dict(stage=2,result=1,late_calls=0,late_stage=0,bootstrap_count=0,dll_attach_count=1,ready_hook_count=3)
 monkeypatch.setattr(worker,'module_status',lambda *a:dict(early))
 monkeypatch.setattr(worker,'Controller',lambda *a,**k:SimpleNamespace(gamepad_enable=lambda:{'ok':True}))
 s.ws=lambda *a,**k:{'authored':True}
 return s,request,early

def test_launch_binds_one_owned_process_and_early_status_before_control(launch_fixture):
 s,request,_=launch_fixture;r=s.launch(request);assert r['phase']=='ready';assert s.launch_attempted;assert r['ownership']==s.ownership
 assert int(r['start_ticks_utc'])==((1<<32)|2)+504911232000000000
 with pytest.raises(worker.WorkerError):s.launch(request)

@pytest.mark.parametrize('change',['save','hash','artifact','early','cancel','creation','existing','inventory'])
def test_launch_refusals(launch_fixture,monkeypatch,change):
 s,request,early=launch_fixture
 if change=='save':request['savefile']='ER0000.sl2'
 if change=='hash':request['game_sha256']='bad'
 if change=='artifact':monkeypatch.setattr(worker,'hash_file',lambda p:'b'*64)
 if change=='early':early['result']=0
 if change=='cancel':s.cancelled.set()
 if change=='creation':monkeypatch.setattr(worker,'_held',lambda *a:(99,1,3))
 if change=='inventory':stub_kernel(monkeypatch,CreateToolhelp32Snapshot=lambda *a:None)
 if change=='existing':
  def first(h,p):p._obj.szExeFile='eldenring.exe';p._obj.th32ProcessID=9;return True
  stub_kernel(monkeypatch,Process32FirstW=first);monkeypatch.setattr(worker,'read_owned_process_metadata',lambda *a:{'pid':9})
 with pytest.raises(worker.WorkerError):s.launch(request)
 if change in ['early','cancel','creation']:assert s.phase=='uncertain'

def pe_fixture():
 data=bytearray(4096);pe=128;op=152;data[pe:pe+4]=b'PE\0\0';struct.pack_into('<I',data,60,pe);struct.pack_into('<HH',data,pe+4,0x8664,1);struct.pack_into('<H',data,pe+20,240);struct.pack_into('<H',data,op,0x20b);struct.pack_into('<I',data,op+56,8192);struct.pack_into('<II',data,op+112,4096,128)
 section=op+240;struct.pack_into('<IIII',data,section+8,2048,4096,2048,512);struct.pack_into('<I',data,section+36,0x80000000)
 struct.pack_into('<IIIIII',data,512+16,0,1,1,4160,4176,4192);struct.pack_into('<I',data,576,4608);struct.pack_into('<I',data,592,4200);struct.pack_into('<H',data,608,0);data[616:616+len(b'NostalgiaEarlyXInputStatus\0')]=b'NostalgiaEarlyXInputStatus\0'
 return data

@pytest.mark.parametrize('change',['valid','machine','path','header','ordinal','abi','unstable','snapshot','missing','creation'])
def test_module_status_exact_read_only_pe_admission(monkeypatch,tmp_path,change):
 runtime=tmp_path;(runtime/'bin').mkdir();binary=pe_fixture()
 if change=='machine':struct.pack_into('<H',binary,132,0)
 if change=='ordinal':struct.pack_into('<H',binary,608,2)
 dll=runtime/'bin/ProtoInputHooks64.dll';dll.write_bytes(binary)
 ownership=dict(pid=41,created_high=1,created_low=2,executable='authored.exe')
 monkeypatch.setattr(worker,'_held',lambda *a:(99,1,3 if change=='creation' else 2))
 monkeypatch.setattr(worker,'runtime_artifacts',lambda p:(p,{'sha256':{'bin/ProtoInputHooks64.dll':hashlib.sha256(binary).hexdigest()}}))
 def first(h,p):
  p._obj.name='other.dll' if change=='missing' else 'ProtoInputHooks64.dll';p._obj.base=0x100000;p._obj.bytes=8192;p._obj.path=str(tmp_path/'wrong.dll' if change=='path' else dll);return True
 calls=[0]
 def rpm(h,address,buffer,size,count):
  a=address.value if hasattr(address,'value') else address
  if size==512:data=bytes(binary[:512]) if change!='header' else b'x'*512
  else:
   calls[0]+=1;values=[1,80,1,2,1,0,0,0,1,3]
   if change=='abi':values[0]=2
   if change=='unstable':values[2]=calls[0]
   data=struct.pack('<10q',*values)
  ctypes.memmove(buffer,data,len(data));count._obj.value=len(data);return True
 stub_kernel(monkeypatch,OpenProcess=lambda *a:98,CloseHandle=lambda *a:None,WaitForSingleObject=lambda *a:258,CreateToolhelp32Snapshot=lambda *a:None if change=='snapshot' else 97,Module32FirstW=first,Module32NextW=lambda *a:False,ReadProcessMemory=rpm)
 if change=='valid':
  r=worker.module_status(ownership,runtime);assert r['stage']==2;assert r['export_rva']==4608;assert r['sha256']==hashlib.sha256(binary).hexdigest()
 else:
  with pytest.raises(worker.WorkerError):worker.module_status(ownership,runtime)

@pytest.mark.parametrize('mode',['success','badhandle','wrongpath'])
def test_held_artifact_exact_path(monkeypatch,tmp_path,mode):
 p=tmp_path/'owned';p.write_bytes(b'authored');closed=[]
 def final(h,buffer,n,flags):buffer.value=str(p if mode!='wrongpath' else tmp_path/'other');return len(buffer.value)
 stub_kernel(monkeypatch,CreateFileW=lambda *a:None if mode=='badhandle' else 12,GetFinalPathNameByHandleW=final,CloseHandle=lambda h:closed.append(h))
 if mode=='success':assert worker.held_file(p)==12
 else:
  with pytest.raises(worker.WorkerError):worker.held_file(p)
 with pytest.raises(worker.WorkerError):worker.held_file(tmp_path/'absent')

def test_ws_records_bounded_provider_response(monkeypatch,tmp_path):
 s=worker.Session(threading.Event())
 with pytest.raises(worker.WorkerError):s.ws('open')
 s.home=tmp_path;s.config=SimpleNamespace(ws_script=tmp_path/'ws.py')
 monkeypatch.setattr(worker,'provider_command',lambda args,config,timeout:{'timeout':timeout})
 assert s.ws('close',timeout=2)=={'timeout':2};assert list(tmp_path.glob('*ws-close.json'))

@pytest.mark.parametrize('wire',[
 b'{"seq":1,"op":"stop"}\n{"seq":2,"op":"focus"}\n{"seq":3,"op":"unknown"}\n',
 b'{"seq":9,"op":"stop"}\n',b'not-json\n',b'x'*4096,b'{"seq":1}',
])
def test_stdio_protocol_refuses_invalid_requests_and_handles_parent_eof(monkeypatch,wire):
 output=io.BytesIO();blocks=iter([wire,b''])
 with monkeypatch.context() as m:
  m.setattr(worker.os,'read',lambda *a:next(blocks,b''))
  m.setattr(worker.sys,'stdin',SimpleNamespace(fileno=lambda:0))
  m.setattr(worker.sys,'stdout',SimpleNamespace(buffer=output))
  worker.serve()
 replies=[json.loads(line) for line in output.getvalue().splitlines()]
 assert replies and any(not reply['ok'] for reply in replies)
 if wire.startswith(b'{"seq":1,"op":"stop"}'):
  assert replies[0]['result']['status']=='new';assert replies[1]['error']['code']=='invalid_phase'

def test_stdio_successful_close_finalizes_once(monkeypatch):
 output=io.BytesIO();blocks=iter([b'{"seq":1,"op":"close"}\n',b''])
 real=worker.Session
 class Session(real):
  def __init__(self,cancelled):super().__init__(cancelled);self.phase='stopped'
 with monkeypatch.context() as m:
  m.setattr(worker,'Session',Session);m.setattr(worker.os,'read',lambda *a:next(blocks,b''));m.setattr(worker.sys,'stdin',SimpleNamespace(fileno=lambda:0));m.setattr(worker.sys,'stdout',SimpleNamespace(buffer=output))
  worker.serve()
 assert json.loads(output.getvalue())['result']['status']=='stopped'
