# REA SON acceptance journey for Nostalgia

Bdo's ARPG is the first personal destination. The first shared demonstration is
one combat interaction: begin a cast, request movement, and observe the result.
REA-SON should retain an explanation that can be tested and revised. Nostalgia
should use that explanation to produce a playable scene and evaluate a requested
change. A working scene is a milestone toward the ARPG.

Status: proposed acceptance journey. Source experiments, behavioral comparison,
and the playable reconstruction have not run. The source edition, skill, and
destination engine remain open. Godot is provisioned as a candidate scene runtime;
it is not selected as the final ARPG engine.

## The player journey

Before investigation, [admit the local baseline](BASELINE-EVALUATION.md): preserve
the target state, run the unchanged local replica, restore fresh state, and repeat
the declared checks. This target checkpoint is separate from SON's ledger.

| Stage | Player experience | Required result |
| --- | --- | --- |
| Describe the experience | Select the combat qualities to retain and one control change to try | A bounded brief with creative decisions separated from source observations |
| Study the interaction | Play or replay the interaction and inspect what affects it | Named targeting, casting, movement, animation, resources, and damage relationships with evidence and unknowns |
| Resolve an uncertainty | See competing explanations and a proposed separating experiment | Predictions retained before the run, followed by observations and contradictions |
| Try a reconstruction | Play a small scene that reproduces the selected behavior | Comparable source and scene scenarios, with declared tolerances and measured differences |
| Change a rule | Try movement during casting if the baseline restricts it | Requested behavior checks plus checks for the qualities being retained |
| Continue later | Reopen the project or change a build | Retained decisions and evidence, with affected conclusions and checks identified |

The player should be able to revise the brief after playing. That revision is a
new creative decision; it must remain distinguishable from a discovery about the
source game.

## A knowledge graph for design discussion

Nostalgia needs a knowledge graph that connects the studied game to design
decisions and their consequences. Bdo can ask through MCP how a first-person
Diablo would work, and the agent should use that retained understanding to discuss
options, form a design, and test it. Code production follows the design decision.

Connect named mechanics, player actions, encounters, assets, presentation,
progression, and constraints to observed behavior and player outcomes. Include
design principles with their scope and supporting basis: documented designer
statements, repeated observations, established design references, or explicit
interpretations. A plausible explanation of a mechanic does not establish the
original designer's intent.

Relationships must explain why they matter. For example, a camera can affect
visible threats, which can affect encounter decisions. That relationship is a
testable hypothesis until supported for the selected game and conditions. Each
relationship needs stable identity, evidence or hypothesis status, applicable
build and conditions, counterevidence, and revision history. A general design
principle does not automatically establish its application to Diablo.

The graph should let an MCP client:

- Find the systems and player outcomes relevant to a proposed change.
- Follow the evidence behind a claimed principle or dependency.
- Distinguish source behavior, inferred intent, player preference, and a new
  creative decision.
- Trace likely consequences, competing explanations, and unanswered questions.
- Compare design alternatives and the tests that could distinguish them.
- Return playtest results and revise the design without losing earlier reasoning.

These are capability requirements; tool names, graph storage, and schemas remain
open. A collection of tagged assets or a graph of code references alone cannot
answer the design questions. Retrieval must return the relevant evidence,
uncertainty, and conditions with the relationships.

## First person Diablo as a design conversation

Treat a first-person reinterpretation as a second acceptance scenario for the
same retained study, rather than immediately changing the camera. Begin with
which qualities Bdo wants to preserve and which experience the new perspective
should create. Source study must establish the relevant qualities of the chosen
Diablo build; the following are questions, not conclusions about its design.

| Design question | Study and proposed comparison |
| --- | --- |
| How does the player notice and prioritize threats? | Observe visibility and decisions in a selected encounter; compare candidate warning, audio, and camera approaches |
| How should aiming and target selection work? | Study target acquisition and skill resolution; compare direct aim, assistance, and retained target selection |
| What happens to crowd combat and enemy density? | Trace spatial awareness, movement, attack reach, and enemy behavior; test encounter alternatives |
| How do loot and ground effects stay readable? | Study detection and selection; compare presentation and interaction choices |
| Which aspects of builds and combat pacing should survive? | Identify selected progression and resource interactions; measure their behavior in the proposed controls |

The agent returns a design proposal with the desired experience, preserved
qualities, alternatives, expected consequences, evidence, assumptions, and a
small playable experiment. It recommends one alternative with reasons and
retains rejected alternatives where they explain a tradeoff. Bdo can challenge
the rationale or change the brief before production.

Technical checks establish that the chosen rules work. Playtests determine
whether the resulting encounter supports the intended experience. Feed both
results into the graph: a mechanically correct change can still require a design
revision. The acceptance result is a reasoned proposal and an evaluated playable
slice, not merely modified camera code.

Discussion can begin with incomplete study. The agent should explain which
conclusions are grounded and which need investigation, then gather the evidence
that matters to the decision. A complete reconstruction is not a prerequisite
for creative exploration. Connections to other games should name the relevant
mechanic and reason for borrowing it, with its source evidence and intended
adaptation, rather than treating a franchise name as a design specification.

