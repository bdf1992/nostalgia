# Multiplayer Strategies

Nostalgia treats multiplayer as a strategy selected per game, not as one universal emulator feature.

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

## 3. Remote Couch

Use this when the game already has local multiplayer and one authoritative emulator instance is simpler than synchronized emulation.

The host runs:

```text
GAME + EMULATOR
     ^
     | virtual controllers
REMOTE PLAYER INPUT
     |
     + video/audio stream back to guests
```

The v0.1 transport is Parsec.

Baseline:

1. Host gets the game booting locally first.
2. Host maps controller slot 1.
3. Guest installs Parsec and confirms their gamepad is recognized.
4. Guest connects to host.
5. Guest presses a controller button so Parsec exposes the virtual controller to the host.
6. Host verifies Windows/emulator sees a second controller.
7. Map that controller to player slot 2, not player slot 1.
8. Start the game's local multiplayer mode.

Parsec gamepad guide: https://support.parsec.app/hc/en-us/articles/32381705301908-Setup-Gamepad

### PS1 latency escalation

For PlayStation games, treat the transport as a measured choice rather than a permanent dependency.

Start with **DuckStation + Parsec** because it has the smallest setup surface: one authoritative emulator, one game instance, and remote controller/video transport. If the complete play test feels good, stop there.

If the session is playable but streaming transport appears to be the weak layer, try **Sunshine + Moonlight** as an alternate remote-couch transport. This preserves the same topology -- one DuckStation host -- while replacing the video/input streaming layer.

If remote-couch latency remains unacceptable and the game warrants a more involved setup, test **Mednafen native netplay**. In that topology both players run matching PS1 emulation/content locally and connect through Mednafen's netplay server, so each player renders their own game rather than receiving a video stream. Mednafen uses save states as part of synchronization; isolate or back up important memory-card state before testing.

Official references:

- Mednafen netplay: https://mednafen.github.io/documentation/netplay.html
- Mednafen PS1 notes: https://mednafen.github.io/documentation/psx.html
- Sunshine: https://docs.lizardbyte.dev/projects/sunshine/master/
- Moonlight: https://moonlight-stream.org/

Use evidence to choose the path:

```text
DuckStation + Parsec
        |
        +-- feels good ----------------------> keep it
        |
        +-- stream/encode/input path weak ---> try Sunshine + Moonlight
                                                |
                                                +-- good --> keep it
                                                |
                                                +-- still too latent
                                                       |
                                                       v
                                             Mednafen native netplay
```

Do not escalate merely because a theoretically lower-latency architecture exists. Escalate when measured latency or an actual match shows that the current transport is the limiting layer.

### First fixtures

- Twisted Metal 2
- Twisted Metal: Black
- Crash Team Racing
- Tekken 3
- Burnout 3: Takedown
- GoldenEye 007

This approach deliberately avoids pretending the original game has Internet multiplayer. The game still believes everyone is sitting on the same couch.

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
