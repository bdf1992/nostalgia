[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('games', 'runtimes', 'doctor', 'show', 'open', 'ps1', 'ps1-plan')]
    [string]$Command = 'games',

    [Parameter(Position = 1)]
    [string]$Id
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$GamesPath = Join-Path $Root 'catalog/games.json'
$RuntimesPath = Join-Path $Root 'catalog/runtimes.json'
$PS1Path = Join-Path $Root 'catalog/ps1-stress.json'

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
        PS1 = Read-JsonFile $PS1Path
    }
}

function Write-Heading([string]$Text) {
    Write-Host ''
    Write-Host "=== $Text ==="
}

function Get-PS1Case([string]$GameId) {
    if (-not $GameId) { throw 'Usage: ./nostalgia.ps1 ps1-plan <ps1-game-id>' }
    $game = $catalog.PS1.cases | Where-Object id -eq $GameId | Select-Object -First 1
    if (-not $game) { throw "Unknown PS1 stress id: $GameId" }
    $game
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

    'ps1' {
        Write-Heading "PS1 Stress Pack $($catalog.PS1.pack_id)"
        $catalog.PS1.cases |
            Sort-Object priority, title |
            Select-Object id, title, expected_max_players, input_topology, priority, validation |
            Format-Table -AutoSize -Wrap

        Write-Host ''
        Write-Host 'Recommended first buddy sequence:'
        Write-Host '  1. twisted-metal-2-ps1   - baseline two-player'
        Write-Host '  2. tekken-3-ps1          - latency / rapid input'
        Write-Host '  3. crash-bash-ps1        - Multitap topology'
        Write-Host '  4. diablo-ps1            - memory-card persistence'
        Write-Host '  5. micro-maniacs-ps1     - eventual high-player saturation'
    }

    'ps1-plan' {
        $game = Get-PS1Case $Id

        Write-Heading "$($game.title) - PS1 stress plan"
        Write-Host "Game id:        $($game.id)"
        Write-Host "Expected max:   $($game.expected_max_players)"
        Write-Host "Input topology: $($game.input_topology)"
        Write-Host "Multitap:       $($game.multitap)"
        Write-Host "Stress tags:    $($game.stress -join ', ')"
        Write-Host "Validation:     $($game.validation)"
        if ($game.notes) { Write-Host "Notes:          $($game.notes)" }

        Write-Heading 'Session order'
        Write-Host '1. Back up relevant DuckStation memory-card/config state.'
        Write-Host '2. Boot the player-owned game locally in DuckStation.'
        Write-Host '3. Prove each required local controller/device maps to a distinct PS1 slot.'
        Write-Host '4. If required by this game, enable and verify the intended Multitap topology.'
        Write-Host '5. Start Parsec; guest presses a gamepad button so the host receives the virtual controller.'
        Write-Host '6. Map guest device to the intended DuckStation slot without moving Player 1.'
        Write-Host '7. Complete a real match/session, not just a title-screen connection.'
        Write-Host '8. Disconnect/reconnect the guest controller once and note whether slot identity survives.'
        Write-Host '9. Close/reopen the game and verify any expected memory-card state.'
        Write-Host '10. Record result under reports/ps1/ before promoting validation.'
    }

    'doctor' {
        Write-Heading 'Nostalgia Doctor'
        Write-Host "Repository: $Root"
        Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
        Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
        Write-Host "Game recipes: $($catalog.Games.games.Count)"
        Write-Host "PS1 stress fixtures: $($catalog.PS1.cases.Count)"
        Write-Host "Emulators: $($catalog.Runtimes.runtimes.Count)"
        Write-Host "Transports: $($catalog.Runtimes.transports.Count)"

        $hostIsWindows = $env:OS -eq 'Windows_NT'
        if ($hostIsWindows) {
            Write-Host 'Windows host: yes'
        } else {
            Write-Warning 'The current helper is Windows-first; catalog/docs are still usable elsewhere.'
        }

        Write-Host ''
        Write-Host 'v0.1 doctor does not change the machine.'
        Write-Host 'PS1 next step: ./nostalgia.ps1 ps1-plan twisted-metal-2-ps1'
        Write-Host 'Future diagnostics: installed-runtime discovery, controller enumeration, content hashing, and network probes.'
    }
}
