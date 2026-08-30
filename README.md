# Nostalgia

**Nostalgia** is a small, agent-assisted compatibility and multiplayer helper for playing classic games you legally possess.

The v0.1 goal is deliberately modest:

> Pick a game, get the right emulator from its official project, identify the player-owned game/firmware files it needs, choose the simplest multiplayer strategy, and keep troubleshooting until both players are in a playable session.

Nostalgia does **not** distribute commercial game images, proprietary BIOS/firmware, encryption keys, or other copyrighted console data. It distributes recipes, runtime metadata, official-source links, networking guidance, diagnostics, and safe state-management practices.

## Try the bootstrap helper

On Windows PowerShell:

```powershell
./nostalgia.ps1 games
./nostalgia.ps1 runtimes
./nostalgia.ps1 doctor
./nostalgia.ps1 open dolphin
```

The helper is intentionally non-magical in v0.1. `open <runtime>` opens the runtime's documented upstream source; it does not silently install software or acquire game data.

## Classic Pack v0.1

The starting catalog contains 20 multiplayer fixtures across PlayStation, PlayStation 2, Nintendo 64, GameCube/Wii, original Xbox, and Dreamcast. They exercise four useful multiplayer shapes:

- **Emulator netplay** — synchronized emulator instances, e.g. Dolphin.
- **System Link / virtual LAN** — original network behavior tunneled between machines, e.g. xemu + XLink Kai or xemu UDP Tunnel.
- **Remote couch** — one authoritative emulator streams video/audio while remote controllers are passed to the host, e.g. Parsec.
- **Rollback / match-code netplay** — emulator-specific P2P flows, e.g. Flycast Dojo.

Every game entry begins as `experimental` until somebody actually validates a complete session and records what worked.

## Repository map

```text
AGENTS.md                 agent/repository operating rules
SKILL.md                  Nostalgia skill kernel
CONTRIBUTING.md           recipe and evidence contribution rules
catalog/games.json        20-game starter catalog
catalog/runtimes.json     emulator + networking/runtime catalog
docs/CONTENT.md           game/firmware acquisition boundary
docs/MULTIPLAYER.md       multiplayer strategies + troubleshooting
recipes/game.example.json recipe shape for per-game refinement
nostalgia.ps1             tiny Windows helper
```

## Principle

**The game is not the package. The reproducible play recipe is the package.**

Given player-owned content, Nostalgia should eventually be able to reproduce a known-good play environment without overwriting originals or pretending uncertainty is compatibility.

## Status

`v0.1-bootstrap` — intentionally rough, meant to be tried with a friend and improved from real failures.
