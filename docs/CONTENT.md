# Game, Firmware, and Content Sources

Nostalgia separates **software that can be redistributed/downloaded freely** from **player-owned copyrighted console/game data**.

## What Nostalgia may link directly

Recipes may link directly to:

- official emulator releases;
- emulator documentation;
- open-source helper tools;
- homebrew/public-domain games from their legitimate authors/distributors;
- games or firmware intentionally released for free by the rightsholder;
- preservation databases that provide metadata/checksums rather than unauthorized game bytes;
- documentation showing how to dump media/hardware the player owns where lawful.

## What Nostalgia does not provide

Do not place links in this repository whose purpose is obtaining unauthorized copies of:

- commercial ROM/cartridge dumps;
- ISO/disc images;
- console BIOS images;
- boot ROMs;
- proprietary HDD/EEPROM/firmware images;
- encryption/decryption keys;
- DLC or title-update packages that are not legitimately redistributable.

The fact that a file is easy to find online does not make it an appropriate Nostalgia source.

## How the agent should help instead

When restricted content is required, explain **what** is missing and how to identify it without pretending the repository supplies it.

Example:

```text
xemu needs console data in addition to the game image.
Your current setup is missing the MCPX/flash/HDD material required by xemu.
Use xemu's official documentation to determine the required files and obtain them from hardware/data you are entitled to use.
Once supplied, Nostalgia can verify paths/hashes and continue configuration.
```

The agent may help organize, hash, verify, copy, and back up files the user already supplies.

## Hashes are identities, not download instructions

Recipes may eventually contain known hashes for revisions/known-good player dumps when the metadata itself is lawful to publish. A hash means:

> "This recipe was validated against bytes with this identity."

It does not mean:

> "Search the Internet for a file with this hash."

## Preserve originals

Prefer a structure like:

```text
library/
  originals/      # read-only or treated as immutable
  working/        # emulator-facing copies/conversions
  firmware/       # user-supplied; never committed
  saves/          # user state
  snapshots/      # pre-change backups
```

Game conversion/compression should operate on working copies when possible.

## Local ignore policy

The repository `.gitignore` intentionally excludes common game-image, firmware-ish, save, and local-library paths as a backstop. This is not a substitute for contributor judgment.
