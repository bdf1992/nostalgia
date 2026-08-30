# Multiplayer Strategies

Nostalgia treats multiplayer as a strategy selected per game, not as one universal emulator feature.

Recommendation labels describe *why* a route is suggested:

- **latency-first** — lowest expected end-to-end delay among credible routes;
- **balanced** — good expected latency without disproportionate setup complexity;
- **easy-first** — fastest path to a playable session;
- **fallback** — useful when the preferred route fails;
- **candidate-until-measured** — promising topology that still needs a real session before it is called proven.

For remote multiplayer, Nostalgia defaults to **latency-first** unless the player explicitly values setup simplicity more.

## 1. Dolphin NetPlay

Best first choice for GameCube local-multiplayer games in this pack.

Baseline:

1. Both players install the same Dolphin version from the official Dolphin project.
2. Both players add their own matching copy of the game.
3. Confirm region/revision match; identical dumps are strongly preferred.
4. Boot locally on both machines before attempting NetPlay.
5. Host: `Tools -> Start NetPlay Session`.
6. Prefer traversal-server hosting for the first attempt.
7. Send the traversal code to the other player.
8. Assign each NetPlay participant to the intended controller port.
9. Start the game from the NetPlay session.

Dolphin documentation notes that strict NAT/firewalls can still block traversal and that all players must use the same Dolphin version.

Official guide: https://dolphin-emu.org/docs/guides/netplay-guide/

### First fixtures

- Mario Kart: Double Dash!!
- Super Smash Bros. Melee
- Mario Party 4
- Gauntlet: Dark Legacy
- Hunter: The Reckoning
- Turok: Evolution

Treat Wii NetPlay as a later/advanced path because Dolphin itself documents it as more temperamental.

---

## 2. xemu System Link

Use this when the original Xbox title contains a verified System Link/LAN mode.

Two useful paths exist.

### xemu UDP Tunnel

Good when both players are using xemu and want a small direct virtual-LAN setup.

xemu's UDP Tunnel encapsulates the emulated Ethernet traffic and sends it to another xemu endpoint/tunnel arrangement.

Official networking docs: https://xemu.app/docs/networking/

### xemu + XLink Kai

Good when using XLink's game arenas/community, or when mixing xemu with compatible real Xbox hardware.

Baseline:

1. Both players obtain/configure xemu and their own required Xbox firmware/console data.
2. Verify the selected game is on XLink Kai's supported System Link list.
3. Ensure each virtual Xbox has a unique MAC/EEPROM identity.
4. Configure xemu's Bridged Adapter as required by the XLink guide.
5. Start XLink Kai and ensure the virtual Xbox is detected.
6. Open the game's **System Link** menu.
7. Host/join from the game's own LAN browser.

XLink guide: https://www.teamxlink.co.uk/wiki/Xemu_XLink_Kai_Setup

XLink verified Xbox list: https://www.teamxlink.co.uk/wiki/Xbox

### Common xemu failure

**Session appears but cannot be joined:** check duplicate MAC addresses first. xemu explicitly documents duplicate virtual Xbox MAC identity as a System Link failure cause.

---

## 3. PlayStation multiplayer

PS1 local-multiplayer games can be transported over the Internet in more than one way. Nostalgia now keeps three recommendation profiles instead of pretending one route is universally best.

### Latency-first — Mednafen native netplay

**Recommendation:** `latency-first`, `candidate-until-measured`

Both players run matching PS1 emulation/content locally and connect through Mednafen's netplay system. Each player renders locally, so the control loop does not include remote video capture, encode, transmission, decode, and display.

This is the primary PS1 candidate when the goal is the lowest practical latency, but it is not called "proven fastest" until an actual match supports that claim.

Before testing:

1. Both players prove the same game boots locally.
2. Match emulator versions and game revision/content.
3. Back up or isolate important memory-card state; Mednafen uses save states during synchronization.
4. Establish the netplay server/session.
5. Map each player to the intended controller slot.
6. Play a real match and record latency/stability observations.

Official references:

- Mednafen netplay: https://mednafen.github.io/documentation/netplay.html
- Mednafen PS1 notes: https://mednafen.github.io/documentation/psx.html

### Balanced — DuckStation + Sunshine/Moonlight

