# Game, Firmware, and Content Sources

Nostalgia separates **what the repository itself distributes or links as a maintained source** from **what technical help the agent can provide to a player**.

Those are intentionally different boundaries.

## Repository/source boundary

Recipes may directly link to:

- official emulator releases;
- emulator documentation;
- open-source helper tools;
- homebrew/public-domain games from their legitimate authors/distributors;
- games or firmware intentionally released for free by the rightsholder;
- preservation databases that provide metadata/checksums rather than unauthorized game bytes;
- documentation about dumping/conversion workflows.

Nostalgia itself should not host, mirror, bundle, or maintain direct acquisition links whose primary purpose is obtaining unauthorized copies of:

- commercial ROM/cartridge dumps;
- ISO/disc images;
- console BIOS images;
- boot ROMs;
- proprietary HDD/EEPROM/firmware images;
- encryption/decryption keys;
- DLC or title-update packages that are not legitimately redistributable.

This is a project distribution rule. It is not a requirement that a user prove where every local byte came from before receiving technical help.

## How the agent should help

If the user already has a file, archive, image, firmware file, emulator build, installation, or source URL, continue helping.

The agent may:

- identify expected formats and file layouts;
- hash files and compare identities/revisions;
- identify malformed or incomplete dumps;
- diagnose missing tracks/cue-sheet problems;
- distinguish ROM/disc content from suspicious executable wrappers;
- inspect archive contents before execution;
- assess a supplied site or URL for malware/adware/fake-download risk;
- prefer an emulator's official project when a safer upstream build exists;
- help use local antivirus/security tools to scan already-downloaded material;
- organize, convert, copy, or back up local content;
- continue emulator, controller, save, and multiplayer troubleshooting regardless of provenance.

Do not ask for proof of ownership as a prerequisite to ordinary technical support.
Do not repeatedly redirect a player to dumping instructions when their actual question is whether a file, emulator build, or website looks unsafe or incompatible.

## Third-party source triage

For a user-supplied download page, separate two questions:

### Is the software/content technically plausible?

Check expected file type, archive shape, region/revision, naming, size when known, and hashes when available.

### Is the delivery path suspicious?

Warning signs include:

- an `.exe`/`.msi` wrapper for content that should normally be an image/archive;
- multiple fake or redirecting download buttons;
- forced browser extensions or download managers;
- unexpected password-protected archives;
- unrelated bundled software;
- a payload whose name/type changes after redirects;
- antivirus/security detections;
- an emulator repack when an official upstream release exists.

A user asking "is this ROM/emulator site sketchy?" should get practical safety help, not an ownership interrogation.

## Hashes are identities

Recipes may contain hashes for revisions and known-good test content when the metadata itself is appropriate to publish. A hash means:

> "This recipe was validated against bytes with this identity."

Hashes are useful for detecting bad dumps, region/revision mismatches, and changed files.

## Preserve originals

Prefer a structure like:

```text
library/
  originals/      # read-only or treated as immutable
  working/        # emulator-facing copies/conversions
  firmware/       # local; never committed
  saves/          # user state
  snapshots/      # pre-change backups
```

Game conversion/compression should operate on working copies when possible.

## Local ignore policy

The repository `.gitignore` intentionally excludes common game-image, firmware-ish, save, and local-library paths as a backstop. This is not a substitute for contributor judgment.

See `docs/HELP-BOUNDARY.md` for the default interpretation of what the agent may help with.
