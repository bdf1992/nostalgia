# PS1 Stress Campaign

PS1 is Nostalgia's first serious multiplayer validation campaign.

The goal is not to prove that DuckStation can boot PlayStation games. The goal is to prove that Nostalgia can reliably turn player intent into a playable remote multiplayer session across increasingly awkward controller, save, and recovery topologies.

## Chosen architecture

For v0.1:

```text
player-owned PS1 game + BIOS
        |
        v
   DuckStation host
        |
        +-- host controller(s)
        |
        +-- Parsec virtual controller(s)
        |
        v
  original local multiplayer
```

Use one authoritative emulator instance. Do not make RetroArch netplay a PS1 fallback: current Libretro documentation says its netplay model is unsuitable for PSX-class systems.

DuckStation is the preferred PS1 runtime because its current feature set includes digital/analog controllers, per-game controller configuration, memory-card tooling, and Multitap support for up to eight devices.

## What we are stress-testing

A successful campaign should expose assumptions in seven separate layers:

1. **content identity** — region/revision and user-owned image identity are explicit;
2. **runtime** — a known DuckStation version/profile launches the game;
3. **controller identity** — each virtual/physical device occupies the intended PS1 slot;
4. **topology** — direct ports, Multitap, two-Multitap, odd player counts, and shared controllers are represented correctly;
5. **transport** — Parsec carries guest input without collapsing or reordering players;
6. **persistence** — memory cards and per-game configuration survive closing/reopening;
7. **recovery** — controller loss/reconnect can be repaired without destroying the session or saves.

## Stress ladder

### L0 — boot

- game boots from player-owned content;
- BIOS/runtime requirements are satisfied;
- title/revision can be recorded;
- no compatibility tweak is silently required.

### L1 — local two-player

- two local controllers appear as different devices;
- both can navigate/play simultaneously where the game permits;
- controller order is recorded.

### L2 — buddy remote-couch

- host launches DuckStation;
- guest connects through Parsec;
- guest presses a controller button so Parsec creates the virtual gamepad;
- DuckStation maps host and guest to distinct PlayStation controller slots;
- a real match/session is completed.

This is the minimum useful Nostalgia multiplayer proof.

### L3 — Multitap 3/4 players

- enable the game-required Multitap topology in DuckStation;
- attach three or four independently addressable devices;
- verify that no input is duplicated across player slots;
- validate the actual multiplayer mode because some games expose different player counts by mode.

Best fixtures: Crash Team Racing, Crash Bash, Twisted Metal 4, Team Buddies.

### L4 — weird topology

Use fixtures that defeat the assumption `players == controllers`:

- **Bomberman World** — five-player topology;
- **Worms Armageddon** — pass-the-pad/shared-controller play;
- **Bishi Bashi Special** — logical player count can exceed simultaneous controller count;
- **Micro Maniacs** — up to eight players plus shared-controller options;
- **NHL 2001** — up to eight distinct controller inputs/two-Multitap saturation.

The representation must track at least:

```text
logical player
physical/virtual device
emulated PS1 port
Multitap branch/slot
current owner
```

as separate concepts.

### L5 — persistence

For a save-heavy fixture such as Diablo:

1. snapshot the relevant memory-card/config state;
2. launch and make an identifiable save/progression change;
3. close DuckStation normally;
4. reconnect the remote player;
5. reopen the title;
6. verify the expected state;
7. verify that the pre-test snapshot can still be restored.

Do not use save-state success as a substitute for memory-card persistence.

### L6 — recovery

During a running match:

- disconnect guest controller;
- reconnect it;
- verify whether Parsec creates the same or a new host device identity;
- repair DuckStation's controller-slot mapping if necessary;
- continue the match;
- repeat after reconnecting Parsec itself.

Record whether recovery required restarting the game or emulator.

## First buddy run

Do these in order.

### A. Twisted Metal 2

Purpose: boring two-player baseline.

Pass when:

- both players independently control a vehicle;
- one complete match is playable;
- reconnecting the guest does not permanently steal Player 1;
- no save/config state is lost.

### B. Tekken 3

Purpose: latency/input quality.

Pass when:

- rapid directional/button sequences are usable;
- neither player experiences stuck buttons;
- both agree the stream/input latency is playable enough for casual matches.

Record host-to-guest geographic/network context only at a coarse level; never commit personal IP addresses.

### C. Crash Bash or Crash Team Racing

Purpose: graduate from two direct ports to Multitap topology.

Start with two actual players, then attach extra local or remote controllers when available. The important proof is that Nostalgia understands how the intended game mode maps controllers to Multitap slots.

### D. Diablo

Purpose: memory-card safety and longer-running co-op.

Do not begin until the current memory-card state has a backup.

### E. Micro Maniacs or NHL 2001

Purpose: eventual maximum topology test.

This does not require eight human friends. The campaign can first prove that eight distinct host-side controller devices/slots can be represented and mapped, then later validate a real high-player-count session.

## Session record

After every real test, add a record under `reports/ps1/` using this shape:

```yaml
schema: nostalgia.ps1-session/0.1
date: YYYY-MM-DD
game_id: twisted-metal-2-ps1
result: playable | partial | blocked
players:
  humans: 2
  logical: 2
runtime:
  id: duckstation
  version: exact-version
transport:
  id: parsec-remote-couch
content:
  region: unknown-or-recorded
  revision: unknown-or-recorded
  sha256: optional-local-content-hash
controllers:
  - player: 1
    source: host
    emulated_slot: port-1
  - player: 2
    source: parsec-guest
    emulated_slot: port-2
multitap: none
save_backup_created: true
completed_match_or_session: true
recovery_tested: false
symptoms: []
fixes: []
private_data_removed: true
```

Hashes identify a user's own content without publishing the bytes. Do not commit BIOS/game/save files.

## Promotion rule

A catalog entry stays `candidate` until a complete observed session exists.

Promote to `validated` only when:

```text
BOOT
+ CORRECT INPUT TOPOLOGY
+ REMOTE PLAYER CONNECTED
+ ACTUAL GAMEPLAY COMPLETED
+ MUTABLE STATE SAFE
```

Promote to `known-good` only after the same route is reproduced on another session or environment with enough version/content detail to explain the result.

## What a failure should teach us

A failed session is useful if it reduces ambiguity. Record the failing layer and the smallest repair.

Examples:

- Parsec sees guest controller, DuckStation does not -> runtime/input mapping layer.
- DuckStation sees four devices, game exposes only two -> Multitap/game-mode layer.
- game works locally but remote guest controls Player 1 -> controller ownership/order layer.
- reconnect creates a new virtual gamepad -> recovery/device identity layer.
- memory card changed unexpectedly -> persistence/custody layer.

Do not flatten all of these into "netplay failed."
