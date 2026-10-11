#requires -Version 7.0
param([Parameter(Mandatory)][ValidateSet('status','mute','unmute')][string]$Operation,[Parameter(Mandatory)][int]$TargetPid,[Parameter(Mandatory)][long]$StartTicksUtc,[Parameter(Mandatory)][string]$Executable,[switch]$IncludeDescendants)
$ErrorActionPreference='Stop'
try {
 Add-Type -Path (Join-Path $PSScriptRoot 'AudioControl.cs')
 $root=[AudioTarget]::new();$root.pid=$TargetPid;$root.start_ticks_utc=$StartTicksUtc;$root.executable=$Executable
 # Validate before discovering descendants; status performs no audio mutation.
 $null=[OwnedAudio]::Run([AudioTarget[]]@($root),'status')
 $targets=[Collections.Generic.List[AudioTarget]]::new();$targets.Add($root)
 if($IncludeDescendants) {
  $snapshot=@(Get-CimInstance Win32_Process)
  for($i=0;$i -lt $targets.Count;$i++) {
   $parent=$targets[$i]
   foreach($child in $snapshot | Where-Object { $_.ParentProcessId -eq $parent.pid }) {
    if($targets.pid -contains [int]$child.ProcessId){continue}
    $process=Get-Process -Id $child.ProcessId -ErrorAction Stop
    $ticks=$process.StartTime.ToUniversalTime().Ticks
    if($ticks -lt $parent.start_ticks_utc){continue}
    if(-not $child.ExecutablePath){throw 'Descendant executable identity unavailable'}
    if([Math]::Abs($child.CreationDate.ToUniversalTime().Ticks-$ticks) -gt 10){throw 'Descendant creation identity changed'}
    $target=[AudioTarget]::new();$target.pid=$process.Id;$target.start_ticks_utc=$ticks;$target.executable=$child.ExecutablePath;$targets.Add($target)
    if($targets.Count -gt 128){throw 'Descendant bound exceeded'}
   }
  }
 }
 [OwnedAudio]::Run($targets.ToArray(),$Operation) | ConvertTo-Json -Depth 8
} catch { @{status='error';operation=$Operation;error=$_.Exception.Message;partial_mutation_possible=($Operation -ne 'status')} | ConvertTo-Json -Depth 4;exit 1 }
