# Local baseline replication before investigation

Establish a restorable local baseline before reverse-engineering experiments or
changes to the target. First reproduce the unchanged target in a working copy,
evaluate the selected baseline scenarios, restore fresh state, and repeat. Pin
the accepted checkpoint, runtime, protocol, and results for later comparisons.

## What REA and SON preserve

REA's `close_binary(snapshot_path)` exports analysis and retained evidence;
`open_binary(snapshot_path)` imports compatible analysis bound to the target,
provider, and analysis profile. That snapshot is not a runnable installation,
save/profile backup, or captured live process.

SON's `son_checkpoint` exports its studies, names, relationships, observations,
and checks. `son_restore` restores that ledger. Those operations do not execute
targets or restore their filesystem or runtime state. REA process capture can
observe selected filesystem paths and compare runs, but those observations do
not restore an environment. Its documented new-process capture route does not
support native Windows in the inspected version.

Keep the local target checkpoint and the reasoning checkpoint separately, with
identities connecting their records. Saving the reasoning checkpoint cannot
satisfy the local baseline requirement.

## Choosing the target version

Respect an explicit user edition or version. Otherwise prefer the latest stable
available release that fits the requested experience, mod support, tools, and
host. Verify current release and compatibility information before choosing.
Compare material edition or major-version differences, explain why an older
release is a better fit when necessary, and pin the selected build. A release
label alone is insufficient; retain artifact identities and configuration.

The skill makes this choice from the user's request and available evidence.
Game installation and state paths are then resolved for that chosen target.
The evaluation should report unsupported baseline adapters rather than silently
switching to another game or claiming a fixture establishes game support.

## Baseline admission

Before investigation, the project needs:

1. A declared capture boundary covering the relevant installation, assets,
   configuration, saves, mods, runtime and adapter identities, and external state.
2. A checkpoint of those inputs made before experiments modify them. Capture
   file state while the relevant writers are stopped; the file provider cannot
   stop or snapshot a live process.
3. An unchanged local replica that runs the baseline cases: appropriate launch,
   controls, loading, selected interaction, and save/load checks.
4. A fresh restore that starts from the checkpoint and passes those same cases.
5. A retained receipt with identities, actual outputs, comparison tolerances,
   coverage, restoration results, and unresolved environmental dependencies.

Declare the expected baseline before executing the scenarios. A byte-identical
copy alone is insufficient. Conversely, this initial copy is not an independently
reconstructed game: a later reconstruction must be compared against the accepted
reference behavior. One admitted case does not establish whole-game equivalence.

Failure or missing coverage blocks admission for the proposed investigation
boundary. Resolve the missing input, case, adapter, or restoration issue first.
An admitted baseline still does not grant authority for a different operation.

## Current file checkpoint component

`src/fileCheckpoint.ts` captures an explicit list of local files into a new
checkpoint and restores verified payloads into new directories. It rejects
existing destinations, unsafe relative paths, links/junctions, changed sources,
corrupted identities, and extra or missing payload files. It preserves the source
and never replaces an existing working directory. Copy and hash limits are
explicit; the default total payload budget is 2 GiB and can be raised up to
100 GiB for a declared capture.

A checkpoint contains `manifest.json` and `payload/`. The manifest's ID binds its
file paths, sizes, hashes, recording time, and declared coverage. Verification
checks the manifest and payload before restoration. Hashes establish consistency
against supplied records; they do not authenticate the target's publisher.
The copy preserves declared paths and file bytes, not permissions, ACLs, or other
filesystem metadata. The evaluation records the host Node runtime's identity;
it does not include or restore that runtime in the checkpoint.

Wait for a successful capture or restore return before using its output.
Destination directories are reserved exclusively, and partial publication may
leave a reported incomplete directory. This is not an atomic multi-file or live
memory snapshot. Repeatable file reads and matching hashes cannot establish
global consistency while other processes keep changing the target.

Use an application save-state, emulator, VM, or another supported adapter when
file copies cannot represent the required state. Server state, account state,
registry, drivers, process memory, and services remain outside this provider.
Restoration for those inputs needs its own observed test.

## Running the current evaluation

```powershell
npm run evaluate:baseline
```

The default is an original authored Node fixture with configuration and saved
player state. It exercises startup, a combat interaction, and save/load. It is
not Diablo and is not an assessment of ARPG quality.

The run captures the fixture before execution. For every case, it restores
separate reference, replica, and recovery copies; checks each against the declared
expected JSON; compares their actual outputs; then rechecks the checkpoint and
original sources. Save/load changes the working profiles while frozen state and
source remain intact. The final receipt admits only the declared files and cases.

Each run remains under an ignored `state/baseline-*/` directory. Its `receipt.json`
records the checkpoint, runtime executable identity, adapter, protocol, actual
outputs, admission result, and failures. Mismatches leave a blocked receipt and a
nonzero CLI exit. Failed runs are retained for inspection; the runner does not
delete existing profiles to reuse a path.
Failed cases retain their expected result and any actual JSON or process output
available before failure, including exit status, stderr, and termination signal.

An optional JSON request selects explicit files, a Node entrypoint, cases with
arguments and expected JSON, and an absent absolute run directory. Use
`evals/baseline-fixture/protocol.json` as the current adapter's example. Paths and
arguments are data; the runner uses a direct Node child without shell evaluation.
It runs with host permissions and inherited environment apart from the recorded
`NODE_OPTIONS` override. It is not a sandbox, a native-game launcher, or a process
tree restoration system.

The receipt sets `reverse_engineering_execution` to `not_attempted`. This harness
orders its own baseline evaluation; it does not intercept external REA calls.
Agents must bind later investigation and comparison records to the admitted
checkpoint and protocol, and re-evaluate when their relevant inputs change.

The remaining real-game work is the selected target's capture boundary,
launch/reset/input/observation adapter, baseline scenarios, and restoration trial.
The fixture demonstrates the evaluation machinery, not a replicated Diablo
installation or captured player session.
