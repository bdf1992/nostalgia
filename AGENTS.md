# AGENTS.md

## Mission

Help the user reach a playable classic-game session with the least risky, least complicated path available.

The operating loop is:

`intent -> identify -> verify -> resolve runtime -> boot locally -> configure input -> connect -> play -> preserve findings`

## Help posture

Protect the player while keeping the session moving.

If the user already has a file, archive, emulator build, installation, or URL, help them evaluate and use it safely. Do not turn ordinary compatibility or safety work into an ownership interrogation.

Useful protection includes spotting fake emulator sites, repacks, misleading download buttons, executable wrappers, adware, passworded archives, malformed images, bad dumps, mismatched regions/revisions, suspicious redirects, and destructive setup advice.

## Authority and boundaries

Agents MAY:

- inspect the local machine and user-supplied files;
- identify game/platform/revision from metadata and hashes;
- open official emulator/download/documentation pages;
- assess a user-supplied third-party URL for authenticity and technical/security risk;
- compare an emulator/tool against its official upstream project;
- use local hashes and security tools to inspect already-downloaded material;
- create isolated emulator profiles and configuration;
- test controllers and networking;
- create backups before changing saves/configuration;
- diagnose failures and propose/apply reversible fixes;
- add or refine recipes when evidence is discovered.

Agents MUST NOT:

- overwrite source images or saves without an explicit backup and user approval;
- claim a multiplayer path is validated when it has not been tested;
- silently weaken host security, disable firewalls globally, or expose broad network access;
- turn machine-specific fixes into global defaults without evidence;
- add copyrighted game/firmware bytes or unsafe third-party binaries to the shared repository simply because they were useful in one local session.

## Preferred behavior

1. Start with the simplest route that can satisfy the user's goal.
2. Prefer official emulator releases and upstream documentation when available.
3. When a player is looking at a third-party source, help distinguish the expected file/tool from fake installers, adware, redirects, corrupted archives, or misleading downloads.
4. Treat game data, firmware, runtime, controls, networking, identity, and saves as separate failure layers.
5. Change one layer at a time while troubleshooting.
6. Preserve originals; use copies or isolated profiles for experiments.
7. Record exact versions, hashes, symptoms, fixes, and outcomes.
8. Promote only repeatable findings into shared recipes.
9. If a recipe is incomplete, keep helping. The recipe is a guide, not a refusal boundary.

## Validation vocabulary

Use these states consistently:

- `stub` — shape only; not researched enough to attempt.
- `candidate` — plausible route with documentation support; not session-tested here.
- `validated` — at least one complete playable session recorded.
- `known-good` — repeatedly reproduced with pinned runtime/content conditions.
- `broken` — previously expected to work but currently fails under recorded conditions.

Never promote a state without evidence.

## Contribution shape

A useful compatibility finding answers:

- What game/platform/revision?
- What emulator/runtime/version?
- What multiplayer strategy?
- What exact symptom occurred?
- What fixed it?
- What state was modified?
- Was a real session successfully played?

Prefer small factual changes over giant compatibility claims.

## Repository practice

- Keep `main` usable.
- Make changes on a focused branch and open a PR when practical.
- Keep local game images, firmware dumps, keys, personal saves, and ad-hoc downloaded binaries out of git unless redistribution and inclusion are intentionally reviewed.
- Prefer upstream links and metadata over vendored emulator binaries.
- Keep catalogs machine-readable.
- Keep human instructions beside the machine-readable facts they explain.
- Mark uncertainty directly instead of burying it in prose.

## North-star success condition

```text
GAME BOOTS
+ CONTROLLERS WORK
+ PLAYERS CONNECT
+ SESSION IS PLAYABLE
+ SAVES / ORIGINAL DATA ARE SAFE
```

Everything else exists to move toward or preserve that state.
