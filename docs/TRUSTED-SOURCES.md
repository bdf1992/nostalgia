# Trusted Sources Knowledge Center

Nostalgia should help players **find trustworthy technical information and avoid traps** without becoming a commercial game-download directory.

This page is the human-readable view of `catalog/sources.json`.

## Trust model

Use sources in roughly this order:

1. **Official** — emulator/project/vendor source. Prefer these for binaries, releases, configuration, networking, and project-specific behavior.
2. **Reference** — preservation/identity databases. Prefer these for hashes, regions, revisions, disc/cartridge identity, and bad-dump checks.
3. **Community** — useful technical wikis and scene knowledge. Good for orientation and old hardware knowledge; cross-check risky or changing claims.
4. **Secondary** — supplemental troubleshooting references. Useful, but never preferable to current upstream documentation for downloads or current behavior.

A site can be useful without being authoritative. A site can also host accurate information while having unsafe advertisements/download buttons. Separate **knowledge quality** from **download safety**.

---

## Official emulator and multiplayer sources

### PlayStation — DuckStation

- Project: https://github.com/stenzek/duckstation
- Latest releases: https://github.com/stenzek/duckstation/releases/tag/latest

Use for PS1 emulator binaries, current requirements, controller behavior, Multitap support, and DuckStation-specific troubleshooting.

**Trap to avoid:** random websites repackaging DuckStation into an installer. If all you need is DuckStation, start at the project/release page.

### PlayStation 2 — PCSX2

- Project: https://pcsx2.net/
- Running/setup guide: https://pcsx2.net/docs/setup/running/

Use for current stable/nightly builds and PS2 setup information.

### GameCube / Wii — Dolphin

- Project: https://dolphin-emu.org/
- Downloads: https://dolphin-emu.org/download/
- Guides: https://dolphin-emu.org/docs/guides/
- NetPlay: https://dolphin-emu.org/docs/guides/netplay-guide/

Dolphin's guide index includes controller setup, performance information, game ripping/dumping, NAND usage, and NetPlay.

### Original Xbox — xemu

- Project: https://xemu.app/
- Downloads: https://xemu.app/docs/download/
- Networking: https://xemu.app/docs/networking/

Use for xemu binaries and authoritative NAT, UDP Tunnel, Bridged Adapter, and System Link behavior.

### RetroArch / Libretro

- Documentation: https://docs.libretro.com/
- Netplay FAQ: https://docs.libretro.com/guides/netplay-faq/

Use for frontend/core behavior and netplay constraints. Do not assume that because RetroArch has a Netplay menu every core/system is a good Netplay target.

### Dreamcast / Naomi / Atomiswave — Flycast Dojo

- Project: https://github.com/blueminder/flycast-dojo
- Releases: https://github.com/blueminder/flycast-dojo/releases

Use for Dojo-specific P2P Match Codes, file parity/checksums, replays, and netplay troubleshooting.

### Remote couch — Parsec

- Project: https://parsec.app/
- Gamepad setup: https://support.parsec.app/hc/en-us/articles/32381705301908-Setup-Gamepad

Use when one authoritative emulator host is streaming the game and remote players need their controllers exposed to the host.

### LAN / System Link tunneling — XLink Kai

- Project: https://www.teamxlink.co.uk/
- Wiki: https://www.teamxlink.co.uk/wiki/Main_Page
- xemu setup: https://www.teamxlink.co.uk/wiki/Xemu_XLink_Kai_Setup

Use for supported LAN/System-Link games and tunnel setup. Prefer Kai/xemu documentation over random port-forwarding tutorials.

---

## Content identity and bad-dump checking

These are **metadata/reference sources**, not recommended game-download locations.

### Redump

- https://redump.org/

Useful for optical-disc release identity and checksums: region, revision, track structure, and whether local disc-image bytes correspond to a known dump.

A Redump match is much stronger evidence than a filename such as `Game (USA) [!].bin`.

### No-Intro DAT-o-MATIC

- https://datomatic.no-intro.org/

Useful primarily for cartridge-oriented release identity and checksum metadata.

### Local hashing on Windows

Microsoft documents PowerShell's built-in `Get-FileHash`:

- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/get-filehash

Example:

```powershell
Get-FileHash '.\some-file.bin' -Algorithm SHA256
```

Hashes identify bytes. They are useful for:

- comparing two friends' copies;
- checking an emulator binary against a publisher/project checksum when one is provided;
- distinguishing revisions that have the same filename;
- documenting a known-good session;
- noticing that a download changed even though its filename did not.

A hash match does **not** by itself establish that a file is safe or that its source was legitimate. Context still matters.

---

## Community knowledge worth consulting

### ConsoleMods Wiki

- https://consolemods.org/wiki/Main_Page/en

Strong community reference for older console hardware, repairs, modifications, preservation techniques, and many console-specific procedures.

It is a collaborative wiki, so treat hardware-modification steps as something to cross-check rather than blindly execute.

### Emulation General Wiki

- https://emulation.gametechwiki.com/index.php/Main_Page

Useful broad map of emulator projects, platform choices, features, and terminology.

Use it to discover what project to investigate, then follow through to that project's official site before downloading binaries.

### PCGamingWiki

- https://www.pcgamingwiki.com/wiki/Emulation

Useful as a secondary PC-side troubleshooting reference, especially for configuration, save paths, wrappers, and game-specific PC behavior. Its own emulation material can lag current upstream projects, so freshness matters.

---

## Download trap checklist

When evaluating a third-party page, do not ask only "does the website look professional?" Ask what the bytes and flow are doing.

### Strong positive signals

- The emulator project's own domain or GitHub organization links to the download.
- Release history and source/history are visible.
- The expected file type makes sense (`.zip`, portable executable package, AppImage, etc.).
- Published checksums/signatures match when upstream provides them.
- The archive contains the emulator you expected rather than a downloader stub.
- No unrelated browser extension, VPN, optimizer, crypto tool, or download manager is required.

### High-risk signals

- "Disable antivirus before downloading/running."
- A ROM/disc image is delivered as an `.exe`, `.msi`, `.scr`, browser extension, or "download manager."
- Password-protected archives with no technical reason for encryption.
- Several fake Download buttons or redirect chains before the actual file.
- The page impersonates an emulator project but the domain is unrelated.
- A repack claims to be "official" while upstream provides a normal release elsewhere.
- The installer bundles unrelated applications or requests administrator privileges without a clear emulator-specific reason.
- The payload filename/size/type materially differs from what the page promised.
- A tutorial tells you to globally disable Windows Defender/firewall rather than fixing a narrowly identified issue.

## Agent behavior when a player supplies a URL

The agent should be willing to say:

> The game acquisition itself is not something Nostalgia indexes, but I can inspect this page for technical/security warning signs and compare any emulator/tool it offers against its official upstream release.

Then actually help:

1. Identify what the player expects to receive.
2. Determine the normal file type/structure.
3. Locate the official emulator/tool project when applicable.
4. Inspect redirects, executable wrappers, domain mismatch, and suspicious requirements.
5. Hash/inspect local files if already downloaded.
6. Compare game bytes with metadata databases when useful.
7. Continue emulator setup rather than restarting an ownership discussion.

## Source contribution rule

A new Nostalgia source entry should answer:

- Who maintains it?
- Is it official, reference, community, or secondary?
- What should players trust it *for*?
- What should they **not** trust it for?
- Does it link to binaries, metadata, or merely documentation?
- Is there a more authoritative upstream source for the same thing?

Do not add commercial ROM/BIOS download indexes to the shared registry. A player-supplied third-party URL can still be evaluated case by case under `docs/HELP-BOUNDARY.md`.
