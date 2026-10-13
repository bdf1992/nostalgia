# Native gameplay environments

The Windows provider exposes native gameplay through Nostalgia's shared CLI/MCP
commands. Select `backend: "booth"` for an owned hidden desktop with virtual
gamepad input and viewer audio. The Sky backend uses foreground Computer Use.
Keep the host alive while agents use its private bridge/session paths. These
files contain local control credentials and must remain local.

The viewer is Workstation’s existing Booth watch page. Nostalgia registers private audio and gamepad capabilities against the exact owned recording; it serves no HTML page. Run the compatible Workstation Booth service first. Capability registration is revoked before shutdown starts. Viewer gamepad actions retain the native before/after ownership, audio, frame and save checks, so response latency can exceed a frame interval.

## Hidden Booth host

Build the repository and provision the [input package](BOOTH-GAMEPLAY.md) and
[audio package](BOOTH-AUDIO.md) locally. Save the trusted provider configuration
in a private JSON file with actual absolute paths and workstation authority:

```json
{
  "runtime_root": "C:/GameWork/nostalgia/scripts/booth-gameplay/local/early/runtime",
  "python": "C:/Tools/Python/python.exe",
  "ws_script": "C:/Workstation/scripts/ws.py",
  "booth_runtime_root": "C:/Workstation/control/runtime/booths",
  "booth_viewer_url": "http://127.0.0.1:8730/booth/watch",
  "ws_session": "ACTUAL_WORKSTATION_SESSION",
  "task": "OWNED_TASK",
  "audio": {
    "cable_endpoint": "ACTUAL_CABLE_RENDER_ENDPOINT_ID",
    "tool_receipt": "C:/GameWork/nostalgia/state/audio-build/receipt.json",
    "toolchain": {
      "msbuild": "C:/Tools/VisualStudio/MSBuild/Current/Bin/MSBuild.exe",
      "pwsh": "C:/Program Files/PowerShell/7/pwsh.exe"
    }
  }
}
```

Start the host with one public command, using an absent destination:

```powershell
node scripts/native-booth-host.mjs --config 'C:/GameWork/private/booth.json' --destination 'C:/GameWork/nostalgia/state/fresh-bridge'
```

The command derives Windows platform and APPDATA from its actual process. It
prints only `bridge_path`; the token remains in its private bridge file. Keep
the process alive while clients use the bridge. Send `close` on stdin, close
stdin, or send SIGINT/SIGTERM to attempt ordered cleanup. A cleanup failure is
reported and leaves the host available for explicit retry; it does not force
process exit or claim resources stopped. `--help` prints usage without reading
configuration or creating a bridge. No global registration is performed.

The factory remains available to an application that owns the same lifecycle:

```javascript
import { createNativeBoothBridge } from '../scripts/native-booth-bridge.mjs';
const bridge = await createNativeBoothBridge({
  destination: 'C:/GameWork/nostalgia/state/fresh-bridge',
  runtime: { platform: 'win32', appdata: 'C:/Users/Player/AppData/Roaming' },
  configuration: {
    runtime_root: 'C:/GameWork/nostalgia/scripts/booth-gameplay/local/early/runtime',
    python: 'C:/Tools/Python/python.exe',
    ws_script: 'C:/Workstation/scripts/ws.py',
    booth_runtime_root: 'C:/Workstation/control/runtime/booths',
    booth_viewer_url: 'http://127.0.0.1:8730/booth/watch',
    ws_session: 'ACTUAL_WORKSTATION_SESSION', task: 'OWNED_TASK',
    audio: {
      cable_endpoint: 'ACTUAL_CABLE_RENDER_ENDPOINT_ID',
      tool_receipt: 'C:/GameWork/nostalgia/state/audio-build/receipt.json',
      toolchain: { msbuild: 'ABSOLUTE_MSBUILD_EXE', pwsh: 'ABSOLUTE_PWSH_EXE' }
    }
  }
});
// The HTTP server keeps this process alive. Close owned sessions before exit.
// await bridge.close();
```

Use the start request below with `"backend": "booth"` and this host's bridge
path. The host restores the checkpoint, creates a silent anchor, seeds only
the game's render preferences into Cable, and then launches ME3. Admission
requires actual process ancestry, creation time, desktop and HWND, successful
early XInput initialization, one controller, and a frame of that game window.

Booth supports `wait` and complete `gamepad` actions. For example:

```json
{"kind":"gamepad","connected":true,"buttons":4096,
 "left_trigger":0,"right_trigger":0,"left_x":0,"left_y":0,
 "right_x":0,"right_y":0,"lease_ms":100}
```

