# Studying games and requests

This is the operating design for Nostalgia's creation capabilities. It does not
describe tools already implemented. The first personal project is Bdo's ARPG:
a personal take on Diablo II, potentially using controls and mechanics informed
by Diablo III, Diablo IV, Path of Exile, and Path of Exile 2. The source edition,
destination engine, and selected mechanics remain open.

## What carries over from REA

REA provides shared CLI/MCP operations over analysis providers. Its investigations
retain artifact identity, source evidence, coverage, and unknowns. Its skill
starts broader work with questions and evidence requirements, reuses matching
findings, and follows relevant relationships rather than prescribing one universal
investigation sequence.

| REA principle | Nostalgia translation |
| --- | --- |
| Route by artifact and question | Route by game identity, creative request, and the capability needed |
| Provider-neutral operations | Shared game-study and production operations over game, engine, and generation adapters |
| Static facts do not prove execution | Assets and scripts do not prove gameplay; observe relevant behavior |
| Preserve observed, derived, inferred, and unknown claims | Keep source facts, interpretations, design choices, and missing knowledge distinct |
| Trace relationships with source evidence | Trace player actions through mechanics, state, presentation, and persistence |
| Compare identified artifacts and captures | Compare source behavior, intended changes, and an identified playable build |
| Close reconstruction requirements with matching verification | Prove preserved behavior and requested differences with appropriate checks and playtests |
| Shared CLI/MCP semantics | Both interfaces must use the same state, operations, results, and failure meanings |

Sources inspected on 2026-10-10:
[REA repository rules](https://github.com/morluto/rea/blob/main/AGENTS.md),
[investigation skill](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md),
[architecture](https://github.com/morluto/rea/blob/main/docs/architecture.mermaid),
[tool design](https://github.com/morluto/rea/blob/main/docs/tool-design.md), and
[reconstruction verification](https://github.com/morluto/rea/blob/main/docs/reconstruction-obligation-ledgers.md).
These are source-design observations, not a live-server conformance test.

Nostalgia adds design and production. Equivalence to the original is not the goal
for every system. Intentional differences need their own acceptance criteria.

## An investigation record that supports decisions

Retain these facts in the project's existing records or a simple local record;
this is guidance, not a required new schema or orchestration language:

- Intended experience, requested deliverable or milestone, and unresolved choices.
- Exact source and destination identities, versions, configuration, and relevant saves.
- Questions about behavior, their supporting observations, and remaining coverage gaps.
- Decisions to preserve, adapt, replace, or create, with affected dependencies.
- Changed and generated artifacts, producing tools and versions, and build identity.
- Technical verification, playtest judgment, contradictions, recovery outcome, and next work.

Keep originals, working artifacts, and observations distinct. Refer to local
material by identity and path; do not copy private game libraries into shared
project records. Existing compatibility evidence remains useful for establishing
a baseline but cannot establish that a remake meets its creative brief.

## Bdo's ARPG: example investigation

Start by identifying what Bdo wants to retain from Diablo II and what the other
games contribute. Do not assume that naming Diablo IV selects its engine or
requests every one of its systems. Existing session intent establishes the
project; the specific combat and control choices still need study and feedback.

For a proposed movement change, investigate the relevant input handling, pathing,
turning, targeting, animation interruption, hit resolution, enemy response, and
encounter geometry. Compare like conditions where possible; retain differences
in character state, equipment, frame rate, and network conditions that affect
interpretation. Separate measured behavior from the explanation proposed for it.

If a dodge becomes part of the design, record which properties are intentional:
distance, recovery, resource cost, collision, interruption, and any invulnerability.
Trace consequences for enemy attacks, character builds, level geometry, and saves.
Verify those properties in the actual build, then playtest whether combat meets
the intended feel. A successful dodge implementation does not establish ARPG quality.

A request made during play uses the same study and acceptance principles. Determine
the actual application boundary, preserve progress, apply within the authorized
session, observe the result, and record whether reversal restored the relevant state.
Do not promise immediate application of changes that need a reload or rebuild.

## Evaluation projects

The evaluation unit is a creative project, not a supported title. The proposed
ten-project suite ranges from an approximately one-hour change to a sustained
production involving several games. Scope labels describe intended workloads,
not validated delivery estimates. The candidate briefs from discussion are:

1. A combat change requested during play.
2. A Mario adventure with new movement and level design.
3. A Minecraft mod implementing a player-directed mechanic.
4. A Diablo II adventure contributing to Bdo's ARPG.
5. A Halo reinterpretation with a changed gameplay premise.
6. A zombie game informed by Resident Evil and Dead Rising.
7. A GMod-style sandbox with composable creation tools.
8. A new game combining San Andreas and Vice City.
9. An MMO reinterpretation informed by World of Warcraft.
10. An Elder Scrolls collection developed through successive connected projects.

These are candidate evaluations, not completed briefs or implemented support.
Pin each brief's inputs and requested result before a measured run. Retain the
actual tools, interventions, time to a playable result, interruption to play,
defects, recovery, and player judgment. Keep some requests out of development.
An independent player or reviewer evaluates the result against the brief.
Unsupported cases remain visible; one working case cannot justify support for
an entire game, franchise, or class of request.

Long projects are evaluated through playable releases and retained continuity:
whether later changes preserve prior accepted behavior and whether unresolved
dependencies remain visible. A collection launcher, cross-game content port,
and unified world are different results; declare which a milestone attempts.
