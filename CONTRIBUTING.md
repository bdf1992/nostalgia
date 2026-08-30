# Contributing to Nostalgia

Nostalgia should grow from **reproducible play evidence**, not giant scraped compatibility tables.

## Good contributions

Useful contributions include:

- a new game recipe;
- a corrected emulator/runtime source;
- a tested multiplayer path;
- a controller mapping that fixes a real issue;
- a networking symptom + repair;
- a save/identity warning;
- a machine-specific workaround clearly marked as such;
- a trustworthy source/reference entry;
- a documented download trap or repack warning;
- a small helper that removes repeated manual setup.

## Keep local bytes local by default

Do not commit game images, firmware dumps, keys, personal saves, or ad-hoc downloaded binaries simply because they were useful during a local session.

Prefer:

- official emulator/tool URLs;
- checksums and release/revision metadata;
- exact versions;
- reproducible setup instructions;
- symptoms and fixes;
- evidence that can be shared without copying the underlying game/firmware bytes.

Vendor an emulator/tool binary only when redistribution, provenance, updating, and security implications have been intentionally reviewed.

## Recipe evidence

Every recipe should identify:

1. title and platform;
2. intended player count/mode;
3. preferred runtime;
4. multiplayer strategy;
5. required content/firmware shape;
6. current validation state;
7. evidence URLs or local test notes supporting important claims;
8. known failure modes when discovered.

## Validation states

- `stub`: placeholder only.
- `candidate`: researched enough to attempt.
- `validated`: a complete playable session has been observed.
- `known-good`: the same route has been reproduced across multiple sessions or environments.
- `broken`: a previously expected route currently fails under recorded conditions.

A documentation link can justify `candidate`; it cannot by itself justify `validated`.

## Test note format

When you actually play something, record a compact note like:

```text
Game: Halo 2 (Xbox)
Runtime: xemu <version>
Transport: XLink Kai / bridged adapter
Players: 2 remote
Content: matching region/revision
Result: PLAYABLE
Issues: duplicate virtual MAC prevented joining
Fix: generated unique xemu EEPROM/MAC identity
Date: YYYY-MM-DD
```

Do not publish private IPs, account credentials, device identifiers, or other unnecessary personal information.

## Pull requests

Keep PRs small when possible. A good title is concrete:

- `recipe: validate Halo 2 xemu + XLink path`
- `runtime: update Dolphin download guidance`
- `source: add Redump identity reference`
- `doctor: detect duplicate xemu MAC identity`

In the PR body say:

- what changed;
- what was actually tested;
- what remains uncertain;
- whether any user state/security behavior changed.

## Source best practices

Source entries should say what a site is trustworthy **for** rather than calling it globally trusted.

- Prefer official project pages/releases for emulator and helper binaries.
- Use checksum/reference databases for identity, not as binary sources.
- Treat community wikis as useful technical orientation that can still be stale or wrong.
- Do not mirror installer URLs without a reason.
- Avoid pinning a `latest` hash as though it will never change.
- When a third-party source caused a real problem, record the recognizable failure mode rather than a vague accusation.
- Keep the source registry focused on high-signal knowledge; do not turn it into a giant link directory.

## Player protection findings

A useful safety finding is concrete and reproducible. Examples:

- an emulator repack inserted an unrelated installer;
- a download button redirected to a different domain/payload;
- a supposed ROM/archive arrived as an executable wrapper;
- a file had the correct filename but the wrong checksum/revision;
- an archive was missing expected disc tracks;
- a guide required a broad firewall/antivirus disable when a narrow rule worked instead.

Record the symptom, expected shape, safer path, and evidence. Avoid moralizing; help the next player recognize the trap quickly.

## Troubleshooting best practices

- Prove local boot before networking.
- Prove unique controller slots before blaming the game.
- Check runtime/content version parity before router configuration.
- Prefer traversal/match-code/tunnel facilities over opening router ports manually when the supported tool provides them.
- Never recommend disabling the firewall globally as a fix.
- Back up mutable save/identity/config state before experimenting.

## Design rule

Keep the shared schema small enough that a human can add a game by hand. Add structure only when real recipes repeatedly need it.
