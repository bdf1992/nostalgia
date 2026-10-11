#include <windows.h>
#include <Xinput.h>
#include <shellapi.h>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>
using namespace std;namespace fs=std::filesystem;
LRESULT CALLBACK procedure(HWND w,UINT m,WPARAM p,LPARAM l){return DefWindowProcW(w,m,p,l);}
struct Api {
 string name;
 DWORD(WINAPI* state)(DWORD,XINPUT_STATE*);
 DWORD(WINAPI* extended)(DWORD,XINPUT_STATE*);
 DWORD(WINAPI* caps)(DWORD,DWORD,XINPUT_CAPABILITIES*);
 DWORD(WINAPI* rumble)(DWORD,XINPUT_VIBRATION*);
};
struct Guard {XINPUT_STATE state;DWORD after[4];};
static_assert(sizeof(XINPUT_STATE)==16,"Pinned state ABI");
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR,int){
 int argc=0;wchar_t** args=CommandLineToArgvW(GetCommandLineW(),&argc);
#ifdef EARLY_FIXTURE
 if(argc!=4||wstring(args[1])!=L"target")return 2;fs::path out=args[2],earlyDirectory=args[3];LocalFree(args);
 HMODULE earlyHooks=LoadLibraryExW((earlyDirectory/L"ProtoInputHooks64.dll").c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);if(!earlyHooks)return 10;
 auto initialize=(bool(*)())GetProcAddress(earlyHooks,"NostalgiaEarlyXInputInitialize");auto earlyData=(volatile LONG64*)GetProcAddress(earlyHooks,"NostalgiaEarlyXInputStatus");if(!initialize||!earlyData)return 11;
 bool initialized=initialize();LONG64 beforeMain[10]{};for(unsigned i=0;i<10;i++)beforeMain[i]=InterlockedCompareExchange64(earlyData+i,0,0);
 HMODULE firstXinput=LoadLibraryW(L"xinput1_4.dll");auto firstState=(DWORD(WINAPI*)(DWORD,XINPUT_STATE*))GetProcAddress(firstXinput,"XInputGetState");if(!firstState)return 12;
 XINPUT_STATE first{};DWORD firstResult=firstState(0,&first);
 {ofstream earlyReceipt(out/L"early-startup.json");earlyReceipt<<"{\"initialized\":"<<(initialized?"true":"false")<<",\"status\":"<<firstResult<<",\"buttons\":"<<first.Gamepad.wButtons<<",\"leftTrigger\":"<<(unsigned)first.Gamepad.bLeftTrigger<<",\"rightTrigger\":"<<(unsigned)first.Gamepad.bRightTrigger<<",\"leftX\":"<<first.Gamepad.sThumbLX<<",\"leftY\":"<<first.Gamepad.sThumbLY<<",\"rightX\":"<<first.Gamepad.sThumbRX<<",\"rightY\":"<<first.Gamepad.sThumbRY<<",\"earlyFields\":[";for(unsigned i=0;i<10;i++){if(i)earlyReceipt<<",";earlyReceipt<<beforeMain[i];}earlyReceipt<<"]}\n";}
 if(!initialized||firstResult!=0)return 13;
 ofstream(out/L"main-equivalent-began.txt")<<GetTickCount64()<<"\n";
 #else
 if(argc!=3||wstring(args[1])!=L"target")return 2;fs::path out=args[2];LocalFree(args);
 #endif
 WNDCLASSW wc{};wc.hInstance=instance;wc.lpszClassName=L"NostalgiaOriginalGamepadFixture";wc.lpfnWndProc=procedure;RegisterClassW(&wc);
 HWND hwnd=CreateWindowW(wc.lpszClassName,L"Original XInput Fixture",WS_OVERLAPPEDWINDOW,0,0,300,160,nullptr,nullptr,instance,nullptr);if(!hwnd)return 3;ShowWindow(hwnd,SW_SHOWNOACTIVATE);
 wchar_t desktop[256]{};DWORD needed=0;GetUserObjectInformationW(GetThreadDesktop(GetCurrentThreadId()),UOI_NAME,desktop,sizeof(desktop),&needed);
 {wofstream meta(out/L"target-meta.txt");meta<<GetCurrentProcessId()<<L" "<<(uintptr_t)hwnd<<L" "<<desktop<<endl;}
 vector<Api> apis;
 for(const wchar_t* name:{L"xinput1_4.dll",L"xinput1_3.dll"}){
  HMODULE module=LoadLibraryW(name);if(!module)return 4;
  Api a{};a.name=wstring(name)==L"xinput1_4.dll"?"1_4":"1_3";
  a.state=(decltype(a.state))GetProcAddress(module,"XInputGetState");a.extended=(decltype(a.extended))GetProcAddress(module,(LPCSTR)100);a.caps=(decltype(a.caps))GetProcAddress(module,"XInputGetCapabilities");a.rumble=(decltype(a.rumble))GetProcAddress(module,"XInputSetState");
  if(!a.state||!a.extended||!a.caps||!a.rumble)return 5;apis.push_back(a);
 }
 ofstream samples(out/L"gamepad.csv");samples<<"tick,dll,status,packet,buttons,lt,rt,lx,ly,rx,ry,exstatus,expacket,exbuttons,statecanary,excanary,slot1,slot2,slot3,capsstatus,capsflags,capsbuttons,vibrationstatus,badflags,nullstate,nullcap,nullvibration,any,invalidslot,slot1rumble,nullex,exequal,capsvalid,capsflag1,statebegin,stateend,foreground,diagready,diagtotal,diagex,diagsuccess,diagnonzero,diagbuttons,diagpacket,diagcaps,diagfocus,diaglastfocus,diaggen\n";
 ULONGLONG start=GetTickCount64(),done=0;
 while(GetTickCount64()-start<20000){
  MSG msg;while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageW(&msg);}
  for(const auto& a:apis){
   Guard regular{},extended{};for(auto& v:regular.after)v=0xA55AA55A;for(auto& v:extended.after)v=0xA55AA55A;
   ULONGLONG stateBegin=GetTickCount64();DWORD status=a.state(0,&regular.state);ULONGLONG stateEnd=GetTickCount64();DWORD exstatus=a.extended(0,&extended.state);
   bool valid=true,exvalid=true;for(auto v:regular.after)valid&=v==0xA55AA55A;for(auto v:extended.after)exvalid&=v==0xA55AA55A;
   XINPUT_STATE scratch{};DWORD slot1=a.state(1,&scratch),slot2=a.state(2,&scratch),slot3=a.state(3,&scratch);
   XINPUT_CAPABILITIES cap{};DWORD caps=a.caps(0,0,&cap);
   bool capsvalid=caps==0&&cap.Type==XINPUT_DEVTYPE_GAMEPAD&&cap.SubType==XINPUT_DEVSUBTYPE_GAMEPAD&&cap.Flags==0&&cap.Gamepad.wButtons==0xF3FF&&cap.Gamepad.bLeftTrigger==255&&cap.Gamepad.bRightTrigger==255&&cap.Gamepad.sThumbLX==32767&&cap.Gamepad.sThumbLY==32767&&cap.Gamepad.sThumbRX==32767&&cap.Gamepad.sThumbRY==32767&&!cap.Vibration.wLeftMotorSpeed&&!cap.Vibration.wRightMotorSpeed;
   XINPUT_CAPABILITIES capFlag{};DWORD flagStatus=a.caps(0,XINPUT_FLAG_GAMEPAD,&capFlag);bool flagValid=flagStatus==0&&memcmp(&cap,&capFlag,sizeof(cap))==0;XINPUT_VIBRATION vibration{30000,30000};DWORD rumble=a.rumble(0,&vibration);
   XINPUT_CAPABILITIES invalidCap{};DWORD badflags=a.caps(0,2,&invalidCap),nullstate=a.state(0,nullptr),nullcap=a.caps(0,0,nullptr),nullrumble=a.rumble(0,nullptr);
   DWORD any=a.state(XUSER_INDEX_ANY,&scratch),invalidslot=a.state(4,&scratch),slotrumble=a.rumble(1,&vibration),nullex=a.extended(0,nullptr);
   HWND foreground=GetForegroundWindow();
   LONG64 diagnostic[12]{};bool diagnosticReady=false;
   HMODULE hooks=GetModuleHandleW(L"ProtoInputHooks64.dll");
   if(hooks){auto data=(volatile LONG64*)GetProcAddress(hooks,"NostalgiaInputDiagnosticData");
    if(data && ((uintptr_t)data%8)==0){
     for(unsigned attempt=0;attempt<4;attempt++){
      LONG64 before=InterlockedCompareExchange64(data+11,0,0);if(before&1)continue;
      for(unsigned j=0;j<12;j++)diagnostic[j]=InterlockedCompareExchange64(data+j,0,0);
      LONG64 after=InterlockedCompareExchange64(data+11,0,0);
      if(before==after&&!(after&1)&&diagnostic[0]==1&&diagnostic[1]==96){diagnosticReady=true;break;}
     }
    }
   }
   const auto& g=regular.state.Gamepad;
   samples<<GetTickCount64()<<","<<a.name<<","<<status<<","<<regular.state.dwPacketNumber<<","<<g.wButtons<<","<<(unsigned)g.bLeftTrigger<<","<<(unsigned)g.bRightTrigger<<","<<g.sThumbLX<<","<<g.sThumbLY<<","<<g.sThumbRX<<","<<g.sThumbRY<<","<<exstatus<<","<<extended.state.dwPacketNumber<<","<<extended.state.Gamepad.wButtons<<","<<valid<<","<<exvalid<<","<<slot1<<","<<slot2<<","<<slot3<<","<<caps<<","<<cap.Flags<<","<<cap.Gamepad.wButtons<<","<<rumble<<","<<badflags<<","<<nullstate<<","<<nullcap<<","<<nullrumble<<","<<any<<","<<invalidslot<<","<<slotrumble<<","<<nullex<<","<<(memcmp(&regular.state,&extended.state,sizeof(XINPUT_STATE))==0)<<","<<capsvalid<<","<<flagValid<<","<<stateBegin<<","<<stateEnd<<","<<(uintptr_t)foreground<<","<<diagnosticReady<<","<<diagnostic[2]<<","<<diagnostic[3]<<","<<diagnostic[4]<<","<<diagnostic[5]<<","<<diagnostic[6]<<","<<diagnostic[7]<<","<<diagnostic[8]<<","<<diagnostic[9]<<","<<diagnostic[10]<<","<<diagnostic[11]<<"\n";
  }
  samples.flush();
  if(fs::exists(out/L"host-done.txt")){if(!done)done=GetTickCount64();if(GetTickCount64()-done>1500)break;}
  Sleep(5);
 }
 #ifdef EARLY_FIXTURE
 {ofstream final(out/L"early-final.json");final<<"[";for(unsigned i=0;i<10;i++){if(i)final<<",";final<<InterlockedCompareExchange64(earlyData+i,0,0);}final<<"]\n";}
 #endif
 DestroyWindow(hwnd);ofstream(out/L"target-done.txt")<<GetCurrentProcessId()<<"\n";return 0;
}
