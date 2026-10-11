# Booth gameplay adapter

`scripts/booth-gameplay/` contains version 1 of the reviewed, source-only Windows
prototype. It builds ProtoInput with bounded synthetic keyboard and XInput state,
a persistent GUI-subsystem controller, a Python stdio wrapper, an ownership
binder, an inactive-desktop driver, and original evaluation fixtures. CLI/MCP
integration is separate work; this package does not register tools.

The controller holds an exact process handle and rechecks PID, creation FILETIME,
executable, HWND ownership, and membership of the named inactive Booth desktop.
The helper starts on that desktop through `STARTUPINFO.lpDesktop`. It does not
switch desktops, move the player's pointer, take OS foreground focus, allocate a
console, or terminate the game. `focus_on` selects the admitted hidden target.

## Build from the pinned source

Prerequisites are Windows x64, Git, Python 3.10 or newer, VS2022 C++ tools with
MASM, an installed Windows SDK, and ATL headers/x64 libraries. Supply paths from
the local installation. Private ATL component paths may be supplied instead of
a global installation. No dependency or security setting is changed globally.

The build clones the official
[ProtoInput repository](https://github.com/Ilyaki/ProtoInput) at
`dd29bf8d22349605d0e1950c1c5dc4893d72670e`, checks and applies
`patches/protoinput-v1.patch`, and builds only the native loader/hooks and their
dependencies. It retargets v142 projects to v143 and the declared installed SDK
through build properties. Local object/output directories preserve upstream and
ordinary build outputs. The generated header pins the locally built DLLs; the
local manifest pins helpers and fixture bytes. These hashes establish local
artifact identity, not publisher authentication.

```powershell
# Supply actual local paths. The workspace must be absent.
$buildRoot = Join-Path $env:LOCALAPPDATA 'nostalgia/booth-gameplay-v1-early'
./scripts/booth-gameplay/provision.ps1 `
  -Workspace $buildRoot `
  -VSInstall $localVsInstall `
  -WindowsSdkVersion $installedSdkVersion `
  -Mode early
# If ATL is private rather than installed, also pass -AtlInclude and -AtlLibrary.
```

`ordinary` builds the late-attach fixture path. `early` also defines
`PROTOINPUT_EARLY_XINPUT`; both define `PROTOINPUT_HEADLESS` for hooks. Provision
each mode into a separate fresh workspace. Outputs, source checkout, logs,
generated build settings and `build-receipt.json` remain local. Published files
contain no game bytes or compiled binaries.

Build normally with Windows security active. If a download or new build artifact
is blocked, preserve the diagnostic and stop that provisioning attempt. The
recipe does not unblock files, add exclusions, disable security, or retry the
previously blocked release archive.

The upstream checkout retains its licenses. Copies of the discovered license
files and their identities are included in `licenses/`; OpenXinput's GPL-3.0-or-
later notice and full GPL-3 text are retained too. ProtoInput's MIT license does
not replace dependency licenses. Review those terms before distributing a build.

## Reproduce the authored evaluations

Provide the workstation's actual WS script, authorized session, and task. These
commands launch only the compiled original, silent fixture, on a fresh hidden
Booth. They record actual API output, window/process admission and explicit
cleanup. They require the local workstation Booth implementation; it is not
bundled here.

```powershell
$runtime = Join-Path $buildRoot 'runtime'
python ./scripts/booth-gameplay/tests/replay.py `
  --runtime $runtime --ws-script $localWsScript `
  --ws-session $authorizedSession --task $authorizedTask
python ./scripts/booth-gameplay/tests/replay_driver.py `
  --runtime $runtime --ws-script $localWsScript `
  --ws-session $authorizedSession --task $authorizedTask
```

In early mode, the fixture calls the actual exported initializer and then
`XInputGetState` before its main-equivalent marker. It verifies neutral connected
slot 0, late attachment without a second DllMain, one bootstrap, full controller
state, packet stability, lease expiry, disconnect/disable/EOF, the 16-byte
ordinal-100 state/canary, and capabilities. This demonstrates the authored
fixture's ordering. Actual ME3/game startup and rendering require separate
target-specific evaluation.

## Runtime interface and admission

Import `Controller`, `OwnedBoothTarget` and `read_owned_process_metadata` from
`controller_bridge.py`. Pass `runtime_root` explicitly, plus an exclusive
diagnostic path under that runtime. `OwnedBoothTarget` carries raw PID,
FILETIME high/low, absolute executable, HWND and desktop name from an already-
owned launch. Supplying those fields does not itself prove ownership. The helper
verifies the live process/window/desktop again before attachment and each action.

The controller accepts serialized, bounded `enable`, `key`, `disable`,
`gamepad_enable`, `gamepad`, `gamepad_disable`, and `close` operations. Keyboard
leases and controller leases are at most 2000 ms. The full gamepad primitive
includes connection, buttons, triggers, both signed axes, and packet revisions.
After synthetic ownership begins, slot 0 never falls back to physical XInput;
slots 1–3 are disconnected. Expiry neutralizes a connected controller; disable,
disconnect and IPC EOF release its state. Vibration is acknowledged and dropped.
Other XInput variants and other physical input APIs are outside this guarantee.

Use `booth_driver.py` for the launch/capture/control/close loop. Its constructor
requires explicit `ws_script`, `runtime_root`, `workspace_root`, and trusted
`verify_preflight` / `bind_owned_target` callbacks. The caller owns audio isolation,
save preservation, network policy, and authority to launch. An `audio: false`
label does not admit a game. An unknown launch outcome retains recovery metadata
and refuses guessed cleanup. Screenshots are actual Booth capture bytes, with
window/path/dimension/PNG integrity checks; successful capture does not certify
usable rendering. Coordinate clicks and incremental axis commands refuse;
declared full gamepad states support axes.

`bind_owned.py` is a read-only helper for the already-owned conhost → ME3 →
ME3 launcher → game route. Pass a trusted completed WS launch receipt, Booth
name, fresh output directory, WS script/session and exact executable paths.
It checks the launch event against process creation time, ancestry and creation
ordering, the unique HWND on that Booth, and a second identity snapshot. It
writes exclusive metadata only. Receipt labels and derived desktop names are
not authentication; the controller's live desktop-membership guard remains
required. This binder currently expects the ME3/Elden Ring process names.

## Early initialization and lifecycle

For pinned ME3 v0.13.0, add the following native entry to the caller's preserved
profile. Supply the absolute **early** hooks DLL path. Keep the existing isolated
save/audio settings and baseline launch flags.

```toml
[[natives]]
path = 'ABSOLUTE_LOCAL_EARLY_HOOKS_DLL'
optional = false
enabled = true
load_early = true
initializer = { function = 'NostalgiaEarlyXInputInitialize' }
```

The initializer ABI is `extern "C" bool(void)`, distinct from ME3's default
`modengine_ext_init` connector ABI. Before main it enables neutral synthetic
XInput and installs only that hook. No stock raw-input, keyboard, focus, GUI,
OpenXinput or DirectInput polling workers start early. Readiness requires actual
installation and ACL activation of GetState/SetState/Capabilities in xinput1_4;
the initializer does not self-poll. ME3 logs an initializer false result and can
continue, so loaded DLL alone is insufficient admission.

Read `NostalgiaEarlyXInputStatus`: ten aligned, individually atomic LONG64 values
(80 bytes): version, byte size, initializer calls, stage, result, late calls,
late stage, bootstrap count, DllMain attach count, ready hook count. Require
version 1, bytes 80, stage 2 and result 1. Stages use signed values: 0 idle,
1 attempting, 2 ready, −1 failed. Obtain export RVAs from the actual local build;
they are not fixed across builds. The 96-byte `NostalgiaInputDiagnosticData`
reports actual intercepted calls, returned synthetic state and foreground-hook
queries. Counters are independent atomic observations; its even, stable
generation bounds related last-value fields.

Late attachment loads the same module and calls the fixed
`DWORD WINAPI(void*) NostalgiaLateBootstrap` export after exact owned-process
admission. It checks loaded-module/path/export/executable memory and a valid
owned pipe. Target wait is 5 seconds; host wait is 7 seconds. Timeout or uncertain
result retains uncertainty, refuses another attachment, and never terminates a
remote thread or unloads its code. The existing upstream BlackBone LoadLibrary
operation is not newly bounded by this wait.

Use **one controller session per game process**. Controller EOF disables input
and ends the target IPC receiver; the one-time bootstrap does not restart it.
Restart an owned game process for another session. Module unload is unsupported;
the injected module and stock workers have process lifetime. Quiesce the owned controller and exact game process first. The parent restores
audio while the inactive desktop and silent anchor remain available, then
finalizes the owned Booth. Only after verified game exit may saves be copied or
runtime DLLs replaced. A cleanup timeout is
a recorded failure, never proof that the game has stopped.

## Trusted-parent session worker

`session_worker.py` owns one persistent JSON stdio session. Launch it with Python
isolated mode (`python -I session_worker.py`); requests start at sequence 1 and
contain at most 4 KiB. Each response repeats the sequence and supplies either
`ok: true, result` or `ok: false, error`. Private runtime paths and hashes come
from the parent, rather than from a player request. Python needs Tkinter for the
original silent anchor and the installed WS capture provider's image dependency.

The phases are `allocate` → parent prepares and verifies audio → `launch` →
`inspect`/`focus`/`gamepad` → `stop` → parent restores audio → `close`.
Allocation returns the actual anchor, WS receipt, inactive desktop and inherited
APPDATA. The parent checks this environment against its save admission before
launch. A supplied audio label cannot substitute for parent verification.

Launch uses fixed offline ME3 flags, refuses an existing exact game process,
binds the actual WS conhost ancestry and creation identities, and samples the
loaded early initializer's 80-byte export before late controller attachment.
The worker records its own clock interval around the launch command; it does
not use the completed WS event timestamp as the process creation timestamp.
Capture holds the actual desktop context and uses the installed WS
`booth_win32.capture` for the exact admitted HWND, with process/window checks
before and after. It does not choose the largest window or change window size.

The worker accepts full gamepad states with bounded leases. Keys, clicks and
incremental axes are refused. `stop` verifies game/controller quiescence and
retains the anchor and desktop; `close` finalizes them after parent audio
restoration. Parent EOF attempts known-owned quiescence and records the retained
desktop for recovery. Unknown launch or bootstrap outcomes refuse guessed
cleanup or another launch. Stock capture and injection calls may block inside
upstream code; a parent deadline is an uncertain result requiring retained
ownership and recovery, rather than proof that the target stopped.

Replay the entire worker using only freshly compiled original fixtures:

```powershell
python scripts/booth-gameplay/tests/replay_worker.py --runtime <absolute-early-runtime> --ws-script <absolute-ws.py> --ws-session <session-id> --task <task-id> --vs-install <absolute-VS2022-installation>
python scripts/booth-gameplay/tests/test_worker_contract.py
```

The integration replay checks an actual silent anchor, a four-process authored
launch chain, neutral input before main, an exact smaller-window PNG, real XInput
state and lease release, two-phase closure and a clean worker exit. It proves
the helper loop for that original fixture. It does not prove another game's
compatibility or authorize game operations.
