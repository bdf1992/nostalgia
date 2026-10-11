"""Helper-only stdio bridge for an externally owned, exact Booth process.
No game launch, target discovery, target kill, Booth closure, or input desktop change.
Ownership is established by the caller's launch evidence, not by these labels.
"""
from __future__ import annotations
import ctypes,hashlib,json,os,queue,subprocess,threading
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
_SOURCE=Path(__file__).resolve().parent
def runtime_artifacts(runtime_root:Path):
 root=Path(runtime_root)
 if not root.is_absolute() or root.is_symlink() or not root.is_dir():raise ValueError('Exact provisioned runtime directory required')
 with (root/'artifacts.json').open('rb') as stream:raw=stream.read(65537)
 if len(raw)>65536:raise ValueError('Runtime manifest exceeds64KiB')
 value=json.loads(raw)
 if value.get('version')!=1 or value.get('mode') not in ('ordinary','early'):raise ValueError('Provisioned runtime manifest required')
 pins=value.get('sha256',{})
 required=('proto-controller.exe','desktop-launcher.exe','bin/ProtoInputLoader64.dll','bin/ProtoInputHooks64.dll','gamepad-fixture.exe')
 if set(pins)!=set(required) or any(not isinstance(v,str) or len(v)!=64 or any(c not in '0123456789abcdef' for c in v) for v in pins.values()):raise ValueError('Exact runtime artifact identities required')
 return root,value

_KERNEL=ctypes.WinDLL('kernel32',use_last_error=True)
_KERNEL.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];_KERNEL.OpenProcess.restype=wintypes.HANDLE
_KERNEL.GetProcessTimes.argtypes=[wintypes.HANDLE]+[ctypes.POINTER(wintypes.FILETIME)]*4;_KERNEL.GetProcessTimes.restype=wintypes.BOOL
_KERNEL.QueryFullProcessImageNameW.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD)];_KERNEL.QueryFullProcessImageNameW.restype=wintypes.BOOL
_KERNEL.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];_KERNEL.WaitForSingleObject.restype=wintypes.DWORD
_KERNEL.CloseHandle.argtypes=[wintypes.HANDLE];_KERNEL.CloseHandle.restype=wintypes.BOOL

_KERNEL.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE];_KERNEL.CreateFileW.restype=wintypes.HANDLE
_KERNEL.ReadFile.argtypes=[wintypes.HANDLE,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(wintypes.DWORD),ctypes.c_void_p];_KERNEL.ReadFile.restype=wintypes.BOOL
_KERNEL.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD];_KERNEL.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
class _Entry(ctypes.Structure):
 _fields_=[('dwSize',wintypes.DWORD),('cntUsage',wintypes.DWORD),('th32ProcessID',wintypes.DWORD),('th32DefaultHeapID',ctypes.c_size_t),('th32ModuleID',wintypes.DWORD),('cntThreads',wintypes.DWORD),('th32ParentProcessID',wintypes.DWORD),('pcPriClassBase',wintypes.LONG),('dwFlags',wintypes.DWORD),('szExeFile',wintypes.WCHAR*260)]
_KERNEL.Process32FirstW.argtypes=[wintypes.HANDLE,ctypes.POINTER(_Entry)];_KERNEL.Process32FirstW.restype=wintypes.BOOL
_KERNEL.Process32NextW.argtypes=[wintypes.HANDLE,ctypes.POINTER(_Entry)];_KERNEL.Process32NextW.restype=wintypes.BOOL

