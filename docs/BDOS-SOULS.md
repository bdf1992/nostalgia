# Bdo's Elden Ring project

The first major source target is Elden Ring, with Nightreign as both a source
and a reference for changing the game's wider structure. Diablo II may supply
additional design material. The ARPG direction remains open: camera, destination
engine, loot rules and campaign structure have not been selected. The
[project record](../catalog/bdos-souls-project.json) retains that decision and the
unmeasured evaluation targets.

Nightreign reorganizes its experience around expeditions, constrained preparation
time, character roles and successive bosses. Study those interactions when
considering different progression or session rules; similarity alone is not a
design explanation.
[Official gameplay guide](https://www.bandainamcoent.com/games/nightreign/gameplay-guide).

## Work before the games finish downloading

Run the shared-operation rehearsal:

```powershell
npm ci
npm run rehearse:studio
```

It uses the repository's original Node fixture. It first verifies unchanged
baseline cases in separate copies, projects authored configuration into tables,
changes only damage from 25 to 35 in a working copy, and records the exact table
difference. Independent declared scenario expectations check the intentional
combat difference while preserving startup and save/load behavior. A fresh
restore checks the original combat result again. Receipts, checkpoint identities,
actual subprocess results and failure evidence remain in an ignored owned run.
The script exits nonzero on failure. It does not operate on Elden Ring,
Nightreign or Diablo, emulate their mechanics, or provide OS isolation.

For an explicit retained run, use `npm run rehearse:studio -- request.json` with
an absolute `run_root` whose parent already exists. An optional
`baseline_expectations.combat_target_hp` sets the declared fixture expectation;
75 passes, while 74 deliberately demonstrates refusal before variant creation.
Requests accept no arbitrary scenario, executable or source-game path.

The separate playable browser rehearsal is `npm run play:fixture -- --user`.
That checks the existing browser lifecycle and input/observation route. Neither
rehearsal proves a native game launches or establishes the quality of a remake.

## Selected Souls tools

Use pinned portable copies under the local Nostalgia toolchain, separate from
Steam installations. The Souls additions complement the existing ten general
providers; they do not replace that manifest or its inspection schema.

| Tool | Responsibility | Alternative and selection reason |
|---|---|---|
| [Smithbox](https://github.com/vawser/Smithbox) | Inspect/edit maps, parameters, models, materials and text | DSMapStudio is its predecessor; current upstream explicitly lists Elden Ring and Nightreign and links related format tools. GUI availability needs its own check. |
| [ME3](https://github.com/garyttierney/me3) | Launch mod profiles and instrument supported games | Mod Engine 2 is an older alternative. Smithbox recommends ME3 for modern games; pin and test the chosen game build before admitting a profile. |
| [WitchyBND](https://github.com/ividyon/WitchyBND) | Unpack/repack supported binders and serialize game formats | Yabber is its predecessor. Documented CLI and format support make it a candidate for repeatable authored archive tests. Top-level game archive access is a separate concern. |

Tool archives, extracted dependencies and operation receipts stay local.
The [Windows Souls lock](../catalog/souls.windows.lock.json) records the selected
release URLs, publisher archive digests and executable identities without local
paths. All three downloaded archives matched their publisher digests. ME3's CLI
and the two authored profiles parsed successfully; Smithbox is installed but its
GUI has not been launched. No external runtime installation was needed.

WitchyBND passed an original, uncompressed BND4 pack/unpack/repack test with two
members. A separate reviewer repeated the operation with Unicode names, all 256
byte values and an empty member, checking actual binder headers, member IDs,
flags, names and payload hashes. This tests an asset container operation before
commercial assets are involved.

The retained local recipe is `state/elden-tools-roundtrip.py`, with provisioning
receipts in `state/elden-tools-{me3,smithbox,witchybnd}.json`. It is a local test
carrier, not an installer or general MCP operation. Use a fresh owned run directory
when repeating it. Its sequence is `--passive --bnd --repack <authored-folder>`,
then `--unpack --location <first-unpack> <original.bnd>`, then repack the unpacked
folder and unpack that result into another directory. Before repacking, remove
the generated XML `sourcePath` and assign a different `filename`, so the original
container remains available for comparison. Require successful subprocesses and
identical member IDs, flags, full names and payload hashes; record container byte
equality separately. None compression is the only compression tested.

Witchy created its own new roaming configuration directory during initialization.
Its upstream startup may discover installed-game compression libraries; no Oodle
library copy was observed. The test is not evidence of process isolation.

Observed hashes are identities, not signatures. A passing synthetic archive
round-trip means the declared authored payload survived that operation; it does
not prove encrypted regulation data, compression dependencies or all game
formats are supported. Smithbox is not an unattended MCP editor simply because
its files are installed.

ME3 0.13.0's `profile create --savefile ...` dry run exits successfully but omits
the requested save name from its generated file. The
[pinned creation code](https://github.com/garyttierney/me3/blob/v0.13.0/crates/cli/src/commands/profile.rs)
and independent reproduction confirm this gap. The original
[Elden Ring](../evals/souls-profiles/elden-ring-baseline.me3) and
[Nightreign](../evals/souls-profiles/nightreign-baseline.me3) profile fixtures
declare `savefile` explicitly using the
[pinned profile schema](https://github.com/garyttierney/me3/blob/v0.13.0/schemas/mod-profile.json).
They have no mod packages, disable online matchmaking and can be checked with
`me3 profile show --file <absolute-profile-path>`. This is a parse dry run, not
a launch recipe admitted for gameplay. The alternate filename remains inside
the game's default save directory; other configuration writes and runtime
effects remain outside that setting.

Upstream Smithbox points to Nuxe for game archive unpacking and DarkScript3 for
EMEVD event scripts. Those are additional candidates when the first studied
encounter requires them. Do not unpack a full installation merely to populate
an asset catalog.

## Admit each real baseline

Wait for Steam's install/update operation to finish. Identify the actual
manifest, build, DLC, executable and selected source files. Freeze those inputs
before hashing or capture; streaming download files are not an admitted baseline.
Keep Elden Ring and Nightreign identities separate.

Budget snapshots and outstanding downloads before choosing full installation
copies. A smaller working overlay can reference pinned unchanged dependencies,
but those dependencies remain outside a declared-file checkpoint unless captured.
Record that boundary rather than calling an overlay a full replicated baseline.

Declare which launch provider owns the process, where every profile/save write
lands, how controls and actual rendered observations reach the agent, and which
network access the run needs. Establish a dedicated test profile and recovery
path before changing content. Modded local work must use the appropriate
offline profile; networked mod testing requires an explicitly supported route
and participating peers. A mod launcher is not an OS sandbox, and a backup does
not redirect future writes.

Nostalgia has a browser provider and a Windows native adapter for Elden Ring.
The native adapter exposes launch, focus, discrete input, rendered observations
and verified shutdown through the shared commands. See
[native gameplay](NATIVE-GAMEPLAY.md) for setup and current evidence limits.
Do not pass a native executable to the HTML provider or treat its browser
checks as native admission evidence.

Capture and reproduce selected baseline cases before studying or changing the
selected implementation: launch/character identity, controlled movement and
targeting, one fixed combat interaction, death/recovery, item pickup and
save/load. Record inputs, environment, actual outcomes and tolerances. Repeated
fresh restores must show which state is actually reproduced; server/account
state outside the declared capture remains an unresolved dependency.

## Asset and design records

For each selected asset retain source game/build, container and entry identity,
format/parser, hash, related materials/rigs/animations and conversion losses.
Classify assets into provisional categories without discarding raw identity or
relationships. Cross-game references need separate lineage; similar filenames
do not establish that two assets can be substituted.

Retain study observations, hypotheses about design purpose, requested changes,
implementation artifacts and play results separately. A useful first study
connects an encounter's enemies and attacks to relevant parameters, animation,
events and observed outcomes, with unresolved edges named. Feed actual records
into REA-SON when its source evidence exists; do not seed invented findings to
make an apparently complete knowledge graph.

The first changed encounter should establish one intended difference and check
its effects on resources, rewards, death/recovery and progression. Expand into
an expedition or ARPG prototype after that loop is repeatable. Technical
passing results and Bdo's judgment of the experience are separate evidence.
