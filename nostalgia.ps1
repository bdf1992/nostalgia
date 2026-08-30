[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('games', 'runtimes', 'doctor', 'show', 'open')]
    [string]$Command = 'games',

    [Parameter(Position = 1)]
    [string]$Id
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$GamesPath = Join-Path $Root 'catalog/games.json'
$RuntimesPath = Join-Path $Root 'catalog/runtimes.json'

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Missing catalog: $Path"
    }
    Get-Content -Raw -Path $Path | ConvertFrom-Json
}

function Get-Catalogs {
    @{
        Games = Read-JsonFile $GamesPath
        Runtimes = Read-JsonFile $RuntimesPath
    }
}

function Write-Heading([string]$Text) {
    Write-Host ''
    Write-Host "=== $Text ==="
}

$catalog = Get-Catalogs

switch ($Command) {
    'games' {
        Write-Heading "Classic Pack $($catalog.Games.pack_id)"
        $catalog.Games.games |
            Sort-Object platform, title |
            Select-Object id, title, platform, preferred_runtime, multiplayer_strategy, validation |
            Format-Table -AutoSize
    }

    'runtimes' {
        Write-Heading 'Emulators'
        $catalog.Runtimes.runtimes |
            Select-Object id, kind, @{N='platforms';E={$_.platforms -join ', '}}, official_download |
            Format-Table -AutoSize -Wrap

        Write-Heading 'Transports'
        $catalog.Runtimes.transports |
            Select-Object id, kind, official_download |
            Format-Table -AutoSize -Wrap

        Write-Heading 'Packs'
        $catalog.Runtimes.packs |
            Select-Object id, @{N='members';E={$_.members -join ', '}}, use_for |
            Format-Table -AutoSize -Wrap
    }

    'show' {
        if (-not $Id) { throw 'Usage: ./nostalgia.ps1 show <game-id>' }
        $game = $catalog.Games.games | Where-Object id -eq $Id | Select-Object -First 1
        if (-not $game) { throw "Unknown game id: $Id" }
        $game | ConvertTo-Json -Depth 10
    }

    'open' {
        if (-not $Id) { throw 'Usage: ./nostalgia.ps1 open <runtime-or-transport-id>' }
        $entry = $catalog.Runtimes.runtimes | Where-Object id -eq $Id | Select-Object -First 1
        if (-not $entry) {
            $entry = $catalog.Runtimes.transports | Where-Object id -eq $Id | Select-Object -First 1
        }
        if (-not $entry) { throw "Unknown runtime/transport id: $Id" }
        if (-not $entry.official_download) { throw "No official download/source URL recorded for: $Id" }

        Write-Host "Opening official source for $Id"
        Write-Host $entry.official_download
        Start-Process $entry.official_download
    }

    'doctor' {
        Write-Heading 'Nostalgia Doctor'
        Write-Host "Repository: $Root"
        Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
        Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
        Write-Host "Game recipes: $($catalog.Games.games.Count)"
        Write-Host "Emulators: $($catalog.Runtimes.runtimes.Count)"
        Write-Host "Transports: $($catalog.Runtimes.transports.Count)"

        $isWindows = $env:OS -eq 'Windows_NT'
        if ($isWindows) {
            Write-Host 'Windows host: yes'
        } else {
            Write-Warning 'The current helper is Windows-first; catalog/docs are still usable elsewhere.'
        }

        Write-Host ''
        Write-Host 'v0.1 doctor does not change the machine.'
        Write-Host 'Next useful diagnostics: installed-runtime discovery, controller enumeration, content hashing, and network probes.'
    }
}
