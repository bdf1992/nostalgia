# First Session With a Buddy

For v0.1, optimize for **getting one real session working**, not proving every emulator pack at once.

## Recommended first test: Twisted Metal 2 remote couch

This is the smallest networking experiment because only the host emulator needs to run the game. Parsec transports the guest's controller and the host's video/audio.

### Host

1. Run `./nostalgia.ps1 open duckstation` and install DuckStation from its official release.
2. Configure the player-owned game/firmware material required by your setup.
3. Boot Twisted Metal 2 locally.
4. Confirm your controller works as player 1.
5. Run `./nostalgia.ps1 open parsec-remote-couch` and install/configure Parsec.
6. Allow your buddy to connect only when you are ready to test.

### Guest

1. Install Parsec from its official source.
2. Connect a gamepad.
3. Verify Parsec's Gamepad settings react to button presses.
4. Connect to the host.
5. Press a controller button after connecting so the host receives a virtual controller.

### Back on the host

1. Open DuckStation controller settings.
2. Make sure the host controller is player 1 and the Parsec virtual controller is player 2.
3. Do **not** map both physical devices to the same emulated port.
4. Enter Twisted Metal 2's local multiplayer mode.
5. Play long enough to establish that input, audio/video, latency, and game stability are acceptable.

Then record the result. If it works, promote the catalog entry from `candidate` to `validated` with runtime versions and a short test note.

Parsec controller documentation: https://support.parsec.app/hc/en-us/articles/32381705301908-Setup-Gamepad

---

## Second test: GameCube Dolphin NetPlay

Suggested fixtures:

- Mario Kart: Double Dash!!
- Super Smash Bros. Melee
- Gauntlet: Dark Legacy
- Hunter: The Reckoning
- Turok: Evolution

Both players should:

1. install the same Dolphin release;
2. add their own matching game revision;
3. prove the game boots locally;
4. use Dolphin's NetPlay UI;
5. start with traversal-server hosting;
6. assign each player to a separate controller port.

Official guide: https://dolphin-emu.org/docs/guides/netplay-guide/

This test exercises synchronized emulation and content/version parity instead of remote streaming.

---

## Third test: Halo 2 System Link

This is the more interesting infrastructure test.

Both players need a functioning xemu setup using their own required console/game data.

Then try either:

- xemu UDP Tunnel for a focused xemu-to-xemu virtual LAN; or
- xemu Bridged Adapter + XLink Kai for the established System Link community path.

Before troubleshooting anything exotic, verify:

- Halo 2 boots locally;
- each virtual Xbox has a unique MAC identity;
- both players use compatible game revisions;
- the selected network adapter/backend is correct;
- the game is opened through its **System Link** menu, not its retired Xbox Live path.

xemu networking: https://xemu.app/docs/networking/

XLink xemu guide: https://www.teamxlink.co.uk/wiki/Xemu_XLink_Kai_Setup

---

# What to send the agent when it breaks

A useful troubleshooting message is informal. For example:

```text
Trying Twisted Metal 2 with Dan.
I'm Windows 11 hosting DuckStation through Parsec.
The game runs for me.
He can see the screen and Parsec sees his Xbox controller,
but both controllers move player 1.
Help me fix it without wrecking my existing emulator setup.
```

The Nostalgia skill should translate that into inspection and repair steps without requiring the player to know which subsystem is failing.

# What counts as a successful v0.1 night

One game.

Two machines.

Two controllers.

One actually playable remote session.

One compatibility recipe improved from what happened.
