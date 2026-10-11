"""Original inactive-Booth full loop; no game/audio/owner input operations."""
import argparse,csv,hashlib,json,time,uuid,os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from booth_driver import Driver,LaunchSpec,Refusal,OwnedBoothTarget,read_owned_process_metadata
from controller_bridge import runtime_artifacts
parser=argparse.ArgumentParser();parser.add_argument('--runtime',required=True);parser.add_argument('--ws-script',required=True);parser.add_argument('--ws-session',required=True);parser.add_argument('--task',required=True);args=parser.parse_args()
root,manifest=runtime_artifacts(Path(args.runtime));run=root/('fixture-'+uuid.uuid4().hex[:12]);run.mkdir()
fixture=root/'gamepad-fixture.exe';expected=manifest['sha256']['gamepad-fixture.exe']
if hashlib.sha256(fixture.read_bytes()).hexdigest()!=expected:raise RuntimeError('Original fixture artifact changed')
fixture_args=('target',str(run))+((str(root/'bin'),) if manifest['mode']=='early' else ())
spec=LaunchSpec(str(fixture),fixture_args,str(fixture),args.task,args.ws_session)
providers=dict(ws_script=Path(args.ws_script),runtime_root=root,workspace_root=root)
admission=object();checks={};driver=None;completed=False;failure=None;lease_evidence={}
# Fixture-only trusted callback. This cannot admit games or infer audio safety.
def verify(token,plan):return token is admission and plan==spec and hashlib.sha256(fixture.read_bytes()).hexdigest()==expected
# Actual root-style launch binding, with no invented ME3 logs/PIDs.
def bind(receipt,inventory,plan):
 if receipt['app']!=[str(fixture),*fixture_args] or inventory['booth']!=receipt['name']:raise Refusal('Original launch identity differs')
 windows=[w for w in inventory['windows'] if w['pid'] in receipt['started_pids']]
 if len(windows)!=1:raise Refusal('Ambiguous owned fixture window')
 window=windows[0];meta=read_owned_process_metadata(window['pid'],str(fixture));actual=((meta['created_high']<<32)|meta['created_low'])/10000000-11644473600
 if abs(actual-receipt['pid_created'][str(meta['pid'])])>.01:raise Refusal('Launch/start FILETIME mismatch')
 return OwnedBoothTarget(meta['pid'],meta['created_high'],meta['created_low'],meta['executable'],window['handle'],receipt['desktop_name'])
