"""Generate local build inputs and identities. No downloads or target operation."""
import argparse,hashlib,json,subprocess
from pathlib import Path
from xml.sax.saxutils import escape
PACKAGE=Path(__file__).resolve().parent
def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  while chunk:=f.read(65536):h.update(chunk)
 return h.hexdigest()
def prepare(workspace,mode,atl_include='',atl_library=''):
 root=Path(workspace).resolve();runtime=root/'runtime';runtime.mkdir();(runtime/'bin').mkdir();(root/'generated').mkdir()
 include=escape(atl_include);library=escape(atl_library)
 extra='PROTOINPUT_EARLY_XINPUT;' if mode=='early' else ''
 targets=f'''<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
 <PropertyGroup><IntDir>{escape(str(root/'obj'))}/$(MSBuildProjectName)/</IntDir></PropertyGroup>
 <ItemDefinitionGroup>
  <ClCompile><AdditionalIncludeDirectories>{include};%(AdditionalIncludeDirectories)</AdditionalIncludeDirectories></ClCompile>
  <Link><AdditionalLibraryDirectories>$(OutDir);{library};%(AdditionalLibraryDirectories)</AdditionalLibraryDirectories></Link>
  <Lib><AdditionalLibraryDirectories>$(OutDir);{library};%(AdditionalLibraryDirectories)</AdditionalLibraryDirectories></Lib>
 </ItemDefinitionGroup>
 <ItemDefinitionGroup Condition="'$(ProjectName)' == 'ProtoInputHooks'"><ClCompile><PreprocessorDefinitions>PROTOINPUT_HEADLESS;{extra}%(PreprocessorDefinitions)</PreprocessorDefinitions></ClCompile></ItemDefinitionGroup>
 <ItemDefinitionGroup Condition="'$(ProjectName)' == 'ProtoInputLoader'"><ClCompile><PreprocessorDefinitions>{extra}%(PreprocessorDefinitions)</PreprocessorDefinitions></ClCompile></ItemDefinitionGroup>
</Project>'''
 (root/'generated/build.targets').write_text(targets)
def pins(workspace):
 root=Path(workspace).resolve();header='#pragma once\n'
 for name,macro in [('Loader','PROTOINPUT_LOADER_SHA256'),('Hooks','PROTOINPUT_HOOKS_SHA256')]:header+=f'#define {macro} "{digest(root/f"runtime/bin/ProtoInput{name}64.dll")}"\n'
 (root/'generated/artifact_pins.h').write_text(header)
def finish(workspace,mode):
 root=Path(workspace).resolve();runtime=root/'runtime'
 names=['proto-controller.exe','desktop-launcher.exe','bin/ProtoInputLoader64.dll','bin/ProtoInputHooks64.dll','gamepad-fixture.exe']
 manifest={'version':1,'mode':mode,'sha256':{n:digest(runtime/n) for n in names},'upstream':json.loads((PACKAGE/'version.json').read_text()),'source_sha256':{str(p.relative_to(PACKAGE)).replace('\\','/'):digest(p) for p in PACKAGE.rglob('*') if p.is_file() and not any(part in ('local','__pycache__') for part in p.relative_to(PACKAGE).parts)}}
 with (runtime/'artifacts.json').open('x') as f:json.dump(manifest,f,indent=2)
 manifest['source_state']=subprocess.run(['git','diff','--stat'],cwd=root/'source',capture_output=True,text=True,check=True).stdout
 with (root/'build-receipt.json').open('x') as f:json.dump(manifest,f,indent=2)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('operation',choices=['prepare','pins','finish']);p.add_argument('--workspace',required=True);p.add_argument('--mode',choices=['ordinary','early'],default='ordinary');p.add_argument('--atl-include',default='');p.add_argument('--atl-library',default='');a=p.parse_args()
 if a.operation=='prepare':prepare(a.workspace,a.mode,a.atl_include,a.atl_library)
 elif a.operation=='pins':pins(a.workspace)
 else:finish(a.workspace,a.mode)
