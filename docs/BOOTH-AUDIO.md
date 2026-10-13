# Booth audio

The source in [scripts/booth-audio](../scripts/booth-audio/README.md) captures an exact owned process tree and supplies a private audio provider for Workstation’s existing Booth. It is integrated into the [Windows native Booth host](NATIVE-GAMEPLAY.md), which serves Nostalgia's CLI and stdio MCP. The trusted host calls `createBoothAudioRoute`, requires an actual active Cable session with no observed active session elsewhere, then calls `startGameplayProvider` for the admitted process. The player starts audio explicitly with Play and controls viewer mute and volume; there is no autoplay.

The caller must already own the target instance and have established its output isolation. Process loopback is independent of that output endpoint. Capturing a PID does not prevent the game sounding through the owner's physical speakers. The reviewed local route uses an unmuted game on Cable and process-tree capture, rather than capture of the entire shared Cable endpoint.

The first real Elden Ring stdio MCP smoke run on 2026-10-11 retained 529,200 PCM bytes containing 261,510 nonzero samples in `state/elden-booth-mcp-20261011/viewer-audio-proof.json`. The test recorded `owner_playback: false` and did not play those samples through the owner's speakers. Shutdown verified game/controller quiescence, closed capture, restored saved app render preferences, then closed the owned desktop. The capture and endpoint checks are finite observations, not a continuous silence guarantee or full baseline admission.

The superseded custom-viewer fifth public-host session under `state/elden-booth-viewer-retry-20261011/` also demonstrated the combined viewer: its `/stream.mjpg` image decoded at 2560Ã—1440, and `combined-viewer-proof.png` showed Mary at Belurat. With Mute selected before explicit Play, the browser reported Audio connected while muted, then Audio stopped after Stop. Its `viewer-audio-proof.json` retained 529,200 PCM bytes and 261,450 nonzero samples without owner-speaker playback in that test. This adds finite combined image/audio evidence; it does not establish human audibility or continuous isolation. The first MCP stop returned `native_shutdown_incomplete`; an explicit retry returned `stopped`. Cleanup verified game/controller/viewer closure, restoration to the three original empty app render preferences, unchanged six global defaults and desktop closure. The public host then exited naturally with code 0; the original save digest remained unchanged and its backup stayed absent. Gameplay pickup and outgoing damage/inventory checks remain unproven.

## Provision locally

No binaries or privileged installation automation are bundled. Use existing prerequisites or arrange their installation explicitly. [runtime.windows.json](../scripts/booth-audio/runtime.windows.json) retains tested versions and upstream source pins:

| Component | Tested pin |
|---|---|
| Node |24.11.1; repository requires24 or newer|
| PowerShell |7.6.5; use MTA for CoreAudio control|
| MSBuild / MSVC |17.14.40 / tools14.44.35207, v143|
| Windows SDK |10.0.26100.0|
| Process loopback |Windows build20348+; authored checks used26200|
| Authored browser test |Existing Playwright1.64.0 / its installed Chromium|
| Authored fixture build |Existing .NET SDK8.0.419 / runtime8.0.25|

Microsoft's [ApplicationLoopback sample](https://github.com/microsoft/Windows-classic-samples/tree/0b4e48a88ba446f3d87c5f7df12b33a74899a1e1/Samples/ApplicationLoopback) supplies the process activation and capture pattern. Its MIT license is retained. The derivative replaces its MF/WAV output with bounded event-loop PCM output. No exclude-target mode is exposed. Windows includes the target process and its descendants; unrelated siblings are excluded.

Run from this repository with an existing MSBuild executable:

```powershell
pwsh -NoProfile -MTA -File scripts/booth-audio/build.ps1 -MsBuildPath 'PATH_TO_MSBUILD.exe'
```

The script creates a fresh ignored `state/booth-audio/<id>` build, records source/compiler/runtime pins and the actual executable hash, and prints its local `receipt.json` path. It refuses an existing output root or an output outside repository state. The project requires an explicit isolated output root; normal build writes no executable beside source. Successful compilation records `built-no-runtime-validation`.

