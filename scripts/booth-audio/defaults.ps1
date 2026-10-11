#requires -Version 7.0
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'AudioControl.cs')
[OwnedAudio]::SnapshotDefaults() | ConvertTo-Json -Depth 5 -Compress