**Recommendation:** `balanced`, `candidate-until-measured`

One authoritative DuckStation host runs the game. Sunshine streams it and Moonlight receives the stream/controller path.

This preserves DuckStation's simple one-emulator topology while targeting a lower-latency streaming stack than the easiest baseline. On Windows, use Sunshine's documented virtual-input setup for guest controllers.

Official references:

- Sunshine: https://docs.lizardbyte.dev/projects/sunshine/master/
- Moonlight: https://moonlight-stream.org/

### Easy-first — DuckStation + Parsec

**Recommendation:** `easy-first`, `fallback`

Use this when the quickest route to a working remote couch matters more than minimizing every millisecond.

The host runs:

```text
GAME + DUCKSTATION
     ^
     | virtual controllers
REMOTE PLAYER INPUT
     |
     + video/audio stream back to guests
```

Baseline:

1. Host gets the game booting locally first.
2. Host maps controller slot 1.
3. Guest installs Parsec and confirms their gamepad is recognized.
4. Guest connects to host.
5. Guest presses a controller button so Parsec exposes the virtual controller to the host.
6. Host verifies Windows/DuckStation sees a second controller.
7. Map that controller to player slot 2, not player slot 1.
8. Start the game's local multiplayer mode.

Parsec gamepad guide: https://support.parsec.app/hc/en-us/articles/32381705301908-Setup-Gamepad

### PS1 comparison rule

If latency matters, do not wait for Parsec to fail before acknowledging alternatives. Start from the recommendation profile the player values.

For a latency-focused test campaign:

```text
Mednafen native netplay
        |
        +-- measure real match latency/stability
        |
        +-- good ----------------------------> promote for this game/setup
        |
        +-- unstable / incompatible
               |
               v
DuckStation + Sunshine/Moonlight
        |
        +-- measure again
        |
        +-- good ----------------------------> keep it
        |
        +-- setup burden too high / failure
               |
               v
DuckStation + Parsec
        |
        +-- easiest baseline / fallback
```

The opposite campaign is also valid: if the player asks for the easiest setup, begin with Parsec. Recommendation labels make the tradeoff explicit instead of hiding it.

### First PS1 fixtures

- Twisted Metal 2
- Crash Team Racing
- Tekken 3

Other remote-couch fixtures in the classic pack include Twisted Metal: Black, Burnout 3: Takedown, and GoldenEye 007, but their best latency-first paths still need game/system-specific validation.

---

## 4. Flycast Dojo Match Codes

Flycast Dojo is an emulator fork focused on netplay/replay for Dreamcast/Naomi/Atomiswave software.

For a simple P2P attempt:

1. Both players use the same game content.
2. Configure controllers locally.
3. Host selects HOST and launches the game.
4. Flycast Dojo supplies a Match Code.
5. Guest enters the Match Code and joins.
6. Host detects/sets delay and starts the session.

Project documentation: https://github.com/blueminder/flycast-dojo

Starter fixture: Power Stone 2.

---

# Troubleshooting order

Do not randomly reinstall everything. Walk the stack:

```text
1. CONTENT
2. REQUIRED FIRMWARE / CONSOLE DATA
3. EMULATOR VERSION
4. LOCAL GAME BOOT
5. LOCAL PERFORMANCE
6. CONTROLLER ENUMERATION
7. CONTROLLER SLOT MAPPING
8. NETWORK REACHABILITY
9. MULTIPLAYER MODE / PROTOCOL
10. EMULATED MACHINE IDENTITY
11. SAVE / PROFILE STATE
12. LATENCY / BUFFERING
```

When comparing latency paths, separate the control loop where possible:

```text
controller/input
-> network
-> emulation/synchronization
-> encode
-> transport
-> decode
-> display
```

At each step answer:

- What observation proves this layer is working?
- What changed since the last successful test?
- Can the proposed fix be reversed?

# Never use these as first-line fixes

- globally disabling Windows Firewall;
- putting the entire host in a DMZ;
- deleting emulator configuration;
- deleting saves/memory cards;
- replacing player-owned firmware/data with mystery files from the Internet;
- changing five emulator timing/rendering settings simultaneously.

The purpose of the agent is to remove configuration pain without creating invisible damage.
