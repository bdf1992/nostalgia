---
name: nostalgia
description: Study existing games and a player's intended experience to create and evaluate mods, live changes, expansions, remakes, or combinations of games. Also supports classic-game compatibility and multiplayer setup.
---

# Nostalgia

Help the player make the game they want to play. A request may change a running
game, create a new adventure, combine several games, or sustain a production
through many playable releases. Do not reduce these requests to emulator setup
or a catalog of supported titles.

## Current capability

This repository supplies compatibility catalogs, recipes, a PowerShell helper,
game-table inspection/comparison, toolchain inspection, and read-only REA-SON
checkpoint design-context queries through CLI and MCP. Generation, game-data
mutation, archive extraction, and live-change adapters are not implemented. Use tools actually available in the session;
state missing capabilities precisely. Instructions are not implementation proof.

For studying and creating games, read [the game-study guide](docs/GAME-STUDY.md).
For extracted mechanics tables, read [the CLI/MCP tool guide](docs/GAME-TABLES.md).
For design questions using retained SON study, read
[design-context retrieval and discussion](docs/DESIGN-CONTEXT.md).
For compatibility and multiplayer work, read
[the existing compatibility guidance](docs/COMPATIBILITY-SKILL.md). Paths in that
guidance are relative to the repository root. Use only the relevant guidance.

## Principles

### Study the request and its references

Establish the intended playable experience, what the player values in each
reference game, and what should differ. Use session context before asking again.
Record unresolved choices without silently substituting an engine, game edition,
feature list, or smaller project. Start independent work while those choices remain open.

A named game is not a complete specification. Study the relevant controls,
mechanics, pacing, progression, presentation, and world behavior. Convert vague
requests into concrete candidate interpretations that the player can judge.

### Follow evidence through the game

Identify the exact game edition, content, mods, runtime, and saves involved.
Reuse existing findings when their identities match. Begin with questions and
the smallest useful inventory; deepen investigation where a specific gap remains.

Observe gameplay where behavior matters and inspect implementation where its
cause matters. Trace from player action through rules, state changes, and feedback.
Preserve source locations, versions, measurements, and coverage limits. Separate
observed, derived, and inferred claims; missing coverage stays unknown.

Use REA for supported shipped-artifact or runtime investigations when available.
Use normal source tools for source repositories. Do not duplicate analysis engines
or run setup merely because a game-study request mentions reverse engineering.

### Design the requested differences

For speculative requests, retrieve relevant named systems, design principles,
evidence, and open questions through `query_design_context` when a SON checkpoint
is available. Its matching is literal and its graph boundary is finite; follow
relevant neighboring identities and distinguish missing coverage from absence.
Supplied evidence labels and checksums do not authenticate claims or establish
their freshness. Discuss alternatives and consequences, recommend a design with
reasons, and propose a playable comparison before turning the idea into code.
Retain creative decisions separately from source behavior and inferred intent.

Mark relevant source behavior as preserve, adapt, replace, or newly create.
Trace dependencies before altering it: controls can affect animation, targeting,
collision, enemy behavior, encounter design, balance, and persistence.

Choose reuse, conversion, reconstruction, or original production by their ability
to deliver the requested result. Do not require a universal intermediate format
or destination engine before its need is established. Record design choices
separately from facts about the source games.

### Produce with explicit state and recovery

Keep source material separate from working changes. Identify which provider owns
each read, write, generated artifact, build, and running session. Record artifact
lineage and the conditions needed to reproduce a build.

For a live request, determine whether the target supports immediate application,
a safe application point, reload, or restart. Verify the changed behavior and the
recovery path. Preserve the player's current progress; do not silently attach to
a different process, change a shared server, or expand the requested action.

Distinguish a one-time state write, a maintained runtime override, and a persistent
rule or data change. Stopping an override need not restore state that changed
during play. Bind any future runtime operation to the exact process or emulator,
game revision, and verified state interpretation; a remembered address is not
enough. The current table tools do not perform runtime reads or writes.

### Judge through evidence and play

Check preserved behavior against source observations and intentional differences
against the request. Inspect the actual build. Record technical checks and player
judgment separately; booting, compiling, or installing proves neither gameplay
quality nor completion. Obtain independent judgment for material quality claims.

For extended projects, retain playable milestones, dependencies, decisions,
contradictions, and unfinished work. Evaluate general capability with distinct
creative briefs and held-out requests, not only familiar games or rehearsed demos.

## Completion and boundaries

Finish at the requested playable result or milestone with its evidence and recovery
state recorded. Name unverified behavior and work that remains. A design draft,
missing provider, or failed playtest must not be reported as a finished game.

Follow [repository authority and preservation rules](AGENTS.md). Keep local game
bytes, firmware, keys, and personal saves out of shared outputs by default. Tools
and skills are the distributed product; that packaging choice does not itself
establish redistribution rights or authority over a remote game service.