try:
 before={p.name for p in root.iterdir()}
 for token in (None,False,{'verified':True,'audio':False}):
  rejected=Driver(verify_preflight=verify,bind_owned_target=bind,**providers)
  try:rejected.start(spec,token);raise AssertionError('Unverified launch admitted')
  except Refusal:pass
 checks['unverified_audio_false_labels_refused_before_writes']={p.name for p in root.iterdir()}==before
 try:Driver(verify_preflight=None,bind_owned_target=None,**providers);raise AssertionError('Missing trusted hooks accepted')
 except Refusal:checks['missing_trusted_hooks_refused']=True
 driver=Driver(verify_preflight=verify,bind_owned_target=bind,**providers);started=driver.start(spec,admission)
 (run/'driver-start.json').write_text(json.dumps(started,indent=2))
 checks['launch_receipt_actual_binding']=started['status']=='running' and started['launch_receipt']['started_pids']==[started['owned_target']['pid']]
 checks['actual_helpers_retained']=len(started['owned_helpers']['helpers'])==2
 selected=driver.focus_on(pid=started['owned_target']['pid'],hwnd=started['owned_target']['hwnd']);checks['focus_selects_without_owner_desktop']=selected['owner_desktop_changed'] is False
 try:driver.focus_on(pid=started['owned_target']['pid']+1);raise AssertionError('Foreign target selected')
 except Refusal:checks['foreign_selection_refused']=True
 frame=driver.screenshot();(run/'driver-frame.json').write_text(json.dumps(frame,indent=2));checks['actual_frame_binding']=frame['hwnd']==started['owned_target']['hwnd'] and frame['capture_receipt']['booth']==driver.name and frame['bytes']>57
 checks['actual_frame_hash']=hashlib.sha256(Path(frame['path']).read_bytes()).hexdigest()==frame['sha256']
 try:driver._validate_png(b'\x89PNG\r\n\x1a\n');raise AssertionError('Truncated frame accepted')
 except Refusal:checks['truncated_png_refused']=True
 for operation in (lambda:driver.click(1,1),lambda:driver.controller_axis(0,100)):
  try:operation();raise AssertionError('Unimplemented input accepted')
  except Refusal:pass
 checks['unsupported_click_axis_commands_refused']=True
 # Normal keyboard packet still uses existing exact-process admission.
 checks['keyboard_write_receipt']=driver.key(13,28,lease_ms=100)['ok'];time.sleep(.15)
 checks['gamepad_enable_written']=driver.gamepad_enable()['ok'];time.sleep(.15)
 checks['gamepad_state_written']=driver.gamepad(True,buttons=0x1010,left_trigger=17,right_trigger=231,left_x=-32768,left_y=32767,right_x=-12000,right_y=8000,lease_ms=100)['ok'];time.sleep(.35)
 checks['gamepad_held_written']=driver.gamepad(True,buttons=4096,lease_ms=2000)['ok'];time.sleep(.15)
 checks['gamepad_disable_written']=driver.gamepad_disable()['ok'];time.sleep(.25)
 rows=list(csv.DictReader((run/'gamepad.csv').open()))
 for dll in ('1_3','1_4'):
  data=[r for r in rows if r['dll']==dll];checks[dll+'_actual_target_state']=any((int(r['buttons']),int(r['lt']),int(r['rt']),int(r['lx']),int(r['ly']),int(r['rx']),int(r['ry']),int(r['exequal']))==(0x1010,17,231,-32768,32767,-12000,8000,1) for r in data)
  active=next((i for i,r in enumerate(data) if r['buttons']=='4112'),None)
  neutral=next((r for r in data[active+1:] if r['status']=='0' and r['buttons']=='0'),None) if active is not None else None
  if active is not None and neutral is not None:
   press=data[active];lower=int(neutral['statebegin'])-int(press['stateend']);upper=int(neutral['stateend'])-int(press['statebegin']);call_uncertainty=max(int(neutral['stateend'])-int(neutral['statebegin']),int(press['stateend'])-int(press['statebegin']))
   lease_evidence[dll]={'lower_ms':lower,'upper_ms':upper,'call_uncertainty_ms':call_uncertainty,'csv_tail_delta_ms':int(neutral['tick'])-int(press['tick']),'status':'observed' if call_uncertainty<=50 else 'inconclusive: getter call stalled'}
   checks[dll+'_actual_lease_neutral']=call_uncertainty<=50 and 50<=lower<=upper<=250
  else:lease_evidence[dll]={'status':'missing press or neutral observation'};checks[dll+'_actual_lease_neutral']=False
  checks[dll+'_actual_disable_disconnected']=all(r['status']=='1167' for r in data[-5:])
 stopped=driver.stop();(run/'driver-stop.json').write_text(json.dumps(stopped,indent=2));checks['owned_booth_closed']=stopped['close_receipt']['desktop_closed'] is True and stopped['owned_only']
 checks['idempotent_stop']=driver.stop()['already_stopped'] is True
 completed=True
except BaseException as error:
 failure=repr(error);raise
finally:
 if driver and driver.status not in ('idle','stopped'):
  try:driver.stop()
  except BaseException as error:failure=(failure or '')+' cleanup: '+repr(error);checks['cleanup_failed']=False
 verdict={'passed':completed and failure is None and all(checks.values()),'completed':completed,'failure':failure,'checks':checks,'lease_evidence':lease_evidence,'run':str(run),'driver_run':str(driver.run) if driver else None,'scope':'original fixture; trusted fixture-only admission, no real game/audio/controller hardware proof','hashes':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (Path(__file__).resolve().parent.parent/'booth_driver.py',Path(__file__),fixture)}}
 (run/'verdict.json').write_text(json.dumps(verdict,indent=2));print(json.dumps(verdict,indent=2))
if not completed or failure or not all(checks.values()):raise RuntimeError('Driver full-loop fixture failed')
