// Original silent fixture launcher. Never receives or loads game content.
#include <windows.h>
#include <shellapi.h>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>
namespace fs=std::filesystem;
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int) {
 int count=0;auto argv=CommandLineToArgvW(GetCommandLineW(),&count);
 std::wstring command;fs::path executable;
#ifdef FIXTURE_OUTER
 executable=fs::path(argv[0]).parent_path()/L"me3-launcher.exe";
 command=L"\""+executable.wstring()+L"\"";
 for(int i=1;i<count;i++)command+=L" \""+std::wstring(argv[i])+L"\"";
#else
 fs::path profile;
 for(int i=1;i+1<count;i++){if(std::wstring(argv[i])==L"--exe")executable=argv[i+1];if(std::wstring(argv[i])==L"--profile")profile=argv[i+1];}
 if(executable.filename()!=L"eldenring.exe"||profile.empty())return 2;
 std::wifstream stream(profile);std::wstring output,dlls;std::getline(stream,output);std::getline(stream,dlls);
 if(!stream||!fs::is_directory(output)||!fs::is_directory(dlls))return 3;
 command=L"\""+executable.wstring()+L"\" target \""+output+L"\" \""+dlls+L"\"";
#endif
 LocalFree(argv);STARTUPINFOW startup{};startup.cb=sizeof(startup);PROCESS_INFORMATION process{};
 std::vector<wchar_t> writable(command.begin(),command.end());writable.push_back(0);
 if(!CreateProcessW(executable.c_str(),writable.data(),nullptr,nullptr,FALSE,0,nullptr,nullptr,&startup,&process))return 4;
 CloseHandle(process.hThread);DWORD waited=WaitForSingleObject(process.hProcess,65000),result=5;
 if(waited==WAIT_OBJECT_0)GetExitCodeProcess(process.hProcess,&result);CloseHandle(process.hProcess);return static_cast<int>(result);
}

#ifdef FIXTURE_OUTER
int wmain(){return wWinMain(GetModuleHandleW(nullptr),nullptr,nullptr,0);}
#endif
