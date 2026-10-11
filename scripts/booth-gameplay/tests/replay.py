# Authored silent fixture only; never selects a game or owner input desktop.
import argparse,os,sys,json,uuid,time,subprocess,csv,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from controller_bridge import Controller,OwnedBoothTarget,read_owned_process_metadata,runtime_artifacts
parser=argparse.ArgumentParser();parser.add_argument('--runtime',required=True);parser.add_argument('--ws-script',required=True);parser.add_argument('--ws-session',required=True);parser.add_argument('--task',required=True);args=parser.parse_args()
root,manifest=runtime_artifacts(Path(args.runtime));mode=manifest['mode']
name='nostalgia-gamepad-'+uuid.uuid4().hex[:10];run=root/name;run.mkdir()
fixture=root/'gamepad-fixture.exe';ws=Path(args.ws_script)
if not ws.is_absolute() or not ws.is_file():raise ValueError('Explicit local WS script required')
if hashlib.sha256(fixture.read_bytes()).hexdigest()!=manifest['sha256']['gamepad-fixture.exe']:raise RuntimeError('Authored fixture identity changed')
env=dict(os.environ,WS_SESSION=args.ws_session)
checks={};opened=False;bridge=None;receipts=[];completed=False;failure=None
def cmd(arguments):
 result=subprocess.run([sys.executable,str(ws),'booth','--json',*arguments],env=env,capture_output=True,text=True,timeout=25)
 if result.returncode:raise RuntimeError(result.stdout+result.stderr)
 return json.loads(result.stdout)
def response(operation):
 value=operation();receipts.append(value);assert value['ok'],value
 return value
