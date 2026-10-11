using System.Runtime.InteropServices;
using System.Security.Cryptography;
// Silent until explicit request. Tone is submitted only to an explicitly selected cable device.
static class NativeAudioFixture {
 [StructLayout(LayoutKind.Sequential,Pack=2)] struct Format {public ushort tag,channels;public uint rate,bytes;public ushort align,bits,extra;}
 [StructLayout(LayoutKind.Sequential)] struct Header {public IntPtr data;public uint length,recorded;public IntPtr user;public uint flags,loops;public IntPtr next,reserved;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Caps {public ushort mid,pid;public uint version;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string name;public uint formats;public ushort channels,reserved;public uint support;}
 [DllImport("winmm.dll")]static extern uint waveOutGetNumDevs();
 [DllImport("winmm.dll",CharSet=CharSet.Unicode,EntryPoint="waveOutGetDevCapsW")]static extern uint waveOutGetDevCaps(UIntPtr id,out Caps caps,uint size);
 [DllImport("winmm.dll")]static extern uint waveOutOpen(out IntPtr handle,uint device,ref Format format,IntPtr callback,IntPtr instance,uint flags);
 [DllImport("winmm.dll")]static extern uint waveOutPrepareHeader(IntPtr handle,IntPtr header,uint size);
 [DllImport("winmm.dll")]static extern uint waveOutWrite(IntPtr handle,IntPtr header,uint size);
 [DllImport("winmm.dll")]static extern uint waveOutReset(IntPtr handle);
 [DllImport("winmm.dll")]static extern uint waveOutUnprepareHeader(IntPtr handle,IntPtr header,uint size);
 [DllImport("winmm.dll")]static extern uint waveOutClose(IntPtr handle);
 static void Check(uint n){if(n!=0)throw new Exception("waveOut result="+n);}
 static void Main(string[] args){string dir=Path.GetFullPath(args[0]);const bool defaultExperiment=false;IntPtr wave=IntPtr.Zero,data=IntPtr.Zero,header=IntPtr.Zero;uint size=(uint)Marshal.SizeOf<Header>();
 try{
  File.WriteAllText(Path.Combine(dir,"process-ready.json"),System.Text.Json.JsonSerializer.Serialize(new{pid=Environment.ProcessId,no_audio_initialized=true,default_after_policy=defaultExperiment}));
  DateTime deadline=DateTime.UtcNow.AddSeconds(120);
  while(!File.Exists(Path.Combine(dir,"initialize"))&&!File.Exists(Path.Combine(dir,"stop"))&&DateTime.UtcNow<deadline)Thread.Sleep(50);
  if(File.Exists(Path.Combine(dir,"stop")))return;
  uint device=uint.MaxValue;var devices=new List<object>();
  int cableMatches=0;for(uint i=0;i<waveOutGetNumDevs();i++){Caps c;Check(waveOutGetDevCaps(new UIntPtr(i),out c,(uint)Marshal.SizeOf<Caps>()));devices.Add(new{id=i,name=c.name});if(c.name=="CABLE Input (VB-Audio Virtual C"){device=i;cableMatches++;}}
  // WinMM names truncate to31 chars. The controlling proof verifies the resulting exact endpoint session before requesting tone.
  if(!defaultExperiment && (device==uint.MaxValue||cableMatches!=1))throw new Exception("Unique cable waveOut name unavailable; refuse default fallback");
  File.WriteAllText(Path.Combine(dir,"devices.json"),System.Text.Json.JsonSerializer.Serialize(devices));
  var f=new Format{tag=1,channels=1,rate=48000,bytes=96000,align=2,bits=16};Check(waveOutOpen(out wave,defaultExperiment?uint.MaxValue:device,ref f,IntPtr.Zero,IntPtr.Zero,0));
  data=Marshal.AllocHGlobal(96000);header=Marshal.AllocHGlobal((int)size);
  void Submit(byte[] bytes){Marshal.Copy(bytes,0,data,bytes.Length);Marshal.StructureToPtr(new Header{data=data,length=96000,flags=12,loops=uint.MaxValue},header,false);Check(waveOutPrepareHeader(wave,header,size));Check(waveOutWrite(wave,header,size));}
  Marshal.Copy(new byte[96000],0,data,96000);Marshal.StructureToPtr(new Header{data=data,length=96000,flags=12,loops=uint.MaxValue},header,false);Check(waveOutPrepareHeader(wave,header,size));Check(waveOutWrite(wave,header,size));
  File.WriteAllText(Path.Combine(dir,"audio-ready"),"zero PCM");bool tone=false;
  while(!File.Exists(Path.Combine(dir,"stop"))&&DateTime.UtcNow<deadline){
   if(File.Exists(Path.Combine(dir,"reopen"))&&!File.Exists(Path.Combine(dir,"reopen-ready"))){Check(waveOutReset(wave));Check(waveOutUnprepareHeader(wave,header,size));Check(waveOutClose(wave));wave=IntPtr.Zero;Check(waveOutOpen(out wave,uint.MaxValue,ref f,IntPtr.Zero,IntPtr.Zero,0));Submit(new byte[96000]);File.WriteAllText(Path.Combine(dir,"reopen-ready"),"new default-after-policy zero PCM stream");}
   if(!tone&&File.Exists(Path.Combine(dir,"tone"))){Check(waveOutReset(wave));Check(waveOutUnprepareHeader(wave,header,size));var bytes=new byte[96000];for(int i=0;i<48000;i++){short v=(short)(8192*Math.Sin(2*Math.PI*440*i/48000));bytes[2*i]=(byte)v;bytes[2*i+1]=(byte)(v>>8);}Submit(bytes);File.WriteAllText(Path.Combine(dir,"tone-ready.json"),System.Text.Json.JsonSerializer.Serialize(new{sha256=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),peak=8192}));tone=true;}
   if(File.Exists(Path.Combine(dir,"zero"))&&!File.Exists(Path.Combine(dir,"zero-ready"))){Check(waveOutReset(wave));Check(waveOutUnprepareHeader(wave,header,size));Submit(new byte[96000]);File.WriteAllText(Path.Combine(dir,"zero-ready"),"zero PCM resubmitted");}
   Thread.Sleep(50);
  }
 }finally{if(wave!=IntPtr.Zero){Check(waveOutReset(wave));Check(waveOutUnprepareHeader(wave,header,size));Check(waveOutClose(wave));}if(header!=IntPtr.Zero)Marshal.FreeHGlobal(header);if(data!=IntPtr.Zero)Marshal.FreeHGlobal(data);}}
}
