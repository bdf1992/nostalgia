#requires -Version 7.0
param([Parameter(Mandatory)][string]$ToolReceipt,[Parameter(Mandatory)][string]$ExpectedCableEndpoint)
$ErrorActionPreference='Stop'
if(-not $IsWindows -or [Threading.Thread]::CurrentThread.GetApartmentState() -ne 'MTA'){throw 'Use PowerShell7 -MTA on Windows'}
Add-Type -Path (Join-Path $PSScriptRoot 'AudioControl.cs')
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'));$root=Join-Path $repo ('state/booth-audio-test-'+[guid]::NewGuid());$null=New-Item -ItemType Directory $root
$env:DOTNET_CLI_HOME=Join-Path $root 'dotnet-home';$env:NUGET_PACKAGES=Join-Path $root 'packages';$env:DOTNET_CLI_TELEMETRY_OPTOUT='1';$env:DOTNET_GENERATE_ASPNET_CERTIFICATE='false'
$fixtureOutput=Join-Path $root 'fixture-build';$intermediate=Join-Path $root 'obj/'
dotnet build (Join-Path $PSScriptRoot 'fixtures/audio/NativeAudioFixture.csproj') -c Release ("-p:BaseIntermediateOutputPath=$intermediate") ("-p:MSBuildProjectExtensionsPath=$intermediate") ("-p:OutputPath=$fixtureOutput/") -p:MSBuildEnableWorkloadResolver=false > (Join-Path $root 'fixture-build.log') 2>&1
if($LASTEXITCODE -ne 0){throw 'Authored fixture compilation failed'}
$exe=Join-Path $fixtureOutput 'NativeAudioFixture.exe';$dir=Join-Path $root 'fixture-state';$null=New-Item -ItemType Directory $dir;$owned=$null
try{
 $owned=Start-Process $exe -WindowStyle Hidden -ArgumentList @($dir) -PassThru -RedirectStandardOutput (Join-Path $dir 'stdout') -RedirectStandardError (Join-Path $dir 'stderr');$ticks=$owned.StartTime.ToUniversalTime().Ticks
 function WaitFile([string]$name){$deadline=[DateTime]::UtcNow.AddSeconds(15);while(-not(Test-Path (Join-Path $dir $name))){if($owned.HasExited -or [DateTime]::UtcNow -ge $deadline){throw ('Missing '+$name)};Start-Sleep -Milliseconds 50}}
 WaitFile 'process-ready.json';[IO.File]::WriteAllText((Join-Path $dir 'initialize'),'explicit Cable zero');WaitFile 'audio-ready';$target=[AudioTarget]::new();$target.pid=$owned.Id;$target.start_ticks_utc=$ticks;$target.executable=$exe
 $observed=[OwnedAudio]::Run([AudioTarget[]]@($target),'status');$active=@($observed.sessions|Where-Object {$_.state -eq 1});if(-not $active.Count -or @($active|Where-Object {$_.endpoint -ne $ExpectedCableEndpoint}).Count){throw 'Tone refused: active Cable endpoint differs from supplied exact identity'}
 $observed|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'fixture-session.json');$null=[OwnedAudio]::Run([AudioTarget[]]@($target),'unmute');[IO.File]::WriteAllText((Join-Path $dir 'tone'),'owned verified Cable');WaitFile 'tone-ready.json'
 node (Join-Path $PSScriptRoot 'regression.mjs') $ToolReceipt > (Join-Path $root 'regression.log');if($LASTEXITCODE -ne 0){throw 'Viewer regression failed'}
 node (Join-Path $PSScriptRoot 'test.mjs') ([string]$owned.Id) ([string]$ticks) $exe $root $ToolReceipt;if($LASTEXITCODE -ne 0){throw 'Viewer authored proof failed'}
}finally{
 if($owned -and -not $owned.HasExited){[IO.File]::WriteAllText((Join-Path $dir 'stop'),'stop');if(-not $owned.WaitForExit(10000)){if($owned.StartTime.ToUniversalTime().Ticks -eq $ticks -and $owned.MainModule.FileName -eq $exe){$owned.Kill();$null=$owned.WaitForExit(5000)}}}
 [ordered]@{fixture_stopped=($owned -and $owned.HasExited);game_launched=$false;physical_output_requested=$false;tool_receipt=$ToolReceipt;fixture_source_sha256=(Get-FileHash (Join-Path $PSScriptRoot 'fixtures/audio/Program.cs')).Hash;browser_receipt='browser-receipt.json'}|ConvertTo-Json|Set-Content (Join-Path $root 'test-receipt.json');Write-Output $root
}
