#requires -Version 7.0
param([Parameter(Mandatory)][string]$MsBuildPath,[string]$OutputRoot)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$state=[IO.Path]::GetFullPath((Join-Path $repo 'state'))
if(-not $OutputRoot){$OutputRoot=Join-Path $state ('booth-audio/'+[guid]::NewGuid())}
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
if(-not $OutputRoot.StartsWith($state+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Build output must be an isolated child of repository state'}
if(Test-Path -LiteralPath $OutputRoot){throw 'Refuse existing build output'}
$ancestor=[IO.Directory]::GetParent($OutputRoot)
while($ancestor){if(Test-Path -LiteralPath $ancestor.FullName){$item=Get-Item -LiteralPath $ancestor.FullName -Force;if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Unsafe build ancestor'}};$ancestor=$ancestor.Parent}
$MsBuildPath=(Resolve-Path -LiteralPath $MsBuildPath).Path
$pins=Get-Content (Join-Path $PSScriptRoot 'runtime.windows.json') -Raw|ConvertFrom-Json
$null=New-Item -ItemType Directory -Path $OutputRoot
$receipt=[ordered]@{format=1;provider='process-loopback-target-tree';platform='win32';arch='x64';source_sha256=(Get-FileHash (Join-Path $PSScriptRoot 'ProcessAudioStream.cpp')).Hash.ToLowerInvariant();msbuild_path=$MsBuildPath;msbuild_version=(Get-Item -LiteralPath $MsBuildPath).VersionInfo.ProductVersion;toolset=$pins.tested.platform_toolset;msvc_tools=$pins.tested.msvc_tools;windows_sdk=$pins.tested.windows_sdk;node_version=(& node --version);powershell_version=$PSVersionTable.PSVersion.ToString();upstream_commit=$pins.sources.microsoft_sample.commit;ipc='NPCM-v1-44100-stereo-s16le';executable='bin/ProcessAudioStream.exe';build_log='build.log';status='build-pending'}
try{
 if($IsWindows -ne $true -or [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64'){throw 'Windows x64 build required'}
 & $MsBuildPath (Join-Path $PSScriptRoot 'ProcessAudioStream.vcxproj') /p:Configuration=Release /p:Platform=x64 ("/p:NostalgiaAudioBuildRoot=$OutputRoot") /verbosity:minimal > (Join-Path $OutputRoot 'build.log') 2>&1
 $receipt.build_exit=$LASTEXITCODE;if($LASTEXITCODE -ne 0){throw 'Process audio compilation failed; inspect build.log'}
 $binary=Join-Path $OutputRoot $receipt.executable
 $receipt.sha256=(Get-FileHash $binary).Hash.ToLowerInvariant();$receipt.size=(Get-Item -LiteralPath $binary).Length;$receipt.status='built-no-runtime-validation'
} catch{$receipt.status='failed';$receipt.error=$_.Exception.Message;throw}finally{
 $receipt|ConvertTo-Json -Depth 8|Set-Content (Join-Path $OutputRoot 'receipt.json');Write-Output (Join-Path $OutputRoot 'receipt.json')
}