def _pin_helper(root,pins,name):
 path=root/name
 if path.is_symlink() or not path.is_file():raise RuntimeError('Pinned helper path refused')
 handle=_KERNEL.CreateFileW(str(path),0x80000000,1,None,3,0x00200000,None)
 if handle in (None,ctypes.c_void_p(-1).value):raise OSError(ctypes.get_last_error(),'Helper pin unavailable')
 try:
  digest=hashlib.sha256();total=0;buffer=ctypes.create_string_buffer(65536)
  while True:
   count=wintypes.DWORD()
   if not _KERNEL.ReadFile(handle,buffer,len(buffer),ctypes.byref(count),None):raise OSError(ctypes.get_last_error(),'Pinned helper read failed')
   if not count.value:break
   total+=count.value
   if total>1024*1024:raise RuntimeError('Pinned helper exceeds limit')
   digest.update(buffer.raw[:count.value])
  if digest.hexdigest()!=pins[name]:raise RuntimeError('Pinned helper artifact mismatch')
  return handle
 except BaseException:_KERNEL.CloseHandle(handle);raise

class ControllerFailure(RuntimeError):
 def __init__(self,message,controller):
  super().__init__(message);self.controller=controller;self.recovery=controller.owned_helper_metadata()

def _integer(value,maximum):
 if type(value) is not int or not 0<=value<=maximum:raise ValueError('Invalid raw numeric metadata')
 return value

def _held(pid,executable):
 _integer(pid,0xffffffff)
 if not pid:raise ValueError('Zero PID')
 expected=Path(executable)
 if not expected.is_absolute():raise ValueError('Executable must be absolute')
 handle=_KERNEL.OpenProcess(0x100000|0x1000,False,pid)
 if not handle:raise OSError(ctypes.get_last_error(),'Exact owned process unavailable')
 try:
  if _KERNEL.WaitForSingleObject(handle,0)!=258:raise RuntimeError('Exact process exited')
  c,e,k,u=(wintypes.FILETIME() for _ in range(4))
  if not _KERNEL.GetProcessTimes(handle,ctypes.byref(c),ctypes.byref(e),ctypes.byref(k),ctypes.byref(u)):raise OSError(ctypes.get_last_error(),'Process creation metadata unavailable')
  image=ctypes.create_unicode_buffer(32768);length=wintypes.DWORD(32768)
  if not _KERNEL.QueryFullProcessImageNameW(handle,0,image,ctypes.byref(length)):raise OSError(ctypes.get_last_error(),'Process image unavailable')
  if os.path.normcase(os.path.normpath(image.value))!=os.path.normcase(os.path.normpath(str(expected))):raise RuntimeError('Exact process executable mismatch')
  return handle,c.dwHighDateTime,c.dwLowDateTime
 except BaseException:
  _KERNEL.CloseHandle(handle);raise

def read_owned_process_metadata(pid:int,executable:str)->dict:
 """Read FILETIME for a caller-selected, already-owned PID; never selects a target."""
 handle,hi,lo=_held(pid,executable)
 try:return {'pid':pid,'created_high':hi,'created_low':lo,'executable':str(Path(executable))}
 finally:_KERNEL.CloseHandle(handle)

@dataclass(frozen=True)
class OwnedBoothTarget:
 pid:int
 created_high:int
 created_low:int
 executable:str
 hwnd:int
 desktop:str

