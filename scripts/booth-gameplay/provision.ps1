param(
 [Parameter(Mandatory)][string]$Workspace,
 [Parameter(Mandatory)][string]$VSInstall,
 [Parameter(Mandatory)][string]$WindowsSdkVersion,
 [ValidateSet('ordinary','early')][string]$Mode='early',
 [string]$AtlInclude='', [string]$AtlLibrary='', [string]$Python='python'
)
$ErrorActionPreference='Stop'
$packageRoot=$PSScriptRoot
if (-not [IO.Path]::IsPathRooted($Workspace)) { throw 'Workspace must be an absolute, absent directory' }
$buildRoot=[IO.Path]::GetFullPath($Workspace)
foreach ($commandPath in @($buildRoot,$VSInstall,$packageRoot)) { if ($commandPath -match '[%&|<>^"\r\n]') { throw 'Build paths contain unsupported command characters' } }
if (Test-Path -LiteralPath $buildRoot) { throw 'Build workspace exists; use a fresh directory' }
if ($WindowsSdkVersion -notmatch '^10\.0\.\d+\.\d+$') { throw 'Exact installed Windows SDK version required' }
$msbuild=Join-Path $VSInstall 'MSBuild/Current/Bin/MSBuild.exe'
$vcvars=Join-Path $VSInstall 'VC/Auxiliary/Build/vcvars64.bat'
if (-not (Test-Path -LiteralPath $msbuild) -or -not (Test-Path -LiteralPath $vcvars)) { throw 'VS2022 C++ build tools required' }
if (($AtlInclude -eq '') -ne ($AtlLibrary -eq '')) { throw 'Supply both private ATL paths or neither' }
foreach ($atlPath in @($AtlInclude,$AtlLibrary)) { if ($atlPath -ne '' -and -not (Test-Path -LiteralPath $atlPath)) { throw 'ATL path unavailable' } }
$version=Get-Content -LiteralPath (Join-Path $packageRoot 'version.json') -Raw | ConvertFrom-Json
$patch=Join-Path $packageRoot 'patches/protoinput-v1.patch'
if ((Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash.ToLowerInvariant() -ne $version.patch_sha256) { throw 'Source patch identity mismatch' }
New-Item -ItemType Directory -Path $buildRoot | Out-Null
git clone --no-checkout $version.upstream (Join-Path $buildRoot 'source')
if ($LASTEXITCODE -ne 0) { throw 'Official source clone failed' }
git -C (Join-Path $buildRoot 'source') checkout --detach $version.commit
if ($LASTEXITCODE -ne 0) { throw 'Pinned upstream checkout failed' }
git -C (Join-Path $buildRoot 'source') apply --check $patch
if ($LASTEXITCODE -ne 0) { throw 'Patch does not apply to pinned source' }
git -C (Join-Path $buildRoot 'source') apply $patch
if ($LASTEXITCODE -ne 0) { throw 'Patch application failed' }
$prepareArgs=@('prepare','--workspace',$buildRoot,'--mode',$Mode)
if ($AtlInclude -ne '') { $prepareArgs+=@('--atl-include',$AtlInclude,'--atl-library',$AtlLibrary) }
& $Python (Join-Path $packageRoot 'build_support.py') @prepareArgs
if ($LASTEXITCODE -ne 0) { throw 'Local build inputs failed' }
& $msbuild (Join-Path $buildRoot 'source/src/ProtoInput/ProtoInput.sln') /t:ProtoInputLoader,ProtoInputHooks /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143 "/p:WindowsTargetPlatformVersion=$WindowsSdkVersion" "/p:OutDir=$buildRoot/runtime/bin/" "/p:ForceImportAfterCppTargets=$buildRoot/generated/build.targets" /m:2 /v:quiet /fl "/flp:logfile=$buildRoot/build.log;verbosity=normal"
if ($LASTEXITCODE -ne 0) { throw 'Normal source build failed; retain diagnostics and host security state' }
& $Python (Join-Path $packageRoot 'build_support.py') pins --workspace $buildRoot
if ($LASTEXITCODE -ne 0) { throw 'Local DLL pin generation failed' }
# vcvars supplies this process-only compiler environment. No user/global changes.
$compile=Join-Path $buildRoot 'generated/compile.cmd'
$earlyFixture=if ($Mode -eq 'early') { '/D EARLY_FIXTURE' } else { '' }
@"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b %ERRORLEVEL%
cd /d "$buildRoot/generated"
cl /nologo /std:c++17 /EHsc /O2 /W4 /I "$buildRoot/generated" "$packageRoot/native/controller.cpp" /Fe:"$buildRoot/runtime/proto-controller.exe" user32.lib shell32.lib bcrypt.lib /link /SUBSYSTEM:WINDOWS >"$buildRoot/helpers-build.log" 2>&1
if errorlevel 1 exit /b %ERRORLEVEL%
cl /nologo /std:c++17 /EHsc /O2 /W4 "$packageRoot/native/launcher.cpp" /Fe:"$buildRoot/runtime/desktop-launcher.exe" user32.lib shell32.lib /link /SUBSYSTEM:WINDOWS >>"$buildRoot/helpers-build.log" 2>&1
if errorlevel 1 exit /b %ERRORLEVEL%
cl /nologo /std:c++17 /EHsc /O2 /W4 $earlyFixture "$packageRoot/fixtures/gamepad.cpp" /Fe:"$buildRoot/runtime/gamepad-fixture.exe" user32.lib shell32.lib /link /SUBSYSTEM:WINDOWS >>"$buildRoot/helpers-build.log" 2>&1
exit /b %ERRORLEVEL%
"@ | Set-Content -LiteralPath $compile
& $compile
if ($LASTEXITCODE -ne 0) { throw 'Authored helper build failed' }
& $Python (Join-Path $packageRoot 'build_support.py') finish --workspace $buildRoot --mode $Mode
if ($LASTEXITCODE -ne 0) { throw 'Local artifact receipt failed' }
Write-Output "Built $Mode runtime at $buildRoot/runtime. Run the authored fixture before target admission."
