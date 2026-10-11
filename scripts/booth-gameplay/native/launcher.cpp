// Fixed GUI supervisor. Creates only the sibling controller on an inactive Booth desktop.
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <filesystem>
#include <string>
#include <vector>
using namespace std;
static wstring name(HANDLE h){wchar_t b[512]{};DWORD n=0;return h&&GetUserObjectInformationW(h,UOI_NAME,b,sizeof(b),&n)?b:L"";}
static wstring quote(const wstring& value){wstring result=L"\"";unsigned slashes=0;for(wchar_t c:value){if(c==L'\\')slashes++;else {if(c==L'\"')result.append(slashes*2+1,L'\\');else result.append(slashes,L'\\');result+=c;slashes=0;}}result.append(slashes*2,L'\\');return result+L"\"";}
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int){
 int argc=0;wchar_t** argv=CommandLineToArgvW(GetCommandLineW(),&argc);wstring desktop;
 if(argc!=15){LocalFree(argv);return 1;}
 for(int i=1;i+1<argc;i+=2)if(wstring(argv[i])==L"--desktop")desktop=argv[i+1];
 if(desktop.size()>255||desktop.rfind(L"ws-booth-",0)!=0||desktop.find_first_of(L"\\/")!=wstring::npos){LocalFree(argv);return 1;}
 HDESK desired=OpenDesktopW(desktop.c_str(),0,FALSE,DESKTOP_READOBJECTS|DESKTOP_ENUMERATE);
 HDESK owner=OpenInputDesktop(0,FALSE,DESKTOP_READOBJECTS);
 bool inactive=desired&&owner&&name(desired)==desktop&&name(owner)!=desktop;
 if(desired)CloseDesktop(desired);if(owner)CloseDesktop(owner);if(!inactive){LocalFree(argv);return 1;}
 wchar_t self[32768]{};GetModuleFileNameW(nullptr,self,32768);
 wstring exe=(filesystem::path(self).parent_path()/L"proto-controller.exe").wstring();wstring command=quote(exe);
 for(int i=1;i<argc;i++){command+=L" ";command+=quote(argv[i]);}LocalFree(argv);if(command.size()>32760)return 1;
 HANDLE handles[3]{};DWORD ids[3]={STD_INPUT_HANDLE,STD_OUTPUT_HANDLE,STD_ERROR_HANDLE};
 for(unsigned i=0;i<3;i++){HANDLE h=GetStdHandle(ids[i]);if(!h||h==INVALID_HANDLE_VALUE||!DuplicateHandle(GetCurrentProcess(),h,GetCurrentProcess(),&handles[i],0,TRUE,DUPLICATE_SAME_ACCESS))return 6;}
 SIZE_T size=0;InitializeProcThreadAttributeList(nullptr,1,0,&size);vector<unsigned char> buffer(size);
 STARTUPINFOEXW startup{};startup.StartupInfo.cb=sizeof(startup);startup.lpAttributeList=(LPPROC_THREAD_ATTRIBUTE_LIST)buffer.data();
 bool initialized=InitializeProcThreadAttributeList(startup.lpAttributeList,1,0,&size)!=0;
 bool prepared=initialized&&UpdateProcThreadAttribute(startup.lpAttributeList,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handles,sizeof(handles),nullptr,nullptr)!=0;
 startup.StartupInfo.lpDesktop=desktop.data();startup.StartupInfo.dwFlags=STARTF_USESTDHANDLES;startup.StartupInfo.hStdInput=handles[0];startup.StartupInfo.hStdOutput=handles[1];startup.StartupInfo.hStdError=handles[2];
 PROCESS_INFORMATION child{};bool started=prepared&&CreateProcessW(exe.c_str(),command.data(),nullptr,nullptr,TRUE,EXTENDED_STARTUPINFO_PRESENT|CREATE_NO_WINDOW,nullptr,nullptr,&startup.StartupInfo,&child)!=0;
 if(initialized)DeleteProcThreadAttributeList(startup.lpAttributeList);for(auto h:handles)CloseHandle(h);
 if(!started)return 6;CloseHandle(child.hThread);
 // Own child only. No target kill, global input, desktop switching or console allocation.
 WaitForSingleObject(child.hProcess,INFINITE);DWORD status=6;GetExitCodeProcess(child.hProcess,&status);CloseHandle(child.hProcess);return (int)status;
}
