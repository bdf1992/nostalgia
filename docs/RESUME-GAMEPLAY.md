# Nostalgia gameplay resumption

Updated October 11, 2026. Bdo paused work for budget and attention and still intends to pursue it. Diablo and Elden Ring are downloaded according to Bdo; confirm the Diablo edition, installation, and build on resumption. Keep the existing work and evidence. Do not restart implementation from scratch or resume game sessions until Bdo resumes the project.

Nostalgia is the game creation system, modeled on REA and REA-SON. It should study games and the player's request, retain design knowledge and relationships, discuss consequences, produce changes, and evaluate the resulting experience. Its evaluation targets are ten creative projects ranging from a short experiment to a production spanning multiple games, rather than merely ten supported games. Bdo's personal ARPG remains a take on Diablo II, potentially drawing controls and mechanics from later Diablo games and Path of Exile. The destination engine is undecided.

## Proposed first remix

Adapt an Elden Ring enemy, possibly a dragon, into Diablo II. This is an exploratory idea, not an implemented feature or a settled production brief. Study which attacks, movement, pacing, and visual cues make the enemy recognizable, then work out how those qualities fit Diablo's camera, targeting, combat density, damage, resistances, progression, and loot. Decide between literal asset conversion and an original interpretation after checking the installed edition and available engine interfaces.

An initial playable milestone could be one encounter in a copied local test environment. Evaluate readable attack cues, collision and damage, enemy behavior, difficulty, and recovery against a retained unchanged baseline. The project should test whether Nostalgia can explain and deliberately adapt a design, as well as manipulate files. No enemy extraction, conversion, import, or encounter has been completed.

## Progress retained

The native path uses the existing Bdo-designed Booth. The temporary standalone viewer was rejected; gameplay and audio belong in Booth's video player. Relevant existing guides are [native gameplay](NATIVE-GAMEPLAY.md), [Booth gameplay](BOOTH-GAMEPLAY.md), [audio](BOOTH-AUDIO.md), [baseline evaluation](BASELINE-EVALUATION.md), and [Bdo's Souls project](BDOS-SOULS.md).

| Area | Retained result | Limit |
| --- | --- | --- |
| Worker timeout | Process and inactive-desktop identity checks replaced slow nested CLI calls. Late responses are reconciled only when matched; ambiguous responses remain quarantined. | General end-to-end control is still too slow. |
| Capture allocation | Private native allocation accepts a bounded capture FPS setting; sessions were configured for 12 FPS. | Measured old live stream was about 9.99 FPS, so configuration alone is not proof. |
| Stream pacing | Workstation candidate uses the existing monotonic pacing primitive so capture/write time does not accumulate on top of every frame interval. | Supervised tests passed; final-source live 12 FPS proof remains open. |
| Player controls | Existing gameplay controls are portaled into the existing same-origin Booth player. Audio play, mute and volume, and game control arming were observed inside the player. | Continuous clear audio and complete gameplay remain open. |
| Native input | Early initialized, process-local ProtoInput reached Elden Ring's Continue menu through the player. | Observed menu input does not prove combat or a usable reflex loop. |
| Input release | Viewer disarm sends connected neutral input; terminal shutdown still disconnects. Unit checks cover release and rearming. | Device disconnection causing the game to stop polling is a supported hypothesis, not a controlled causal result. |
| Isolation and recovery | Owned inactive desktop, separate test save, viewer audio routing, exact process identity, shutdown and audio-default restoration receipts are retained. | Instrumented ME3 reference is not established equivalent to vanilla Steam behavior. |

The latest recording was `41ff8771-d827-4726-955c-359506a47f00`. Its cleanup receipt confirms game exit, controller closure, Booth closure, worker-channel exit, and unchanged global audio defaults. The private native bridge host was subsequently closed and exited successfully. Elden Ring's low, windowed 1280 by 720 settings were deliberately retained at Bdo's request. Original saves and private tokens must stay outside Git.

## Blockers and acceptance still open

