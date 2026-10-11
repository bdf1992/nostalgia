"""Pure contract checks. No desktop, process launch, or game input."""
import json,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from bind_owned import BindingConfig,bind
from session_worker import Session,WorkerError

class Contract(unittest.TestCase):
 def test_launch_interval_shape(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'owned.exe';path.touch()
   for interval in ((1,45000000001),(20,10),(True,10),(0,1),(1,45000000002),(1,),[1,2]):
    config=BindingConfig(path,'fixture',str(path),str(path),str(path),str(path),interval)
    if interval==(1,45000000001):config.validate()
    else:
     with self.assertRaises(ValueError):config.validate()
 def test_creation_outside_exact_interval_refused_before_inventory(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);exe=root/'owned.exe';exe.touch();receipt=root/'launch.json';now=time.time_ns()
   receipt.write_text(json.dumps(dict(action_outcome='ok',booth='nostalgia-fixture',event_pending=False,pid=123,command=[str(exe),str(exe)],event_id='E-20261011T000000Z-fixture')))
   ticks=(now+11644473600000000000)//100
   config=BindingConfig(exe,'fixture',str(exe),str(exe),str(exe),str(exe),(now+1000000,now+2000000))
   with patch('bind_owned.read_owned_process_metadata',return_value={'created_high':ticks>>32,'created_low':ticks&0xffffffff}),patch('bind_owned.inventory') as inventory:
    with self.assertRaisesRegex(RuntimeError,'outside worker-owned'):bind(str(receipt),'nostalgia-fixture',str(root),config)
    inventory.assert_not_called()
 def test_expiry_refuses_ready_before_identity(self):
  import threading
  session=Session(threading.Event());session.phase='ready';session.deadline=time.monotonic()-1
  with patch.object(session,'identity') as identity:
   with self.assertRaises(WorkerError) as error:session.ready()
   self.assertEqual(error.exception.code,'session_expired');identity.assert_not_called()

if __name__=='__main__':unittest.main()