try:
 booth=cmd(['open',name,'--kind','desktop','--app',str(fixture),'--task',args.task,'--size','320x240','--fps','4','--record-max-mb','16','--for','2','--','target',str(run),*([str(root/'bin')] if mode=='early' else [])])
 opened=True;(run/'booth-open.json').write_text(json.dumps(booth,indent=2))
 deadline=time.monotonic()+4
 while not (run/'target-meta.txt').exists() and time.monotonic()<deadline:time.sleep(.02)
 pid,hwnd,desktop=(run/'target-meta.txt').read_text().split();pid=int(pid);hwnd=int(hwnd)
 windows=cmd(['do',name,'windows']);(run/'windows.json').write_text(json.dumps(windows,indent=2))
 checks['actual_owned_window_membership']=any(w['handle']==hwnd and w['pid']==pid for w in windows['windows'])
 meta=read_owned_process_metadata(pid,str(fixture));target=OwnedBoothTarget(pid,meta['created_high'],meta['created_low'],str(fixture),hwnd,desktop)
 checks['inactive_desktop_bound']=desktop==booth['desktop_name'] and desktop.startswith('ws-booth-')
 bridge=Controller(target,run/'controller-stderr.txt',runtime_root=root)
 # All malformed arguments refused locally before command writes.
 for kwargs in ({'buttons':1024},{'left_x':32768},{'lease_ms':2001},{'connected':False,'lease_ms':1}):
  try:bridge.gamepad(**dict({'connected':True},**kwargs));raise AssertionError('Invalid gamepad accepted')
  except ValueError:pass
 checks['client_invalid_states_refused']=True
 # Early initializer intentionally preserves connected neutral slot0 through late attachment.
 if mode=='early':
  early=json.loads((run/'early-startup.json').read_text());checks['pre_main_neutral_connected']=early['initialized'] and early['status']==0 and all(early[k]==0 for k in ('buttons','leftTrigger','rightTrigger','leftX','leftY','rightX','rightY'))
  checks['pre_main_only_xinput_no_late_runtime']=early['earlyFields'][:5]==[1,80,1,2,1] and early['earlyFields'][5:9]==[0,0,0,1]
 else:checks['disabled_state_refused']=not bridge.gamepad(True,buttons=16,lease_ms=100)['ok']
 response(bridge.gamepad_enable);time.sleep(.2)
 checks['capi_reserved_buttons_refused']=not bridge._command('gamepad 1 1024 0 0 0 0 0 0 100',6)['ok']
 response(lambda:bridge.gamepad(True,buttons=0x1010,left_trigger=17,right_trigger=231,left_x=-32768,left_y=32767,right_x=-12000,right_y=8000,lease_ms=2000));time.sleep(.45)
 response(lambda:bridge.gamepad(True,buttons=0x1010,left_trigger=17,right_trigger=231,left_x=-32768,left_y=32767,right_x=-12000,right_y=8000,lease_ms=2000));time.sleep(.45)
 response(lambda:bridge.gamepad(True,lease_ms=2000));time.sleep(.2)
 response(lambda:bridge.gamepad(True,buttons=16,lease_ms=100));time.sleep(.4)
 response(lambda:bridge.gamepad(True,buttons=4096,lease_ms=2000));time.sleep(.1)
 response(bridge.gamepad_disable);time.sleep(.25)
 response(bridge.gamepad_enable);time.sleep(.2)
 response(lambda:bridge.gamepad(True,buttons=32,lease_ms=2000));time.sleep(.1)
 response(lambda:bridge.gamepad(False,lease_ms=0));time.sleep(.2)
 response(lambda:bridge.gamepad(True,buttons=64,lease_ms=2000));time.sleep(.15)
 final=bridge.close(eof=True);receipts.append(final);checks['eof_cleanup_written']=final['ok'] and final['op']==4
 (run/'host-done.txt').write_text('controller EOF; target polling remains active')
 deadline=time.monotonic()+5
 while not (run/'target-done.txt').exists() and time.monotonic()<deadline:time.sleep(.05)
 checks['target_completed_without_kill']=(run/'target-done.txt').exists()
 if mode=='early':
  final_early=json.loads((run/'early-final.json').read_text());checks['existing_load_dllmain_not_repeated']=final_early[8]==1
  checks['late_bootstrap_once_ready']=final_early[5]==1 and final_early[6]==2 and final_early[7]==1
 rows=list(csv.DictReader((run/'gamepad.csv').open()));checks['both_dlls_sampled']={r['dll'] for r in rows}=={'1_3','1_4'}
 checks['regular_extended_canaries_intact']=all(r['statecanary']=='1' and r['excanary']=='1' for r in rows)
 evidence={}
 for dll in ('1_3','1_4'):
  values=[{k:int(v) for k,v in row.items() if k!='dll'} for row in rows if row['dll']==dll]
  connected=[r for r in values if r['status']==0]
  checks[dll+'_connected_states_observed']=len(connected)>50
  diagnostic=[r for r in connected if r['diagready']==1]
  checks[dll+'_diagnostic_abi_read']=len(diagnostic)>30 and all(r['diaggen']%2==0 for r in diagnostic)
  checks[dll+'_diagnostic_actual_consumption']=any(r['diagtotal']>r['diagex']>0 and r['diagsuccess']>r['diagnonzero']>0 and r['diagcaps']>0 and r['diagfocus']>0 and r['diaglastfocus']==hwnd and r['foreground']==hwnd for r in diagnostic)
  checks[dll+'_diagnostic_buttons_packet_from_return']=any(r['buttons']==0x1010 and r['diagbuttons']==r['buttons'] and r['diagpacket']==r['packet'] for r in diagnostic)
  checks[dll+'_full_state_axes_triggers']=any((r['buttons'],r['lt'],r['rt'],r['lx'],r['ly'],r['rx'],r['ry'])==(0x1010,17,231,-32768,32767,-12000,8000) and r['exequal']==1 for r in connected)
  checks[dll+'_slots1to3_disconnected']=all((r['slot1'],r['slot2'],r['slot3'])==(1167,1167,1167) for r in connected)
  checks[dll+'_caps_flag0and1_full_no_rumble']=all(r['capsvalid']==1 and r['capsflag1']==1 for r in connected)
  checks[dll+'_caps_virtual_without_rumble']=all((r['capsstatus'],r['capsflags'],r['capsbuttons'],r['vibrationstatus'])==(0,0,0xF3FF,0) for r in connected)
  checks[dll+'_invalid_args_no_hardware_fallback']=all((r['badflags'],r['nullstate'],r['nullcap'],r['nullvibration'],r['nullex'],r['any'],r['invalidslot'],r['slot1rumble'])==(160,160,160,160,160,1167,1167,1167) for r in connected)
  stable=[r for r in connected if r['buttons']==0x1010]
  checks[dll+'_packet_stable_across_same_state_rewrite']=len(stable)>30 and len({r['packet'] for r in stable})==1
  transitions=[];last=None
  for r in values:
   state=(r['status'],r['buttons'])
   if state!=last:transitions.append({'tick':r['tick'],'state':state,'packet':r['packet']});last=state
  active=next((i for i,x in enumerate(transitions) if x['state']==(0,16)),None)
  checks[dll+'_lease_neutral_before2000']=active is not None and transitions[active+1]['state']==(0,0) and 75<=transitions[active+1]['tick']-transitions[active]['tick']<=250 and transitions[active+1]['packet']!=transitions[active]['packet']
  checks[dll+'_disable_disconnect_eof_isolated']=all(any(transitions[i]['state']==(0,button) and transitions[i+1]['state']==(1167,0) for i in range(len(transitions)-1)) for button in (4096,32,64))
  checks[dll+'_post_eof_disconnected']=all(r['status']==1167 and r['slot1']==1167 and r['slot2']==1167 and r['slot3']==1167 for r in values[-50:])
  checks[dll+'_extended_stable_state_matches16bytes']=all(r['exequal']==1 for r in connected if r['buttons']==0x1010)
  evidence[dll]=transitions
 completed=True
 (run/'transitions.json').write_text(json.dumps(evidence,indent=2));(run/'responses.json').write_text(json.dumps(bridge.history,indent=2))
except BaseException as error:
 failure=repr(error)
 raise
finally:
 if bridge and not bridge._closed:
  try:bridge.close(eof=True)
  except BaseException as error:checks['controller_cleanup_failed']=False;failure=(failure or '')+' cleanup: '+repr(error)
 if opened:
  try:
   closed=cmd(['close',name]);(run/'booth-close.json').write_text(json.dumps(closed,indent=2));checks['owned_booth_closed']=closed.get('desktop_closed') is True
  except BaseException as error:checks['owned_booth_closed']=False;failure=(failure or '')+' Booth cleanup: '+repr(error)
 verdict={'passed':completed and failure is None and all(checks.values()),'completed':completed,'failure':failure,'checks':checks,'run':str(run),'scope':'authored fixture only; no real game or physical controller test','artifacts':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [fixture,root/'proto-controller.exe',root/'bin/ProtoInputLoader64.dll',root/'bin/ProtoInputHooks64.dll'] if p.exists()}}
 (run/'verdict.json').write_text(json.dumps(verdict,indent=2));print(json.dumps(verdict,indent=2))
if not completed or failure or not all(checks.values()):raise RuntimeError('Gamepad fixture assertions failed')