1. **Latency is the first gate.** Bdo requires a 100 ms target and a hard 250 ms ceiling for a visible cue to input consumed by the target. RPC acknowledgment is insufficient. Further combat QA was paused until this gate passes.
2. **Build and measure the local reaction loop.** An original silent native reaction fixture and persistent local pixel-perception/controller loop are planned but not implemented. Measure actual cue paint and target input consumption, false positives, neutral release, frame age, and latency distribution. Keep model planning outside the reflex path unless measured performance qualifies it. Existing Jev transport has long request timeouts and retries; its suitability for this loop is unmeasured.
3. **Prove final-source stream performance.** Repeat the bounded actual Booth stream measurement after loading the pacing candidate. Retain FPS, resolution, source identity, elapsed time, and PC load. A 12 FPS viewing stream is separate from a fast local control loop.
4. **Prove gameplay.** No actual enemy combat was established. After the latency gate, retain movement, attacks, enemy response, and damage observations in an owned copied-save session.
5. **Audio crackle is lower priority.** Native task `nostalgia-booth-audio-crackle` is backlogged behind latency. Bdo heard crackling in the latest recording. Cause is unknown; retain audio plus timestamped underrun, queue, and device metrics and obtain a listening check. Audio capture also has 120-second stream windows; continuous renewal is not established.
6. **Measure load rather than blame the PC.** CPU and available memory samples exist, but there is no controlled causal comparison establishing that PC load caused the latency or crackle.
7. **Complete independent review and publication checks.** The pacing candidate needs final independent review and live proof. Both worktrees retain unpublished changes. Do not declare baseline admission, full playable validation, or project completion from the current evidence.

The browser reaction benchmark's full observation/model/tool path displayed an aggregate 15,939 ms. This is evidence that that path is unsuitable, not a native-game latency measurement. The aim exercise reached five successful targets out of thirty and was not completed; it establishes no aiming score. Screenshots are retained locally.

## Local work and evidence

The retained Nostalgia worktree is `C:/Users/bdf19/workstation/worktrees/nostalgia/sandbox-0e10a973`, branch `codex/booth-integration`, with HEAD `b7ec862e3f33777eda9510d4339e45da42295a04` at this handoff. The paired Workstation worktree is `C:/Users/bdf19/workstation/worktrees/workstation/sandbox-8a2d17b0`, branch `claude/booth-native-gameplay`. Do not discard either worktree or reset its dirty changes.

Nostalgia changes include `scripts/booth-gameplay/session_worker.py`, `worker-client.mjs`, `capabilities.mjs`, `scripts/native-booth-bridge.mjs`, associated authored tests, and audio integration source/docs. Workstation changes include `client/src/booth/GameplayPlayer.tsx`, `GameplayControls.tsx`, `gameplay.ts`, `Thread.tsx`, associated tests, and `wskernel/booth_watch.py`. The changes were developed together; Nostalgia alone does not contain the Booth player implementation.

Ignored Nostalgia `state/` directories retain private operational evidence:

- `elden-booth-12fps-20261011/`: old session, stream measurement, input diagnostics, load samples, baseline and aim screenshots, original graphics backup, cleanup.
- `elden-booth-player-20261011/`: latest session, player input screenshot, polling diagnostics, load samples, alternate-save launch and cleanup.
- `pause-20261011.json`: machine-readable pause and acceptance summary.
- `resume-evidence-20261011.json`: source hashes and exact local receipt locations generated for this handoff.

Retained supervised checks include 64 Python worker cases at 96.43% scoped executable-line coverage, 31 Node worker/bridge cases at 98.29%, 112 frontend cases at 94.07%, and 76 pacing/watch cases at 76.99%. Their exact production scope and receipt paths are in the local evidence index. Failed attempts remain retained; these results do not replace live acceptance. Frontend type checking and the Vite build passed; a large-chunk warning remains.

Native coordination tasks `nostalgia-sandbox-0e10a973` and `workstation-sandbox-8a2d17b0` were set backlogged and given this pause record. Their retained claims are not permission to continue after the pause. The versioned shared binding is under the Workstation worktree's `state/shared-binding-v7/`; its effect window expires and must be renewed before implementation or gameplay. The governing shared contract is Workstation `docs/kore/alignment/SHARED-CONTRACT.md`.

## Resume order

1. Read this handoff, the local evidence index, the existing guides, native task records, and current worktree diffs. Confirm Bdo is resuming; renew the shared work binding, budgets, claims and release hold.
2. Verify installed game edition/build and retained save/config backups. Use existing adapters and pinned toolchain identities; do not reprovision blindly.
3. Implement the bounded silent native reaction fixture and persistent local loop. Run repository-supervised tests with the published budget and full declared production coverage, then collect actual runtime timing and independent review.
4. Only after the latency gate, test the final Booth stream, viewer audio and combat while monitoring PC load. Preserve lower settings and isolated test saves unless Bdo changes those choices.
5. Study and scope the dragon encounter or Bdo's ARPG milestone with REA-SON design records. Retain an unchanged reference and evaluate intentional differences and preserved behavior separately.

This handoff is repository documentation. Private evidence remains local and ignored; game assets, saves, binary builds and control credentials are not published. Keep the worktrees and their `state/` directories until a reviewed migration or archival procedure preserves both source and required ignored evidence.
