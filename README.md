# Nostalgia

**Nostalgia** is a small, agent-assisted compatibility and multiplayer helper for classic games.

The v0.1 goal is deliberately modest:

> Pick a game, get a trustworthy emulator, identify the game/firmware files involved, choose the simplest multiplayer strategy, and keep troubleshooting until both players are in a playable session.

Nostalgia distributes recipes, runtime metadata, trustworthy upstream links, networking guidance, diagnostics, and safe state-management practices. Local game libraries, firmware, saves, and one-off downloaded binaries stay local by default.

The agent's job is practical: if you already have a file, emulator build, installation, or URL, it should help inspect it, avoid obvious traps, and keep moving toward a playable session.

## Trusted knowledge center

Nostalgia maintains a small source registry so players can avoid fake emulator sites, repacks, misleading download buttons, bad-dump folklore, and stale setup guides.

```powershell
./nostalgia.ps1 sources
```

See `docs/TRUSTED-SOURCES.md` for the human-readable guide and `catalog/sources.json` for the machine-readable registry.

The trust order is:

`official project -> preservation/reference database -> community knowledge -> secondary reference`

For emulator binaries, prefer the emulator project's own site/repository/release page. For game-image identity, use checksum/metadata references such as Redump or No-Intro rather than trusting filenames. Community wikis are useful for orientation and legacy hardware knowledge, but should not silently replace current upstream documentation.

## Try the bootstrap helper

On Windows PowerShell:

```powershell
./nostalgia.ps1 games
./nostalgia.ps1 runtimes
./nostalgia.ps1 sources
./nostalgia.ps1 doctor
./nostalgia.ps1 open dolphin
```

The helper is intentionally non-magical in v0.1. `open <runtime>` opens the runtime's documented upstream source; it does not silently install software.

## Classic Pack v0.1

The starting catalog contains 20 multiplayer fixtures across PlayStation, PlayStation 2, Nintendo 64, GameCube/Wii, original Xbox, and Dreamcast. They exercise four useful multiplayer shapes:

- **Emulator netplay** — synchronized emulator instances, e.g. Dolphin.
- **System Link / virtual LAN** — original network behavior tunneled between machines, e.g. xemu + XLink Kai or xemu UDP Tunnel.
- **Remote couch** — one authoritative emulator streams video/audio while remote controllers are passed to the host, e.g. Parsec.
- **Rollback / match-code netplay** — emulator-specific P2P flows, e.g. Flycast Dojo.

Every game entry begins as `experimental` until somebody actually validates a complete session and records what worked.

## Repository map

```text
AGENTS.md                  agent/repository operating rules
SKILL.md                   Nostalgia skill kernel
CONTRIBUTING.md            recipe and evidence contribution rules
catalog/games.json         20-game starter catalog
catalog/runtimes.json      emulator + networking/runtime catalog
catalog/sources.json       trusted source registry
docs/CONTENT.md            local byte handling + file hygiene
docs/TRUSTED-SOURCES.md    knowledge center + download trap guide
docs/MULTIPLAYER.md        multiplayer strategies + troubleshooting
recipes/game.example.json  recipe shape for per-game refinement
nostalgia.ps1              tiny Windows helper
```

## Principle

**The game is not the package. The reproducible play recipe is the package.**

Given local content, Nostalgia should eventually be able to reproduce a known-good play environment without overwriting originals or pretending uncertainty is compatibility.

## Status

`v0.1-bootstrap` — intentionally rough, meant to be tried with a friend and improved from real failures.
