// Derived from Microsoft ApplicationLoopback sample, commit 0b4e48a88ba446f3d87c5f7df12b33a74899a1e1.
// See LICENSE-Microsoft.txt. No renderer, routing mutations, or endpoint-wide loopback.
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl.h>
#include <atomic>
#include <thread>
#include <vector>
#include <string>
#include <iostream>
#include <stdexcept>
using namespace Microsoft::WRL;
void Check(HRESULT hr,const char* what){if(FAILED(hr))throw std::runtime_error(std::string(what)+" HRESULT="+std::to_string(static_cast<unsigned long>(hr)));}
void Require(bool b,const char* what){if(!b)throw std::runtime_error(what);}
class Activation final:public RuntimeClass<RuntimeClassFlags<ClassicCom>,FtmBase,IActivateAudioInterfaceCompletionHandler>{public:
 HANDLE complete=CreateEventW(nullptr,FALSE,FALSE,nullptr);HRESULT result=E_PENDING;ComPtr<IAudioClient> client;
 ~Activation(){if(complete)CloseHandle(complete);}
 STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* op){ComPtr<IUnknown> object;HRESULT activated=E_UNEXPECTED;result=op->GetActivateResult(&activated,&object);if(SUCCEEDED(result)){result=activated;if(SUCCEEDED(result))result=object.As(&client);}SetEvent(complete);return S_OK;}
};
struct Handles{HANDLE process=nullptr,event=nullptr,mainThread=nullptr;~Handles(){if(process)CloseHandle(process);if(event)CloseHandle(event);if(mainThread)CloseHandle(mainThread);}};
std::wstring Full(const wchar_t* p){wchar_t b[32768];DWORD n=GetFullPathNameW(p,32768,b,nullptr);Require(n&&n<32768,"Invalid expected executable path");return std::wstring(b,n);}
unsigned long long Number(const wchar_t* p){Require(p&&*p,"Missing integer");for(const wchar_t*c=p;*c;c++)Require(*c>=L'0'&&*c<=L'9',"Nondecimal integer");wchar_t* end=nullptr;errno=0;auto n=wcstoull(p,&end,10);Require(!errno&&end&&!*end,"Integer overflow");return n;}
void Identity(HANDLE p,DWORD pid,unsigned long long ticks,const std::wstring&exe){Require(GetProcessId(p)==pid&&WaitForSingleObject(p,0)==WAIT_TIMEOUT,"Target is no longer the held live process");FILETIME created,exit,kernel,user;Require(GetProcessTimes(p,&created,&exit,&kernel,&user)!=FALSE,"Target creation query failed");ULARGE_INTEGER t;t.LowPart=created.dwLowDateTime;t.HighPart=created.dwHighDateTime;Require(t.QuadPart+504911232000000000ULL==ticks,"Target creation identity mismatch");wchar_t b[32768];DWORD n=32768;Require(QueryFullProcessImageNameW(p,0,b,&n)&&CompareStringOrdinal(b,n,exe.c_str(),static_cast<int>(exe.size()),TRUE)==CSTR_EQUAL,"Target executable identity mismatch");}
int wmain(int argc,wchar_t**argv){Handles h;ComPtr<IAudioClient> client;bool started=false,initialized=false,cancelledPipe=false;std::atomic<bool>done=false;std::atomic<int>stop=0;std::thread watcher;int code=1;UINT64 bytesTotal=0;UINT32 records=0;
 try{
  Require(argc==5,"Usage: ProcessAudioStream.exe PID DOTNET_CREATION_TICKS EXACT_EXE MAX_SECONDS(1..120)");auto rawPid=Number(argv[1]);Require(rawPid&&rawPid<=MAXDWORD,"PID out of range");DWORD pid=static_cast<DWORD>(rawPid);auto ticks=Number(argv[2]);std::wstring exe=Full(argv[3]);auto seconds=Number(argv[4]);Require(seconds>=1&&seconds<=120,"Duration out of range");
  HANDLE output=GetStdHandle(STD_OUTPUT_HANDLE),input=GetStdHandle(STD_INPUT_HANDLE);Require(GetFileType(output)==FILE_TYPE_PIPE&&GetFileType(input)==FILE_TYPE_PIPE,"Inherited stdin/stdout pipes required");
  h.process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid);Require(h.process!=nullptr,"Cannot hold target process");Identity(h.process,pid,ticks,exe);h.event=CreateEventW(nullptr,FALSE,FALSE,nullptr);Require(h.event!=nullptr,"Capture event failed");Require(DuplicateHandle(GetCurrentProcess(),GetCurrentThread(),GetCurrentProcess(),&h.mainThread,THREAD_TERMINATE,FALSE,0)!=FALSE,"Main thread handle failed");
  ULONGLONG deadline=GetTickCount64()+seconds*1000;watcher=std::thread([&]{ULONGLONG stoppedAt=0;std::string command;while(!done){int reason=0;if(GetTickCount64()>=deadline)reason=3;else if(WaitForSingleObject(h.process,0)==WAIT_OBJECT_0)reason=4;DWORD available=0;if(!stop){if(!PeekNamedPipe(input,nullptr,0,nullptr,&available,nullptr)){DWORD e=GetLastError();reason=e==ERROR_BROKEN_PIPE?2:5;}else if(available){char b[64];DWORD n=0;if(!ReadFile(input,b,(std::min)(available,static_cast<DWORD>(sizeof(b))),&n,nullptr))reason=2;else{command.append(b,n);if(command=="stop\n"||command=="stop\r\n")reason=1;else if(command.size()>6||command.find('\n')!=std::string::npos)reason=5;}}}if(reason){int expected=0;stop.compare_exchange_strong(expected,reason);}if(stop){if(!stoppedAt)stoppedAt=GetTickCount64();SetEvent(h.event);CancelSynchronousIo(h.mainThread);if(GetTickCount64()-stoppedAt>2000){TerminateProcess(GetCurrentProcess(),75);return;}}Sleep(20);}});
  Check(CoInitializeEx(nullptr,COINIT_MULTITHREADED),"COM init");initialized=true;auto activation=Make<Activation>();Require(activation&&activation->complete,"Activation callback failed");
  AUDIOCLIENT_ACTIVATION_PARAMS params{};params.ActivationType=AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;params.ProcessLoopbackParams.ProcessLoopbackMode=PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;params.ProcessLoopbackParams.TargetProcessId=pid;
  PROPVARIANT prop{};prop.vt=VT_BLOB;prop.blob.cbSize=sizeof(params);prop.blob.pBlobData=reinterpret_cast<BYTE*>(&params);ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  Check(ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,__uuidof(IAudioClient),&prop,activation.Get(),&operation),"Process loopback activation");Require(WaitForSingleObject(activation->complete,5000)==WAIT_OBJECT_0,"Activation deadline");Check(activation->result,"Activation result");client=activation->client;Identity(h.process,pid,ticks,exe);
  WAVEFORMATEX format{};format.wFormatTag=WAVE_FORMAT_PCM;format.nChannels=2;format.nSamplesPerSec=44100;format.wBitsPerSample=16;format.nBlockAlign=4;format.nAvgBytesPerSec=176400;
  Check(client->Initialize(AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_LOOPBACK|AUDCLNT_STREAMFLAGS_EVENTCALLBACK|AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,0,0,&format,nullptr),"Capture initialize");Check(client->SetEventHandle(h.event),"Capture event");ComPtr<IAudioCaptureClient> capture;Check(client->GetService(IID_PPV_ARGS(&capture)),"Capture service");
  auto write=[&](const void* data,DWORD size){DWORD offset=0;while(offset<size){DWORD n=0;if(!WriteFile(output,static_cast<const BYTE*>(data)+offset,size-offset,&n,nullptr)||!n){DWORD error=GetLastError();cancelledPipe=stop&&(error==ERROR_OPERATION_ABORTED||error==ERROR_BROKEN_PIPE||error==ERROR_NO_DATA);throw std::runtime_error("Stdout pipe write failed Win32="+std::to_string(error));}offset+=n;}};
  // Six little-endian uint32 values, 24 bytes: magic NPCM, version, rate, channels, bits, block alignment.
  const DWORD header[]={0x4d43504e,1,44100,2,16,4};write(header,sizeof(header));Check(client->Start(),"Capture start");started=true;
  std::cerr<<"ready pid="<<pid<<" capture=target-process-tree format=s16le,44100,2 max_seconds="<<seconds<<"\n";
  while(!stop){Require(WaitForSingleObject(h.event,200)!=WAIT_FAILED,"Capture wait failed");if(stop)break;Identity(h.process,pid,ticks,exe);UINT32 frames=0;Check(capture->GetNextPacketSize(&frames),"Packet size");
   while(frames&&!stop){BYTE* data=nullptr;DWORD flags=0;UINT64 position=0,qpc=0;Check(capture->GetBuffer(&data,&frames,&flags,&position,&qpc),"Capture buffer");try{Require(frames>0&&frames<=16384,"PCM packet exceeds64KiB");DWORD count=frames*4;Require(bytesTotal+count<=seconds*176400+65536,"PCM lifetime byte cap exceeded");std::vector<BYTE>silent;if(flags&AUDCLNT_BUFFERFLAGS_SILENT){silent.assign(count,0);data=silent.data();}Require(data!=nullptr,"Non-silent PCM buffer missing");write(&count,sizeof(count));write(data,count);bytesTotal+=count;records++;}catch(...){capture->ReleaseBuffer(frames);throw;}Check(capture->ReleaseBuffer(frames),"Capture release");Check(capture->GetNextPacketSize(&frames),"Next packet");}
  }
  Check(client->Stop(),"Capture stop");started=false;DWORD end=0;write(&end,sizeof(end));code=stop==5?2:0;
 }catch(const std::exception&e){code=cancelledPipe&&stop!=5?0:1;std::cerr<<"capture_error="<<e.what()<<"\n";}
 if(started&&client)client->Stop();done=true;if(watcher.joinable())watcher.join();std::cerr<<"finished reason="<<stop.load()<<" bytes="<<bytesTotal<<" records="<<records<<" exit="<<code<<"\n";if(initialized)CoUninitialize();return code;
}
