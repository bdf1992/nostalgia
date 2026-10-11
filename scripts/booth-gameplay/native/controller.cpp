// Persistent, headless controller. Acts only through pinned ProtoInput C APIs.
#define NOMINMAX
#include <windows.h>
#include "artifact_pins.h"
#include <bcrypt.h>
#include <shellapi.h>
#include <io.h>
#include <fcntl.h>
#include <cstdio>
#include <filesystem>
#include <string>
#include <sstream>
#include <map>
#include <vector>
#include <limits>
using namespace std;
namespace fs=std::filesystem;
static HANDLE channel=nullptr,input=nullptr,held=nullptr;
static DWORD targetPid=0,creationHigh=0,creationLow=0;
static HWND targetWindow=nullptr;
static wstring targetExe,expectedDesktop;
static unsigned sequence=0;
static bool output(unsigned op,bool ok,unsigned code){
 string s="{\"seq\":"+to_string(sequence++)+",\"op\":"+to_string(op)+",\"ok\":"+(ok?"true":"false")+",\"code\":"+to_string(code)+",\"pid\":"+to_string(targetPid)+",\"hwnd\":"+to_string((uintptr_t)targetWindow)+"}\n";
 DWORD written=0;return WriteFile(channel,s.data(),(DWORD)s.size(),&written,nullptr)&&written==s.size();
}
static bool number(const wstring& s,unsigned long long& out){
 if(s.empty()||s.size()>20)return false;out=0;
 for(wchar_t c:s){if(c<L'0'||c>L'9'||out>(numeric_limits<unsigned long long>::max()-(c-L'0'))/10)return false;out=out*10+c-L'0';}return true;
}
static wstring objectName(HANDLE h){wchar_t value[512]{};DWORD needed=0;if(!h||!GetUserObjectInformationW(h,UOI_NAME,value,sizeof(value),&needed))return L"";return value;}
static wstring canonical(wstring s){if(s.rfind(L"\\\\?\\",0)==0)s=s.substr(4);for(auto& c:s)if(c==L'/')c=L'\\';return s;}
static bool equalPath(const wstring& a,const wstring& b){return _wcsicmp(canonical(a).c_str(),canonical(b).c_str())==0;}
static bool identityFailure(unsigned stage){string note="identity_stage="+to_string(stage)+" error="+to_string(GetLastError())+"\n";DWORD written=0;WriteFile(GetStdHandle(STD_ERROR_HANDLE),note.data(),(DWORD)note.size(),&written,nullptr);return false;}
static BOOL CALLBACK membership(HWND hwnd,LPARAM found){
 if(hwnd==targetWindow){DWORD pid=0;GetWindowThreadProcessId(hwnd,&pid);if(pid==targetPid)*reinterpret_cast<bool*>(found)=true;}
 return TRUE;
}
static bool identity(){
 if(!held||WaitForSingleObject(held,0)!=WAIT_TIMEOUT)return identityFailure(101);
 FILETIME c,e,k,u;if(!GetProcessTimes(held,&c,&e,&k,&u)||c.dwHighDateTime!=creationHigh||c.dwLowDateTime!=creationLow)return identityFailure(102);
 wchar_t exe[32768]{};DWORD size=32768;if(!QueryFullProcessImageNameW(held,0,exe,&size)||!equalPath(exe,targetExe))return identityFailure(103);
 HDESK named=OpenDesktopW(expectedDesktop.c_str(),0,FALSE,DESKTOP_READOBJECTS|DESKTOP_ENUMERATE);
 if(!named)return identityFailure(104);
 bool found=false;bool listed=EnumDesktopWindows(named,membership,(LPARAM)&found)!=0;CloseDesktop(named);
 if(!listed||!found)return identityFailure(105);
 HANDLE ownerDesktop=OpenInputDesktop(0,FALSE,DESKTOP_READOBJECTS);if(!ownerDesktop)return identityFailure(106);
 wstring owner=objectName(ownerDesktop);CloseDesktop((HDESK)ownerDesktop);
 return !owner.empty() && _wcsicmp(owner.c_str(),expectedDesktop.c_str())!=0 && _wcsicmp(expectedDesktop.c_str(),L"Default")!=0 && expectedDesktop.rfind(L"ws-booth-",0)==0;
}
static HANDLE pinned(const fs::path& file,const string& expected){
 HANDLE f=CreateFileW(file.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);if(f==INVALID_HANDLE_VALUE)return nullptr;
 BY_HANDLE_FILE_INFORMATION info{};wchar_t actual[32768]{};
 if(!GetFileInformationByHandle(f,&info)||(info.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY))||info.nFileSizeHigh||info.nFileSizeLow>16*1024*1024||!GetFinalPathNameByHandleW(f,actual,32768,FILE_NAME_NORMALIZED)||!equalPath(actual,file.wstring())){CloseHandle(f);return nullptr;}
 BCRYPT_ALG_HANDLE alg=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;DWORD n=0,objectBytes=0;vector<unsigned char> object,digest(32);bool ok=false;
 if(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,nullptr,0)==0 && BCryptGetProperty(alg,BCRYPT_OBJECT_LENGTH,(PUCHAR)&objectBytes,sizeof(objectBytes),&n,0)==0){
 object.resize(objectBytes);
 if(BCryptCreateHash(alg,&hash,object.data(),objectBytes,nullptr,0,0)==0){unsigned char buffer[65536];DWORD read=0;ok=true;
 while(ReadFile(f,buffer,sizeof(buffer),&read,nullptr)&&read){if(BCryptHashData(hash,buffer,read,0)!=0){ok=false;break;}}
 if(ok&&BCryptFinishHash(hash,digest.data(),32,0)!=0)ok=false;
 }}
 if(hash)BCryptDestroyHash(hash);if(alg)BCryptCloseAlgorithmProvider(alg,0);
 string result;const char* digits="0123456789abcdef";for(auto b:digest){result+=digits[b>>4];result+=digits[b&15];}
 if(!ok||result!=expected){CloseHandle(f);return nullptr;}return f;
}
static bool redirectDiagnostics(){
 // Preserve inherited JSON channel; only upstream CRT diagnostics go to stderr.
 HANDLE original=GetStdHandle(STD_OUTPUT_HANDLE),err=GetStdHandle(STD_ERROR_HANDLE),copy=nullptr;
 if(!original||original==INVALID_HANDLE_VALUE||!err||err==INVALID_HANDLE_VALUE)return false;
 if(!DuplicateHandle(GetCurrentProcess(),original,GetCurrentProcess(),&channel,0,FALSE,DUPLICATE_SAME_ACCESS))return false;
 if(!DuplicateHandle(GetCurrentProcess(),err,GetCurrentProcess(),&copy,0,FALSE,DUPLICATE_SAME_ACCESS))return false;
 int fd=_open_osfhandle((intptr_t)copy,_O_TEXT);if(fd<0){CloseHandle(copy);return false;}
 FILE* stream=nullptr;bool ok=freopen_s(&stream,"NUL","w",stdout)==0 && _dup2(fd,_fileno(stdout))==0;
 _close(fd);SetStdHandle(STD_OUTPUT_HANDLE,err);return ok;
}
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int){
 input=GetStdHandle(STD_INPUT_HANDLE);if(!redirectDiagnostics())return 6;
 int argc=0;wchar_t** argv=CommandLineToArgvW(GetCommandLineW(),&argc);map<wstring,wstring> args;bool valid=argc==15;
 for(int i=1;valid&&i<argc;i+=2){if(args.count(argv[i]))valid=false;else args[argv[i]]=argv[i+1];}LocalFree(argv);
 for(auto name:{L"--pid",L"--created-high",L"--created-low",L"--exe",L"--hwnd",L"--desktop",L"--dll-dir"})if(!args.count(name))valid=false;
 unsigned long long pid=0,hi=0,lo=0,hwnd=0;
 valid=valid&&number(args[L"--pid"],pid)&&pid>0&&pid<=MAXDWORD&&number(args[L"--created-high"],hi)&&hi<=MAXDWORD&&number(args[L"--created-low"],lo)&&lo<=MAXDWORD&&number(args[L"--hwnd"],hwnd)&&hwnd>0;
 if(!valid){output(0,false,1);return 1;}
 targetPid=(DWORD)pid;creationHigh=(DWORD)hi;creationLow=(DWORD)lo;targetWindow=(HWND)(uintptr_t)hwnd;targetExe=args[L"--exe"];expectedDesktop=args[L"--desktop"];
 fs::path directory=args[L"--dll-dir"];
 if(!fs::path(targetExe).is_absolute()||!directory.is_absolute()||expectedDesktop.size()>255){output(0,false,1);return 1;}
 held=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,targetPid);
 if(!identity()){output(0,false,1);if(held)CloseHandle(held);return 1;}
 HANDLE loaderFile=pinned(directory/L"ProtoInputLoader64.dll",PROTOINPUT_LOADER_SHA256);
 HANDLE hooksFile=pinned(directory/L"ProtoInputHooks64.dll",PROTOINPUT_HOOKS_SHA256);
 if(!loaderFile||!hooksFile){output(0,false,2);return 2;}
 HMODULE loader=LoadLibraryExW((directory/L"ProtoInputLoader64.dll").c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);if(!loader){output(0,false,2);return 2;}
 #define API(type,name) auto name=reinterpret_cast<type>(GetProcAddress(loader,#name));if(!name){output(0,false,2);return 2;}
 API(unsigned(*)(unsigned long,const wchar_t*),RemoteLoadLibraryInjectRuntime)
 API(void(*)(unsigned,int),SetupState)
 API(void(*)(unsigned,uint64_t),UpdateMainWindowHandle)
 API(void(*)(unsigned,bool,bool,bool,bool),SetupMessagesToSend)
 API(void(*)(unsigned,unsigned),InstallHook)
 API(void(*)(unsigned,unsigned),DisableMessageFilter)
 API(void(*)(unsigned,int,bool,bool,bool,bool,bool),StartFocusMessageLoop)
 API(void(*)(unsigned),StopFocusMessageLoop)
 API(bool(*)(unsigned,bool),SetSyntheticGamepadEnabled)
 API(bool(*)(unsigned,bool,unsigned short,unsigned char,unsigned char,short,short,short,short,unsigned),SendSyntheticGamepadState)
 API(bool(*)(unsigned,bool),SetSyntheticKeyboardEnabled)
 API(bool(*)(unsigned,unsigned short,unsigned short,unsigned short,unsigned),SendSyntheticKeyboardEvent)
 if(!identity()){output(0,false,4);return 4;}
 wstring dllDir=directory.wstring()+L"\\";unsigned handle=RemoteLoadLibraryInjectRuntime(targetPid,dllDir.c_str());if(!handle){output(0,false,5);return 5;}
 SetupState(handle,1);UpdateMainWindowHandle(handle,(uint64_t)(uintptr_t)targetWindow);SetupMessagesToSend(handle,false,false,false,true);DisableMessageFilter(handle,7);
 for(unsigned id:{5u,6u,7u,10u})InstallHook(handle,id);
 StartFocusMessageLoop(handle,50,true,true,true,true,true);
 auto cleanup=[&](){bool keyboardOk=SetSyntheticKeyboardEnabled(handle,false);bool padOk=SetSyntheticGamepadEnabled(handle,false);StopFocusMessageLoop(handle);return keyboardOk&&padOk;};
 if(!identity()){cleanup();output(0,false,4);return 4;}
 if(!output(0,true,0)){cleanup();return 6;}
 string line;unsigned operation=0;bool eof=false;
 while(true){
  char c=0;DWORD n=0;if(!ReadFile(input,&c,1,&n,nullptr)||n==0){eof=true;break;}
  if(c=='\n'){
   if(!line.empty()&&line.back()=='\r')line.pop_back();
   operation=line=="enable"?1:line=="disable"?3:line=="close"?4:line.rfind("key ",0)==0?2:line=="gamepad_enable"?5:line=="gamepad_disable"?7:line.rfind("gamepad ",0)==0?6:9;
   if(!identity()){cleanup();output(operation,false,4);break;}
   bool ok=false;unsigned code=0;
   if(operation==1)ok=SetSyntheticKeyboardEnabled(handle,true);
   else if(operation==3)ok=SetSyntheticKeyboardEnabled(handle,false);
   else if(operation==5){ok=SetSyntheticGamepadEnabled(handle,true);if(ok)InstallHook(handle,12);}
   else if(operation==7)ok=SetSyntheticGamepadEnabled(handle,false);
   else if(operation==6){
    istringstream request(line.substr(8));long long connected=0,buttons=0,lt=0,rt=0,lx=0,ly=0,rx=0,ry=0,lease=0;string extra;
    if(!(request>>connected>>buttons>>lt>>rt>>lx>>ly>>rx>>ry>>lease)||(request>>extra)||connected<0||connected>1||buttons<0||buttons>65535||lt<0||lt>255||rt<0||rt>255||lx<-32768||lx>32767||ly<-32768||ly>32767||rx<-32768||rx>32767||ry<-32768||ry>32767||lease<0||lease>2000)code=3;
    else ok=SendSyntheticGamepadState(handle,connected!=0,(unsigned short)buttons,(unsigned char)lt,(unsigned char)rt,(short)lx,(short)ly,(short)rx,(short)ry,(unsigned)lease);
   }
   else if(operation==4){ok=cleanup();output(4,ok,ok?0:8);break;}
   else if(operation==2){
    istringstream request(line.substr(4));string a,b,d,e,extra;unsigned long long vk=0,scan=0,flags=0,lease=0;
    if(!(request>>a>>b>>d>>e)||(request>>extra)||!number(wstring(a.begin(),a.end()),vk)||!number(wstring(b.begin(),b.end()),scan)||!number(wstring(d.begin(),d.end()),flags)||!number(wstring(e.begin(),e.end()),lease)||vk>254||scan>255||flags>7||lease>2000){code=3;}
    else ok=SendSyntheticKeyboardEvent(handle,(unsigned short)vk,(unsigned short)scan,(unsigned short)flags,(unsigned)lease);
   }else code=3;
   if(!ok&&!code)code=5;
   if(!output(operation,ok,code)){cleanup();break;}line.clear();
  }else{
   if(c==0||static_cast<unsigned char>(c)>127||line.size()>=4096){cleanup();output(9,false,7);break;}
   line+=c;
  }
 }
 if(eof){bool ok=cleanup();output(4,ok,ok?0:8);}
 CloseHandle(loaderFile);CloseHandle(hooksFile);CloseHandle(held);CloseHandle(channel);
 // Process-lifetime library: never FreeLibrary while its owned stock threads exist.
 return 0;
}
