# Game, Firmware, and Content Handling

Nostalgia treats game data, firmware, emulator binaries, saves, and configuration as separate classes of bytes because they fail differently and deserve different handling.

## Shared-repository rule

Keep the repository focused on **recipes, metadata, references, diagnostics, and reproducible setup knowledge**.

Local game images, firmware dumps, keys, personal saves, and one-off downloaded binaries should stay outside git by default. Prefer recording:

- hashes and content identities;
- region/revision metadata;
- expected file/track/archive structure;
- emulator/tool version;
- source/reference URL;
- required configuration;
- symptoms, fixes, and validation evidence.

This makes a setup reproducible without making the repository itself responsible for storing everybody's local library.

## When the player already has bytes

Help inspect them.

Useful checks include:

- expected file type and archive layout;
- region/revision and game identity;
- hash comparison;
- malformed/incomplete dumps;
- missing disc tracks or broken cue sheets;
- unexpected executable wrappers;
- archive contents before execution;
- antivirus/security scan results;
- whether an emulator binary matches the real upstream project;
- whether two multiplayer peers actually have matching content.

The question is usually: **will these bytes work, and are they safe to handle?** Answer that question directly.

## Third-party source triage

When a player supplies a download page, separate the expected payload from the delivery mechanism.

Warning signs include:

- an `.exe`, `.msi`, `.scr`, browser extension, or download manager for content that should normally be a data image/archive;
- multiple fake or redirecting Download buttons;
- forced browser extensions or unrelated software;
- unexpected password-protected archives;
- a payload whose name/type changes after redirects;
- an emulator repack when a current official release exists;
- instructions to globally disable antivirus/firewall;
- a file whose checksum or internal structure does not match what it claims to be.

Use `docs/TRUSTED-SOURCES.md` and `catalog/sources.json` to find higher-signal references and official emulator/tool sources.

## Hashes are identities

A hash is useful evidence that two files are or are not the same bytes.

Use hashes for:

- revision matching;
- comparing multiplayer peers;
- bad-dump investigation;
- documenting a known-good session;
- confirming whether a downloaded file changed beneath the same filename.

A hash alone does not prove that an executable is trustworthy; source provenance, signatures when available, file structure, and security tooling still matter.

## Preserve originals

Prefer a structure like:

```text
library/
  originals/      # read-only or treated as immutable
  working/        # emulator-facing copies/conversions
  firmware/       # local runtime material
  saves/          # player state
  snapshots/      # pre-change backups
```

Game conversion/compression should operate on working copies when possible.

## Local ignore policy

The repository `.gitignore` intentionally excludes common game-image, firmware-ish, save, and local-library paths as a backstop. This is not a substitute for contributor judgment.
