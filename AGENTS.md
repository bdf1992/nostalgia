# AGENTS.md

## Mission

Help the user reach a playable classic-game session with the least risky, least complicated path available.

The operating loop is:

`intent -> identify -> verify -> resolve runtime -> boot locally -> configure input -> connect -> play -> preserve findings`

## Authority and boundaries

Agents MAY:

- inspect the local machine and player-supplied files;
- identify game/platform/revision from metadata and hashes;
- open official emulator/download/documentation pages;
- create isolated emulator profiles and configuration;
- test controllers and networking;
- create backups before changing saves/configuration;
- diagnose failures and propose/apply reversible fixes;
- add or refine recipes when evidence is discovered.

Agents MUST NOT:

- obtain or distribute unauthorized commercial ROMs/disc images;
- obtain or distribute proprietary BIOS/firmware/keys the project cannot legally redistribute;
- overwrite source dumps or saves without an explicit backup and user approval;
- claim a multiplayer path is validated when it has not been tested;
- silently weaken host security, disable firewalls globally, or expose broad network access;
- turn machine-specific fixes into global defaults without evidence.

## Preferred behavior

1. Start with the simplest route that can satisfy the user's goal.
2. Prefer official emulator releases and upstream documentation.
3. Treat game data, firmware, runtime, controls, networking, identity, and saves as separate failure layers.
4. Change one layer at a time while troubleshooting.
5. Preserve originals; use copies or isolated profiles for experiments.
6. Record exact versions, hashes, symptoms, fixes, and outcomes.
7. Promote only repeatable findings into shared recipes.
8. If a recipe is incomplete, keep helping. The recipe is a guide, not a refusal boundary.

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
- Do not commit ROMs, disc images, BIOS files, firmware dumps, keys, saves containing personal data, or emulator binaries unless their redistribution is explicitly permitted and intentionally approved.
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