Input leases last at most two seconds and return to neutral. `focus_on` selects
the hidden target without switching the owner's input desktop. The viewer starts
silent; Play and its volume control affect only viewer playback. Stop quiesces
the game/controller, closes capture, restores saved render preferences, then
closes the desktop. Cleanup failure retains evidence and refuses a stopped
verdict. Sessions reserve two minutes of the actual Booth lease for cleanup;
the retained expiry can therefore be shorter than the requested lifetime.

The real stdio MCP passed an Elden Ring smoke run on 2026-10-11: hidden
launch, offline Continue, camera, movement, sword animation, save, viewer PCM
capture, and ordered shutdown. A second process loaded a checkpoint of the
stopped alternate save and returned to Belurat. Original saves and all six
global audio defaults remained unchanged after the first run.

The superseded custom-viewer fifth public-host session, retained under
`state/elden-booth-viewer-retry-20261011/`, demonstrated the combined viewer:
its image used `/stream.mjpg`, decoded at 2560ï¿½1440, and a browser screenshot
showed Mary at Belurat. Mute was selected before explicit Play; the viewer
reported Audio connected while muted, then Audio stopped after Stop. The
retained `viewer-audio-proof.json` contains 529,200 PCM bytes and 261,450
nonzero samples. The test did not play game audio through the owner's speakers.
These are finite frame, endpoint and audio observations, not a continuous
silence guarantee or proof of human audibility. The first MCP stop returned `native_shutdown_incomplete`; an explicit retry
returned `stopped`. Retained cleanup verified game exit, controller and viewer
closure, restoration of all three original empty per-app render preferences,
unchanged six global defaults and closure of the owned desktop. The public host
then exited naturally with code 0. The original save digest remained unchanged
and no original backup file was created.

The map-driven agent traveled to Gatefront. A sword attack was attempted, but
outgoing damage was not established. A revival dialog and the subsequent
Gatefront respawn were observed. Pickup and outgoing inventory checks remain
unproven; the full gameplay baseline is incomplete.

MCP returns frame bytes once as image content; its structured metadata leaves
the screenshot byte fields empty. CLI and retained observations preserve the
full frame. Images exceeding the MCP response bound are explicitly omitted
from that response with a notice pointing to retained session evidence.

## Foreground Sky host and shared client setup

Build the repository before importing the bridge. In the Computer Use
`node_repl` runtime, add the repository's `node_modules` with
`js_add_node_module_dir`, then initialize the bridge using absolute paths:

```javascript
globalThis.sky = (await import('@oai/sky')).sky;
globalThis.nativeBridge = await (
  await import('C:/GameWork/nostalgia/scripts/native-sky-bridge.mjs')
).createNativeSkyBridge({
  sky,
  destination: 'C:/GameWork/run/bridge',
  runtime: { platform: 'win32', appdata: 'C:/Users/Player/AppData/Roaming' }
});
```

The bridge directory must be absent. Use the player's actual roaming profile
directory. The runtime has no global `process`; explicit runtime values are
required there. Keep a subsequent `node_repl` call running:

```javascript
await nativeBridge.serve();
```

HTTP handlers queue requests. This active call executes the SDK operations;
a server created in an earlier, completed call cannot perform desktop actions
by itself. Keep the call alive while CLI/MCP clients use the bridge. In a tool
orchestrator, yield the enclosing long call so client commands can execute.
Do not reset the JavaScript kernel while it owns a game.

Example native `start.json`:

```json
{
  "provider": "windows-native",
  "bridge_path": "C:/GameWork/run/bridge/bridge.json",
  "checkpoint": "C:/GameWork/baseline/checkpoint",
  "destination": "C:/GameWork/run/session",
  "audience": "shared",
  "lifetime_seconds": 3600,
  "me3_executable": "C:/Tools/me3/app/bin/me3.exe",
  "game_executable": "C:/Games/ELDEN RING/Game/eldenring.exe",
  "savefile": "Nostalgia_Baseline.sl2",
  "mode": "application-offline"
}
```

The checkpoint must contain a matching `game/eldenring.exe`; session and save
names must be fresh. Run `node dist/cli.js start-gameplay-environment start.json`.
Use the returned `session_path` for inspect, focus, input and stop. The native
CLI start exits after admission; its separate SDK host retains ownership.
To stop the host, authenticated local control accepts
`{"operation":"close-bridge"}`. It shuts down owned sessions first and retains
ownership if shutdown cannot be verified.

The selected implementation uses ME3 to launch Elden Ring with an explicit
offline profile and a separate save filename. Steam's large asset containers
remain dependencies of the installed game. The copied file checkpoint protects
only its declared payload, not those dependencies, process memory, drivers,
registry or cloud/account state. An offline profile does not create an OS network
sandbox.

