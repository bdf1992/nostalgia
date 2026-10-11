# Owned Booth audio routing

The private root worker imports `createBoothAudioRoute` from `route.mjs`. This adapter takes already-decided local ownership and pins; it does not grant authority to public MCP arguments.

```js
const route = await createBoothAudioRoute({
  destination: freshAbsoluteRepositoryStateDirectory,
  target: { path: exactExecutablePath, sha256: lowercaseSha256 },
  desktop: exactInactiveBoothDesktopName,
  booth_receipt: actualPrivateWorkerBoothOpenReceipt,
  cable_endpoint: exactActiveCableRenderEndpointId,
  toolchain: { msbuild: existingMsBuildExecutable, pwsh: existingPowerShell7Executable }
});
const seedProof = await route.seed();
// Root may now launch its separately admitted game and observe actual Cable session ownership.
// On shutdown: stop the owned game, restore while Booth's desktop still exists, then close Booth.
const restoreProof = await route.restore();
```

Preparation exclusively reserves a fresh repository `state` child, copies the source templates and generates two admission headers. It builds with existing MSVC14.44.35207/v143 and Windows SDK10.0.26100.0, first the seeder, then a launcher pinned to that exact DLL hash. It records source/header/project/helper/toolchain hashes, actual Booth receipt, Windows version and all six endpoint-default roles. No installation, driver package, system endpoint change, normal game launch or capture occurs during preparation.

Seed and restore refuse an existing process with the exact target executable. Each preflight holds the pinned executable and DLL, verifies the exact inactive desktop, creates only its own suspended child with explicit `lpDesktop`, and assigns its private kill-on-close job before bootstrap. The primary thread is never resumed. The controller bounds each helper invocation to50seconds, checks the reported owned PID and creation ticks are gone, and retains stdout/stderr/exit/receipt/default snapshots. Seeder additionally checks the admitted endpoint is currently active before its zero PCM registration and app-specific preference changes. Readback proves app policy state; root must independently observe a fresh game's actual active endpoint before admitting audio.

On every seed error, the controller attempts restoration if an original preference snapshot exists. The snapshot hash is retained and subsequent changes are refused. Restore allows only current Cable values or exact saved originals; another user's later choice is refused. Lease expiry does not prevent cleanup, but removing the admitted desktop does. Keep Booth alive through quiescence and restore. Cached idempotent restoration returns explicitly historical evidence; it does not claim current preferences were rechecked.

If no original snapshot exists, cleanup normally remains unresolved. The narrow exception requires a retained exact failure before the seeder initializer was started: `exact remote DLL not loaded`, a reviewed pinned launcher/Seeder source pair, successful exact child cleanup and unchanged six global defaults. `recoverUnseededBoothAudioRoute({destination, terminal})` performs read-only recovery checks for a private retained failure. It rehashes all prepared artifacts, target and shell, checks the child creation identity is still gone, verifies snapshot absence before and after, and compares fresh six-role defaults. It does not launch a restore helper or change app/endpoint state. Unknown source, initializer uncertainty, timeout, overflow, changed defaults, remaining child or an existing snapshot refuse this exception. Snapshot absence alone is never sufficient. A successful proof allows the owning host to finalize its quiescent Booth; the recovery function itself does not close it.

The fourth public-host attempt failed at that pre-initializer module check. Guarded recovery passed and root confirmed its retained desktop absent with Win32 error 2 after closure. The helper now records the remote load thread's exit value and module snapshot errors, with at most 20 read retries separated by 10 ms only for `ERROR_BAD_LENGTH`. No DLL load or initializer is retried. The fifth seed passed with those diagnostics, but the fourth failure's underlying cause remains unknown. Imported target/dependency TLS execution and sound remain outside the no-route-initializer-mutation proof. Retained metadata is private worker evidence, not authenticated external evidence.

Generated headers hold validated escaped strings. Output roots and file ancestors reject reparse paths; existing destinations and outputs are refused. Runtime `seeder.ini` is private to one serialized route object, hash-checked between attempts. This prototype's file checks remain snapshots; native held handles protect the actual executable/DLL during each preflight. It is not an OS sandbox or a public capability boundary.

The EarTrumpet-derived AudioPolicyConfig ABI is a private, version-dependent Windows interface. Tested local success is not general Windows compatibility. The three render-role mappings belong to the target application's identity; no global default role is changed. Loader initialization and TLS callbacks can run during remote bootstrap, so suspended Main and seeder's zero PCM do not prove all arbitrary game pre-main code is silent.

Run `node scripts/booth-audio/test-route.mjs options.json` with an actual authored inactive Booth receipt and exact `NativeAudioFixture.exe` pins. The destination must be absent. The test seeds/restores the fixture, injects controller publication failure after native seed to prove cleanup, tests restoration after simulated lease expiry, and kills its own helper after private job assignment to check its suspended child is gone. It never requests tone or starts a game. Close that owned Booth after restoration. Capture/viewer tests remain separate in `test.ps1`.

`observeBoothAudio({target:{pid,start_ticks_utc,executable},cable_endpoint,pwsh})` runs read-only exact-PID CoreAudio enumeration with creation ticks passed as a decimal string. It binds the control source snapshot at trusted module import and checks both sources and PowerShell before and after the bounded call. It returns actual `sessions`, numeric `active_on_cable` and `active_off_cable`, and Boolean `pending_no_active_sessions`. Ambiguous ownership or identity failure throws with actual invocation evidence. The existing helper enumerates an owned family snapshot of at most128 unique processes and independently verifies each exact creation/path before and after its session reads. Reported sessions must belong to that declared family. This aligns observation with process-tree capture at that snapshot; it does not prevent subsequent child creation or sound between checks. Descendant creation ticks serialized as JSON numbers are not reused for targeting; returned descendant metadata deliberately omits those ticks.

Root startup must observe at least one active Cable session and no active session elsewhere before admission, with a bounded wait. After initial proof, no active session is an ordinary empty observation; an active off-Cable session requires refusal and owned cleanup. Every action/inspection should recheck this snapshot. Audio-session enumeration is not an ongoing guarantee between samples. `node scripts/booth-audio/test-observer.mjs exactAuthoredFixtureExe pwshExe freshStateDirectory cableEndpointId` proves no-session state, exact Cable session observation, wrong creation identity rejection and wrong-endpoint classification using only authored zero PCM.