## First experiment

Use a selected runnable source build and a repeatable encounter with one actor,
one ability, and one stationary target. Pin the build, configuration, equipment,
ability, starting positions, resource values, and relevant network conditions.
Record the reset procedure and input delivery method. A synthetic fixture can
exercise the measurement tools, but cannot establish Diablo II behavior.

Keep these candidate explanations open until the observations distinguish them:

- Movement cancels the cast before its effect occurs.
- Movement is deferred until casting or recovery finishes.
- Movement begins while casting continues.

Run a no-movement baseline, then vary the movement request's timing before the
effect, around the effect, and during recovery. Determine those phases from
observations rather than assuming their duration. Record the actual delivered
inputs; intended input timing alone is insufficient. Repeat ambiguous cases and
report variation. An additional explanation may be needed if none predicts the
trace.

Measure action order, actor position, animation transitions, resource changes,
effect time and position, damage, and final state. Keep simulation time and
wall-clock time distinct. Declare units, measurement resolution, tolerances, and
unobservable values before using a comparison to claim agreement.

## Reconstruction and requested difference

The baseline scene uses the same starting conditions and action scenarios.
Compare observable behavior within the declared scope. Visual similarity and a
successful launch cannot substitute for this comparison.

If the source restricts movement, the proposed difference allows it during the
selected casting phase. If no restriction is observed, retain that finding and
choose another meaningful control difference with Bdo. Do not manufacture a
source restriction to make the demonstration pass.

Before producing the changed scene, decide whether movement changes targeting,
effect origin, interruption, animation blending, resource cost, or collision.
Record each as a design choice or an unresolved question. Checks must cover:

- The requested movement occurs in the selected phase.
- The effect and resource cost occur the intended number of times.
- Damage, targeting, and effect origin follow the chosen rules.
- Selected preserved qualities still pass their baseline checks.
- Reverting the scene restores the accepted baseline behavior.

Classify differences as requested, unexplained, or outside the measured scope.
An unexplained change is work to investigate even when the scene feels better.
Bdo evaluates control feel; an independent reviewer checks the evidence and
technical acceptance. Record both judgments separately.

## Handoff between REA SON and Nostalgia

REA-SON owns the retained study: named parts, relationships, hypotheses,
experiments, evidence, contradictions, and behavioral contracts. Nostalgia owns
the creative brief, asset preparation, implementation, builds, application of
changes, recovery, and player evaluation. Source and destination adapters provide
reset, input delivery, observation, and artifact identity for their respective
targets.

The fork should supply general graph capabilities for evidence, relationships,
revisions, competing explanations, and dependency queries. Nostalgia supplies
game design concepts, references, creative decisions, and player evaluation.
Connect those records through retained identities so the agent can reason across
implementation, design, and experience without duplicating the underlying study.

The handoff must identify the studied build, relevant named systems, evidence,
unresolved questions, setup and actions, observable outcomes, units and
tolerances, invariants, and adapter bindings. Nostalgia adds the requested
differences and preserved qualities, then returns build identities, scenario
traces, defects, and player feedback. This is a consumer requirement, not a new
wire schema or a claim that these operations are implemented.

Assets need their original and converted identities, producing tool and version,
gameplay role, and dependencies such as palettes, rigs, animation timing, and
transitions. Changed source assets or builds identify dependent conclusions for
rechecking; an unchanged filename does not establish unchanged content.

## First release and later live changes

The first release is a resettable playable scene with baseline and changed
variants, recorded scenarios, comparisons, unresolved gaps, and player feedback.
The next release adds a request made during play, an explicit application
boundary, and observed recovery. State writes, maintained overrides, and persistent
rule changes have different lifetimes and must be evaluated separately.

Record time to the first playable result, human interventions, experiment reruns,
unexplained differences, interruption to play, and recovery failures. Report each
measure with its scenario and build. These measures evaluate this interaction;
they do not establish support for a whole franchise or the ten-project suite.

Current Nostalgia operations inspect tables and tool identities and
[query retained SON design context](DESIGN-CONTEXT.md). The query is a read-only
snapshot consumer; source observation and design discussion remain agent work.
Missing work for this journey includes broader retained graph indexing and
retrieval, source gameplay observation, reset/input adapters, trace comparison,
semantic animation decoding where needed, and scene production.
The first priority is a repeatable source interaction and its measurement path;
without that evidence, a reconstruction cannot pass the behavioral acceptance.

## Relationship to the fork draft

This journey follows the local REA-SON draft inspected on 2026-10-10 at
`son/user-journey.json`: study an interaction, predict, observe, revise the named
explanation, reconstruct, deliberately change a rule, and continue across builds.
The draft lives in the separate REA-SON checkout. Keep fork implementation work
there and update these consumer requirements when the accepted journey changes.

See [game study principles](GAME-STUDY.md) and
[provisioned providers and their limits](TOOLCHAIN.md).