class Controller:
 def __init__(self,target:OwnedBoothTarget,diagnostics_path:Path,*,runtime_root:Path,startup_timeout:float=8,response_timeout:float=5):
  self._runtime,self._manifest=runtime_artifacts(runtime_root)
  if not 0<startup_timeout<=15 or not 0<response_timeout<=15:raise ValueError('Timeout out of range')
  _integer(target.hwnd,0xffffffffffffffff);_integer(target.created_high,0xffffffff);_integer(target.created_low,0xffffffff)
  if not target.hwnd or not isinstance(target.desktop,str) or not target.desktop.startswith('ws-booth-') or len(target.desktop)>255 or any(c in target.desktop for c in '\\/:\x00'):raise ValueError('Exact inactive Booth metadata required')
  self.target=target;self.response_timeout=response_timeout;self._lock=threading.Lock();self._responses=queue.Queue(maxsize=4);self._next=0;self._closed=False;self.history=[];self.process=None;self._diagnostics=None;self._pins=[]
  self._handle,hi,lo=_held(target.pid,target.executable)
  if (hi,lo)!=(target.created_high,target.created_low):_KERNEL.CloseHandle(self._handle);self._handle=None;raise RuntimeError('Process FILETIME changed')
  try:
   for name in ('proto-controller.exe','desktop-launcher.exe'):self._pins.append(_pin_helper(self._runtime,self._manifest['sha256'],name))
   diagnostics=Path(diagnostics_path)
   if not diagnostics.is_absolute() or not diagnostics.parent.resolve().is_relative_to(self._runtime) or diagnostics.parent.is_symlink():raise ValueError('Diagnostics must be inside the controller-owned directory')
   self._diagnostics=diagnostics.open('xb')
   args=[str(self._runtime/'desktop-launcher.exe'),'--pid',str(target.pid),'--created-high',str(target.created_high),'--created-low',str(target.created_low),'--exe',target.executable,'--hwnd',str(target.hwnd),'--desktop',target.desktop,'--dll-dir',str(self._runtime/'bin')]
   self.process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self._diagnostics,creationflags=subprocess.CREATE_NO_WINDOW)
   threading.Thread(target=self._collect,daemon=True).start()
   ready=self._receive(0,startup_timeout)
   if not ready['ok']:raise RuntimeError('Controller admission refused: '+str(ready))
  except BaseException as error:
   if self.process and self.process.stdin and not self.process.stdin.closed:self.process.stdin.close()
   if self.process:
    try:self.process.wait(timeout=10)
    except subprocess.TimeoutExpired:pass # Caller retains a concrete owned-helper cleanup gap; no target kill.
   if not self.process or self.process.poll() is not None:
    if self._diagnostics:self._diagnostics.close()
    if self._handle:_KERNEL.CloseHandle(self._handle);self._handle=None
    for handle in self._pins:_KERNEL.CloseHandle(handle)
    self._pins=[]
   raise ControllerFailure(str(error),self) from error
 def owned_helper_metadata(self):
  """Concrete helper PIDs/FILETIME/image; never a game ownership claim."""
  if not self.process:return {'helpers':[],'launcher_running':False}
  helpers=[]
  def add(pid,name):
   try:
    handle,hi,lo=_held(pid,str(self._runtime/name))
    try:helpers.append({'pid':pid,'created_high':hi,'created_low':lo,'executable':str(self._runtime/name)})
    finally:_KERNEL.CloseHandle(handle)
   except (OSError,RuntimeError):pass
  add(self.process.pid,'desktop-launcher.exe')
  snapshot=_KERNEL.CreateToolhelp32Snapshot(2,0)
  if snapshot not in (None,ctypes.c_void_p(-1).value):
   try:
    entry=_Entry();entry.dwSize=ctypes.sizeof(entry);found=_KERNEL.Process32FirstW(snapshot,ctypes.byref(entry))
    while found:
     if entry.th32ParentProcessID==self.process.pid and entry.szExeFile.lower()=='proto-controller.exe':add(entry.th32ProcessID,'proto-controller.exe')
     found=_KERNEL.Process32NextW(snapshot,ctypes.byref(entry))
   finally:_KERNEL.CloseHandle(snapshot)
  return {'helpers':helpers,'launcher_running':self.process.poll() is None}
 def _collect(self):
  try:
   while True:
    line=self.process.stdout.readline(4097)
    if not line:break
    if len(line)>4096 or not line.endswith(b'\n'):raise RuntimeError('Controller response length invalid')
    item=json.loads(line)
    self._responses.put_nowait(item)
   self._responses.put_nowait(RuntimeError('Controller response channel ended'))
  except BaseException as error:
   try:self._responses.put_nowait(error)
   except queue.Full:pass
 def _receive(self,op,timeout):
  try:item=self._responses.get(timeout=timeout)
  except queue.Empty:raise TimeoutError('Owned controller response deadline expired') from None
  if isinstance(item,BaseException):raise item
  if not isinstance(item,dict) or set(item)!={'seq','op','ok','code','pid','hwnd'} or type(item['ok']) is not bool or any(type(v) is not int for k,v in item.items() if k!='ok') or item['seq']!=self._next or item['op']!=op or item['pid']!=self.target.pid or item['hwnd']!=self.target.hwnd or not 0<=item['code']<=8:raise RuntimeError('Controller response binding refused')
  self._next+=1;self.history.append(item)
  if len(self.history)>512:self.history.pop(0)
  return item
 def _command(self,line,op):
  with self._lock:
   if self._closed or not self.process or self.process.poll() is not None:raise RuntimeError('Owned controller is closed')
   if _KERNEL.WaitForSingleObject(self._handle,0)!=258:raise RuntimeError('Owned target exited')
   encoded=(line+'\n').encode('ascii')
   if len(encoded)>4096:raise ValueError('Command exceeds 4KiB')
   self.process.stdin.write(encoded);self.process.stdin.flush();return self._receive(op,self.response_timeout)
 def enable(self):return self._command('enable',1)
 def key(self,vk:int,scan:int,flags:int,lease_ms:int):
  for value,maxval in [(vk,254),(scan,255),(flags,7),(lease_ms,2000)]:_integer(value,maxval)
  if not vk or vk in (91,92) or not scan or flags&6==6 or ((flags&1 and lease_ms!=0) or (not flags&1 and lease_ms<1)):raise ValueError('Synthetic key arguments refused')
  return self._command(f'key {vk} {scan} {flags} {lease_ms}',2)
 def gamepad_enable(self):return self._command('gamepad_enable',5)
 def gamepad_disable(self):return self._command('gamepad_disable',7)
 def gamepad(self,connected:bool,buttons:int=0,left_trigger:int=0,right_trigger:int=0,left_x:int=0,left_y:int=0,right_x:int=0,right_y:int=0,lease_ms:int=100):
  if type(connected) is not bool:raise ValueError('Connected must be bool')
  _integer(buttons,65535);_integer(left_trigger,255);_integer(right_trigger,255);_integer(lease_ms,2000)
  for axis in (left_x,left_y,right_x,right_y):
   if type(axis) is not int or not -32768<=axis<=32767:raise ValueError('Axis out of range')
  if buttons&~0xF3FF or (connected and lease_ms<1) or (not connected and any((buttons,left_trigger,right_trigger,left_x,left_y,right_x,right_y,lease_ms))):raise ValueError('Synthetic gamepad arguments refused')
  return self._command(f'gamepad {int(connected)} {buttons} {left_trigger} {right_trigger} {left_x} {left_y} {right_x} {right_y} {lease_ms}',6)
 def disable(self):return self._command('disable',3)
 def close(self,*,eof:bool=False):
  with self._lock:
   if self._closed:
    if self.process.poll() is None:raise ControllerFailure('Previous owned helper shutdown remains incomplete',self)
    return None
   self._closed=True;result=None
   try:
    if self.process.poll() is None:
     if not eof:self.process.stdin.write(b'close\n');self.process.stdin.flush()
     self.process.stdin.close();result=self._receive(4,self.response_timeout)
    self.process.wait(timeout=10)
    if result is not None and not result['ok']:raise RuntimeError('Owned controller cleanup receipt refused')
    return result
   except BaseException as error:
    raise ControllerFailure(str(error),self) from error
   finally:
    if self.process.poll() is not None:
     self.process.stdout.close();self._diagnostics.close()
     if self._handle:_KERNEL.CloseHandle(self._handle);self._handle=None
     for handle in self._pins:_KERNEL.CloseHandle(handle)
     self._pins=[]
    # Running helper after a timeout remains a reported gap; no target kill.
 def __enter__(self):return self
 def __exit__(self,*unused):self.close(eof=True)
