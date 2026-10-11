"""Actual original fixture chain on a fresh inactive Booth; no game/audio changes."""
import argparse,csv,hashlib,json,os,queue,subprocess,sys,threading,time,uuid
from pathlib import Path
SOURCE=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(SOURCE))
from controller_bridge import runtime_artifacts
p=argparse.ArgumentParser();p.add_argument('--runtime',required=True);p.add_argument('--ws-script',required=True);p.add_argument('--ws-session',required=True);p.add_argument('--task',required=True);p.add_argument('--vs-install',required=True);a=p.parse_args()
runtime,manifest=runtime_artifacts(Path(a.runtime))
if manifest['mode']!='early':raise ValueError('Early fixture runtime required')
run=runtime/('worker-fixture-'+uuid.uuid4().hex[:10]);run.mkdir();build=run/'build';build.mkdir();output=run/'target';output.mkdir()
fixture=(SOURCE/'fixtures/gamepad.cpp').read_text().replace('LRESULT CALLBACK procedure(HWND w,UINT m,WPARAM p,LPARAM l){return DefWindowProcW(w,m,p,l);}', 'bool stopRequested=false; LRESULT CALLBACK procedure(HWND w,UINT m,WPARAM p,LPARAM l){if(m==WM_CLOSE){stopRequested=true;return 0;}return DefWindowProcW(w,m,p,l);}')
fixture=fixture.replace('while(GetTickCount64()-start<20000){','while(!stopRequested && GetTickCount64()-start<60000){')
(build/'fixture.cpp').write_text(fixture)
vcvars=Path(a.vs_install)/'VC/Auxiliary/Build/vcvars64.bat'
commands=['@echo off',f'call "{vcvars}" >nul','if errorlevel 1 exit /b %ERRORLEVEL%',f'cd /d "{build}"']
for source,target,define in [(SOURCE/'tests/worker_launch.cpp','me3.exe','/D FIXTURE_OUTER'),(SOURCE/'tests/worker_launch.cpp','me3-launcher.exe',''),(build/'fixture.cpp','eldenring.exe','/D EARLY_FIXTURE')]:
 subsystem='CONSOLE' if target=='me3.exe' else 'WINDOWS'
 commands.extend([f'cl /nologo /std:c++17 /EHsc /O2 {define} "{source}" /Fe:"{build/target}" user32.lib shell32.lib /link /SUBSYSTEM:{subsystem}','if errorlevel 1 exit /b %ERRORLEVEL%'])
commands.append('exit /b 0');recipe=build/'compile.cmd';recipe.write_text('\n'.join(commands))
compiled=subprocess.run([str(recipe)],capture_output=True,text=True,timeout=60);(run/'build.log').write_text(compiled.stdout+compiled.stderr)
if compiled.returncode:raise RuntimeError('Normal authored fixture build failed')
profile=run/'fixture.profile';profile.write_text(str(output)+'\n'+str(runtime/'bin')+'\n')
child=subprocess.Popen([sys.executable,'-I',str(SOURCE/'session_worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
responses=queue.Queue();receipts=[];checks={};completed=False;error=None;seq=0;allocated=None
def reader():
 while line:=child.stdout.readline(12*1024*1024+1):responses.put(json.loads(line))
threading.Thread(target=reader,daemon=True).start()
def request(op,**fields):
 global seq
 seq+=1;raw=json.dumps(dict(seq=seq,op=op,**fields)).encode()+b'\n';assert len(raw)<=4096
 child.stdin.write(raw);child.stdin.flush();value=responses.get(timeout=120);assert value['seq']==seq;receipts.append(value);return value
def succeed(op,**fields):
 value=request(op,**fields);assert value['ok'],value;return value['result']
try:
 allocated=succeed('allocate',runtime_root=str(runtime),ws_script=a.ws_script,ws_session=a.ws_session,task=a.task,run_directory=str(run),lifetime_minutes=2)
 checks['actual_silent_anchor']=allocated['phase']=='await_parent_audio' and allocated['anchor']['pid'] in allocated['open_receipt']['started_pids'] and allocated['appdata']==os.environ['APPDATA']
 checks['close_requires_quiescence']=not request('close')['ok']
 launched=succeed('launch',me3_executable=str(build/'me3.exe'),game_executable=str(build/'eldenring.exe'),profile=str(profile),savefile='original_fixture.sl2',game_sha256=hashlib.sha256((build/'eldenring.exe').read_bytes()).hexdigest(),me3_sha256=hashlib.sha256((build/'me3.exe').read_bytes()).hexdigest())
 checks['actual_owned_chain']=len(launched['binding_receipt']['chain'])==4
 checks['before_main_neutral_admitted']=launched['early_status']['stage']==2 and launched['early_status']['late_calls']==0
 checks['dotnet_tick_epoch']=int(launched['start_ticks_utc'])==((launched['ownership']['created_high']<<32)|launched['ownership']['created_low'])+504911232000000000
 frame=succeed('inspect');checks['exact_smaller_fixture_frame']=frame['capture_receipt']['window']==launched['ownership']['hwnd'] and frame['frame']['width']==300 and frame['frame']['height']==160
 checks['actual_png_hash']=hashlib.sha256(Path(frame['frame']['path']).read_bytes()).hexdigest()==frame['frame']['sha256']
 checks['focus_preserves_owner']=succeed('focus')['owner_desktop_changed'] is False
 state=dict(connected=True,buttons=4096,left_trigger=0,right_trigger=0,left_x=0,left_y=0,right_x=0,right_y=0,lease_ms=100)
 succeed('gamepad',state=state);time.sleep(.4)
 checks['unsupported_key_refused']=not request('key',key='Enter')['ok']
 stopped=succeed('stop');checks['quiescence_preserves_desktop']=stopped['game_exited'] and stopped['controller_closed'] and not stopped['booth_closed'] and stopped['status']=='quiescent'
 rows=list(csv.DictReader((output/'gamepad.csv').open()))
 for dll in ('1_4','1_3'):
  selected=[r for r in rows if r['dll']==dll];pressed=[r for r in selected if int(r['buttons'])==4096]
  checks[dll+'_actual_packet_consumed']=bool(pressed)
  checks[dll+'_expiry_neutral']=bool(pressed) and any(int(r['statebegin'])>int(pressed[-1]['stateend']) and int(r['buttons'])==0 and int(r['status'])==0 for r in selected)
 finalized=succeed('close');checks['explicit_finalize_closed']=finalized['booth_closed'] and finalized['status']=='stopped'
 child.stdin.close();checks['clean_worker_exit']=child.wait(timeout=15)==0
 completed=True
except BaseException as failure:error=repr(failure);raise
finally:
 if child.poll() is None:
  try:request('stop')
  except BaseException:pass
  try:request('close')
  except BaseException:pass
  try:child.stdin.close();child.wait(timeout=20)
  except BaseException:pass
 (run/'verdict.json').write_text(json.dumps(dict(passed=completed and all(checks.values()),completed=completed,checks=checks,error=error,receipts=receipts,worker_sha256=hashlib.sha256((SOURCE/'session_worker.py').read_bytes()).hexdigest()),indent=2))
 print(run)
if not all(checks.values()):raise AssertionError(checks)
