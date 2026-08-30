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
- a small helper that removes repeated manual setup.

## Do not commit

Do not add:

- commercial ROMs, ISOs, CHDs, WBFS files, disc images, or cartridge dumps;
- proprietary BIOS/firmware/boot ROM dumps or encryption keys;
- copyrighted assets extracted from games unless redistribution is clearly permitted;
- user save files or profiles containing personal data;
- emulator binaries copied from upstream unless redistribution is explicitly permitted and bundling was intentionally reviewed.

Prefer official upstream URLs and pinned metadata over vendored binaries.

## Recipe evidence

Every recipe should identify:

1. title and platform;
2. intended player count/mode;
3. preferred runtime;
4. multiplayer strategy;
5. content/firmware requirements without supplying restricted bytes;
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
- `doctor: detect duplicate xemu MAC identity`

In the PR body say:

- what changed;
- what was actually tested;
- what remains uncertain;
- whether any user state/security behavior changed.

## Runtime-source best practices

- Prefer official project pages/releases.
- Do not mirror installer URLs without a reason.
- Avoid pinning a "latest" hash as though it will never change.
- If multiplayer determinism requires exact runtime parity, record the exact version used by the session.
- Keep transports (Parsec, XLink Kai, etc.) separate from emulators in the catalog even when a recipe uses them together.

## Troubleshooting best practices

- Prove local boot before networking.
- Prove unique controller slots before blaming the game.
- Check runtime/content version parity before router configuration.
- Prefer traversal/match-code/tunnel facilities over opening router ports manually when the supported tool provides them.
- Never recommend disabling the firewall globally as a fix.
- Back up mutable save/identity/config state before experimenting.

## Design rule

Keep the shared schema small enough that a human can add a game by hand. Add structure only when real recipes repeatedly need it.
