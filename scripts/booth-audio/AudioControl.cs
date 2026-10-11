using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

public class AudioTarget { public int pid; public long start_ticks_utc; public string executable; }
public class AudioSessionResult { public int pid; public string endpoint; public string session; public int state; public bool before_mute; public bool after_mute; public bool changed; }
public class AudioReport { public string operation; public string status; public AudioTarget[] targets; public List<AudioSessionResult> sessions = new List<AudioSessionResult>(); public List<string> exclusions = new List<string>(); public string coverage = "snapshot-active-render-endpoints-and-enumerated-single-process-sessions; no ongoing silence guarantee"; }
public class AudioDefaultRole { public string flow;public string role;public string endpoint;public int hresult; }
public static class OwnedAudio {
 [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr r, uint flags);
 [DllImport("ole32.dll")] static extern void CoUninitialize();
 [DllImport("ole32.dll")] static extern int CoCreateInstance(ref Guid cls, IntPtr outer, uint context, ref Guid iid, out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QI(IntPtr self, ref Guid iid, out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint Release(IntPtr self);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Endpoints(IntPtr self, int flow, uint state, out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DefaultEndpoint(IntPtr self, int flow, int role, out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Count(IntPtr self, out uint result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Item(IntPtr self, uint index, out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Activate(IntPtr self, ref Guid iid, uint context, IntPtr parameters, out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int PointerOut(IntPtr self, out IntPtr result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int IntOut(IntPtr self, out int result);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetMute(IntPtr self, int mute, ref Guid context);
 static T Method<T>(IntPtr p, int slot) where T: Delegate { return Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(p),slot*IntPtr.Size)); }
 static void Free(IntPtr p) { if(p!=IntPtr.Zero) Method<Release>(p,2)(p); }
 static void HR(int hr) { if(hr!=0) throw new COMException("Expected S_OK",hr); }
 static IntPtr Query(IntPtr p,string guid) { var g=new Guid(guid); IntPtr r; HR(Method<QI>(p,0)(p,ref g,out r));return r; }
 static string StringAt(IntPtr p,int slot) { IntPtr s; HR(Method<PointerOut>(p,slot)(p,out s));try{return Marshal.PtrToStringUni(s);}finally{Marshal.FreeCoTaskMem(s);} }
 static void Verify(Process p,AudioTarget t) { p.Refresh(); if(p.HasExited || p.StartTime.ToUniversalTime().Ticks!=t.start_ticks_utc || !string.Equals(Path.GetFullPath(p.MainModule.FileName),Path.GetFullPath(t.executable),StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Process identity mismatch: "+t.pid); }
 public static List<AudioDefaultRole> SnapshotDefaults(){IntPtr e=IntPtr.Zero;int init=CoInitializeEx(IntPtr.Zero,0);if(init<0)Marshal.ThrowExceptionForHR(init);try{var cls=new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");var iid=new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6");HR(CoCreateInstance(ref cls,IntPtr.Zero,1,ref iid,out e));var result=new List<AudioDefaultRole>();for(int flow=0;flow<2;flow++)for(int role=0;role<3;role++){IntPtr device=IntPtr.Zero;try{int hr=Method<DefaultEndpoint>(e,4)(e,flow,role,out device);result.Add(new AudioDefaultRole{flow=flow==0?"render":"capture",role=new[]{"console","multimedia","communications"}[role],hresult=hr,endpoint=hr==0?StringAt(device,5):null});}finally{Free(device);}}return result;}finally{Free(e);CoUninitialize();}}
 public static AudioReport Run(AudioTarget[] targets,string operation) {
  if(operation!="status" && operation!="mute" && operation!="unmute") throw new ArgumentException("Unknown operation");
  if(targets==null || targets.Length==0 || targets.Length>128) throw new ArgumentException("Require 1..128 exact targets");
  var owned=new Dictionary<int,Process>(); var identities=new Dictionary<int,AudioTarget>();
  IntPtr enumerator=IntPtr.Zero,collection=IntPtr.Zero; int init=CoInitializeEx(IntPtr.Zero,0); if(init<0) Marshal.ThrowExceptionForHR(init);
  try {
   foreach(var t in targets) { if(t.pid<=0 || t.start_ticks_utc<=0 || !Path.IsPathFullyQualified(t.executable) || owned.ContainsKey(t.pid)) throw new ArgumentException("Invalid or duplicate process identity"); var p=Process.GetProcessById(t.pid); owned.Add(t.pid,p); var handle=p.Handle; Verify(p,t); identities.Add(t.pid,t); }
   var cls=new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");var iid=new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"); HR(CoCreateInstance(ref cls,IntPtr.Zero,1,ref iid,out enumerator));
   HR(Method<Endpoints>(enumerator,3)(enumerator,0,1,out collection));uint n;HR(Method<Count>(collection,3)(collection,out n)); if(n>256) throw new InvalidOperationException("Endpoint bound exceeded");
   var report=new AudioReport{operation=operation,targets=targets};
   for(uint i=0;i<n;i++) {
    IntPtr device=IntPtr.Zero,manager=IntPtr.Zero,sessions=IntPtr.Zero;
    try {
     HR(Method<Item>(collection,4)(collection,i,out device)); string endpoint=StringAt(device,5);var mguid=new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"); HR(Method<Activate>(device,3)(device,ref mguid,23,IntPtr.Zero,out manager));HR(Method<PointerOut>(manager,5)(manager,out sessions));uint count;HR(Method<Count>(sessions,3)(sessions,out count));if(count>4096)throw new InvalidOperationException("Session bound exceeded");
     for(uint j=0;j<count;j++) {
      IntPtr control=IntPtr.Zero,control2=IntPtr.Zero,volume=IntPtr.Zero;
      try {
       HR(Method<Item>(sessions,4)(sessions,j,out control));control2=Query(control,"BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D");int pid;int pidhr=Method<IntOut>(control2,14)(control2,out pid);
       if(!owned.ContainsKey(pid))continue;
       if(pidhr!=0){report.exclusions.Add("Ambiguous/failed ownership HRESULT "+pidhr+" for matched PID "+pid);continue;}
       Verify(owned[pid],identities[pid]);volume=Query(control,"87CE5498-68D6-44E5-9215-6DA47EF883D8");int before;HR(Method<IntOut>(volume,6)(volume,out before));int state;HR(Method<IntOut>(control,3)(control,out state)); string session=StringAt(control2,13);
       var row=new AudioSessionResult{pid=pid,endpoint=endpoint,session=session,state=state,before_mute=before!=0,after_mute=before!=0};report.sessions.Add(row);
       if(operation!="status") { Verify(owned[pid],identities[pid]);int actualpid;HR(Method<IntOut>(control2,14)(control2,out actualpid));if(actualpid!=pid)throw new InvalidOperationException("Session PID changed");var context=new Guid("F7B47F19-8517-4A72-A7E2-6386AEFD5F32");HR(Method<SetMute>(volume,5)(volume,operation=="mute"?1:0,ref context));int after;HR(Method<IntOut>(volume,6)(volume,out after));row.after_mute=after!=0;row.changed=row.before_mute!=row.after_mute;if(row.after_mute!=(operation=="mute"))throw new InvalidOperationException("Mute readback mismatch"); }
       Verify(owned[pid],identities[pid]);
      } finally { Free(volume);Free(control2);Free(control); }
     }
    } finally { Free(sessions);Free(manager);Free(device); }
   }
   foreach(var t in targets) Verify(owned[t.pid],t);
   report.status=report.exclusions.Count>0?"partial-ambiguous-sessions":report.sessions.Count==0?"no-sessions-observed":"observed";return report;
  } finally {Free(collection);Free(enumerator);foreach(var p in owned.Values)p.Dispose();CoUninitialize();}
 }
}