Use `start_gameplay_environment` for launch, `inspect_gameplay_environment` for
actual frames, `focus_on_gameplay_environment` to select the game on the desktop,
`act_in_gameplay_environment` for bounded controls, and
`stop_gameplay_environment` for verified shutdown. CLI uses the corresponding
hyphenated command names. The browser provider remains the default.

Sky input can bring the game to the foreground and move the shared pointer.
Its controls are discrete keypresses and clicks. A native capture or input receipt does not establish
that the game reacted; evaluate the resulting frame and relevant gameplay state.
Refuse an ambiguous or unrelated window instead of targeting a title match.

## Baseline evidence

### Hidden desktop finding (2026-10-11)

The workstation's `ws booth` desktop provider launched the installed Elden Ring
build 25080141 through ME3 0.13.0 on a separate Windows desktop. Its existing
`PrintWindow(PW_RENDERFULLCONTENT)` capture returned a usable 1280Ã—720 title
screen, and Booth retained a recording. Enter addressed to the observed game
window and a click at the displayed title prompt both left the game at that
prompt. Message delivery receipts therefore establish attempted input only.
The owned booth was closed and the original primary save's digest stayed
unchanged. This establishes hidden launch and title capture, not playable input
or baseline admission.

The initial Booth capture used window messages without switching the owner's
input desktop; Enter and click did not advance the title prompt. This is
historical input evidence. The current shared Booth backend instead uses the
source-built process-local controller described in [BOOTH-GAMEPLAY.md](BOOTH-GAMEPLAY.md).
Early keyboard and late XInput experiments also failed at the title prompt;
connecting the virtual controller during initialization preceded the later
successful game runs above. A successful pipe write alone remains insufficient
proof that a game consumed input.

The pinned ProtoInput source is commit
`dd29bf8d22349605d0e1950c1c5dc4893d72670e` (v1.1.2), with local bounded input
extensions. Authored replay establishes those fixture behaviors separately
from the retained game runs. Windows blocked the official release archive
before extraction; it was not executed or unblocked. The source build was
assessed with normal host security enabled.

The initial capture-only recording ID was
`d6cdb6f2-22af-481a-9a79-5cd738847d84`; its local evidence remains under
`state/booth-elden-20261011/`. It establishes hidden launch and title capture,
not playable input or baseline admission.

Desktop Booth audio alone remains unmanaged: browser muting does not silence
a desktop game. The integrated host therefore routes the app to Cable before
normal launch, verifies actual owned active Cable sessions, and captures only
the owned process tree for the viewer. Per-process mute plus process loopback
was effectively silent in the earlier fixture and was not selected for viewer
separation. VB-CABLE was installed with the user's explicit authorization;
all six original global roles were restored and checked. Reboot remains the
user's decision. See [BOOTH-AUDIO.md](BOOTH-AUDIO.md) for the retained routing,
capture and viewer limits.

ME3's early native initializer alone cannot enforce a silent preflight when
DLL loading fails. The routing helper instead holds its newly created process
suspended, never resumes Main, and verifies its exact child stopped. Import
initialization and TLS callbacks can still run during bootstrap; a suspended
Main is not proof that all game callbacks are silent.

The fourth public-host attempt failed before the routing initializer: the
helper reported `exact remote DLL not loaded`, its owned child was verified
gone, no original preference snapshot existed, and all six global defaults
were unchanged. Guarded read-only recovery verified the pinned artifacts and
fresh state before root closed that retained Booth; its desktop was then
absent (Win32 error 2). The fifth attempt passed seed after bounded Toolhelp
snapshot-read retries and load-thread diagnostics were added. The fourth
attempt's underlying loader or snapshot failure remains unknown. Missing
snapshot alone never permits recovery; see [ROUTING.md](../scripts/booth-audio/ROUTING.md).

Declare the reference before play. An unchanged-content launch under ME3 is an
instrumented reference, and cannot establish equivalence to a vanilla Steam
launch. Record game build, loader and profile identities, input attempts, actual
frames, test character/state and recovery results. Keep each baseline case's
verdict separate from tool availability.

ME3 0.13.0 seeds an absent alternate save by copying the primary save. A fresh
filename therefore starts from existing progress, not necessarily an empty game.
Do not manufacture an empty SL2 file to bypass that behavior.

Preserve the user's original save before launch. Use a dedicated test save and
verify its actual destination and the original save's unchanged digest. Capture
test state only after verified shutdown. A restore into a fresh directory proves
declared file recovery; reproducing gameplay requires the restored test state to
be used by a new session and the same cases to pass again.

See [baseline evaluation](BASELINE-EVALUATION.md) and
[the Elden Ring project](BDOS-SOULS.md). Live results and private paths stay under
ignored `state/`; do not publish game bytes, personal saves or control tokens.