If Cable is needed, obtain it directly from [VB-Audio](https://vb-audio.com/Cable/) and review its signature, license and installation requirements separately. Its driver is not distributed here. Installation requires administrator authority, may change default roles, and calls for a reboot controlled by the person. Snapshot all six render/capture default roles first, restore only the exact saved roles if installation changed them, and retain readback. Do not substitute an endpoint-wide default switch for per-app output admission. The local proof's driver package and signatures remain ignored workstation evidence, not redistribution permission.

## Viewer and control

Supply the live owned PID, exact UTC creation time as .NET ticks, executable path, Booth MJPEG URL, and the build receipt:

```powershell
node scripts/booth-audio/server.mjs --pid PID --ticks DOTNET_START_TICKS --exe 'EXACT_GAME_EXE' --booth-stream-url 'http://127.0.0.1:BOOTH_PORT/stream.mjpg' --tool-receipt 'ABSOLUTE_LOCAL_BUILD_RECEIPT' --receipt 'state/FRESH_VIEWER_RECEIPT.json'
```

Use an argument list when calling from a service; do not split executable paths containing spaces. The CLI prints a generic startup notice. Only the in-process factory returns its private loopback provider URL and token; the public receipt excludes the token and the provider has no HTML page. The native host registers this provider with the existing Booth recording. Existing access receipts are refused. Both CLI and exported startup validate target fields and loopback video URL. The local tool receipt must match the current capture source and executable hash; hash checks occur before each spawn. This is snapshot verification, not an OS file lock against later replacement.

The existing Booth player creates no AudioContext before Play. Mute and volume affect only its WebAudio gain. There is one capture at a time, no remote access or account system, and focused leased gamepad controls. Host, Origin and a random256-bit token guard the loopback endpoints; malformed/non-ASCII tokens refuse. Stop, disconnected transport or service closure stops the owned helper and awaits exit. Close the viewer service after use.

The separate control helper enumerates existing CoreAudio sessions for caller-admitted processes:

```powershell
pwsh -NoProfile -MTA -File scripts/booth-audio/control.ps1 -Operation status -TargetPid PID -StartTicksUtc DOTNET_START_TICKS -Executable 'EXACT_GAME_EXE'
```

Authorized `mute`/`unmute` operations affect only verified PID/start/executable sessions. `-IncludeDescendants` takes a bounded process snapshot; it cannot cover newly created descendants or audio sessions continuously. `no-sessions-observed` is an honest result, not proof of silence. Caller ownership authorization remains required.

## Streaming contract

The native helper requires inherited stdin/stdout pipes and a duration of1â€“120 seconds. Its held process must match PID, creation time and executable before activation and while capturing. Send ASCII `stop\n`, close stdin, or let its deadline expire; the helper never stops its target. Output is stereo signed16-bit little-endian PCM at44100Hz:

- 24-byte header: six little-endian uint32 values `0x4d43504e` (NPCM),1,44100,2,16,4.
- Records: uint32 byte length, then that many PCM bytes; lengthâ‰¤65536 and divisible by4. Zero length ends a clean stream.
- Silent packets are explicitly zero-filled. PCM bytes are capped at `duration*176400+65536`.

The server/browser validate headers and records. Receive buffers are about128KiB, browser BYOB reads64KiB, scheduled playback about0.3s, and transport drain has a2s bound. A watcher cancels blocked helper writes and terminates only its own helper after a2s cleanup allowance. Cancelled/backpressured shutdown can leave an incomplete record without a terminator; discard it and report interruption. Never treat headers or a partial packet as samples. Stderr is separate bounded diagnostic output.

## Authored checks and limits

The removed custom-viewer fixture scripts are superseded by `tests/booth-provider.test.mjs`, `tests/booth-capabilities.test.mjs` and `tests/native-booth-bridge.test.mjs`, plus the Workstation Booth engine and actual React/browser checks. Run these through Workstation’s published Node test-budget supervisor with all three changed Nostalgia production sources in the coverage denominator. Its routine profile admits at most250 cases,180 runner seconds and requires75% executable-line coverage; retained receipts include failures. See Workstation `docs/NODE-TEST-BUDGET.md` for the exact supervised invocation. Do not use raw `npm test` as a substitute.

Provider fixtures exercise actual child PCM transport, token/Origin refusal, bounded input and cleanup without launching a game or producing owner-speaker audio. React fixtures test explicit Play, independent gain, input neutralization and cancellation when leaving live playback.

These remain technical fixture checks; the real-game smoke above is separate evidence. The fixtures do not establish human audibility, continuous host isolation, gameplay compatibility, remake quality or a general native-game launch provider. The [routing adapter](../scripts/booth-audio/ROUTING.md) compiles reviewed Seeder/SuspendedPreflight templates with generated pins for one trusted owned inactive Booth, exact target executable, local DLL and Cable endpoint. It is separate from the capture helper's `build.ps1`. Seed failure rollback, exact preference restoration and unchanged global defaults remain required. Keep the desktop available until game/controller quiescence and audio restoration complete. Private Windows audio-policy ABI and imported-DLL/TLS behavior retain their stated limits.
