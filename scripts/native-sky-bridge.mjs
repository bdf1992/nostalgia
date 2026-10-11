// Import this module inside node_repl after importing the supported @oai/sky package.
// It never imports or launches a custom UI helper. Tests inject the same documented API.
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep, win32 } from 'node:path';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import * as z from 'zod/v4';
import { diagnostic, StudyError } from '../dist/errors.js';
import { verifyFileCheckpoint, restoreFileCheckpoint } from '../dist/fileCheckpoint.js';
import { nativeStartInput, nativeStartOutput, nativeInspectOutput, nativeActOutput, nativeStopOutput, nativeFocusOutput,
  nativeActionSchema, nativeWindowSchema, nativeScreenshotSchema, nativeBridgeReceiptSchema,
  admitNativePath, readNativeFile, nativeFileDigest } from '../dist/nativeGameplayEnvironment.js';

const MAX_IMAGE = 8 * 1024 ** 2;
const fail = (code, message) => { throw new StudyError(code, message); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const overlap = (a, b) => { const left = resolve(a).toLowerCase(), right = resolve(b).toLowerCase(); return left === right || left.startsWith(right + sep) || right.startsWith(left + sep); };
const processApp = executable => `process:${win32.normalize(executable).toLowerCase()}`;
const matches = (window, executable) => typeof window?.app === 'string' && window.app.toLowerCase().startsWith('process:') && processApp(window.app.slice(8)) === processApp(executable);
const execute = promisify(execFile);
async function inheritedEnvironment() {
  if (typeof process !== 'undefined') return { ...process.env };
  // node_repl does not expose node:process. Read the inherited child environment
  // privately; never persist, display or include this dictionary in receipts.
  try {
    const { stdout, stderr } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariables('Process') | ConvertTo-Json -Compress"], { shell: false, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
    if (stderr) fail('native_environment_failed', 'Inherited launch environment could not be read');
    const values = JSON.parse(stdout);
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string')) fail('native_environment_failed', 'Inherited launch environment has an unexpected shape');
    return values;
  } catch { fail('native_environment_failed', 'Inherited launch environment could not be read privately'); }
}
async function inventory(executable, platform) {
  if (platform !== 'win32') fail('native_platform_unsupported', 'Live native bridge requires Windows');
  // Read process metadata only. No Windows UI Automation, shell interpolation or PID signalling.
  const literal = `'${win32.normalize(executable).replaceAll("'", "''")}'`;
  const script = `$target=${literal}; $name=[IO.Path]::GetFileName($target); @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -eq $name -and (!$_.ExecutablePath -or [String]::Equals($_.ExecutablePath,$target,[StringComparison]::OrdinalIgnoreCase)) } | ForEach-Object { @{pid=$_.ProcessId;executable=$_.ExecutablePath;created_at=$_.CreationDate.ToUniversalTime().ToString('o')} }) | ConvertTo-Json -Compress`;
  const { stdout, stderr } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
  if (stderr) fail('native_inventory_failed', 'Native process inventory emitted an error');
  const raw = JSON.parse(stdout || '[]'); return Array.isArray(raw) ? raw : [raw];
}
async function primarySaves(appdata) {
  if (!appdata) fail('native_profile_unknown', 'Windows APPDATA is required to protect original saves');
  const root = join(appdata, 'EldenRing');
  try { await admitNativePath(root, true); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const paths = [];
  for (const entry of await readdir(root)) if (/^\d{17}$/.test(entry)) {
    const directory = join(root, entry); await admitNativePath(directory, true); const file = join(directory, 'ER0000.sl2');
    try { await admitNativePath(file); paths.push(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return paths;
}
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
function validatePng(url) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) {
    const comma = url.indexOf(','), header = (comma >= 0 ? url.slice(0, comma) : `${url.split(':', 1)[0]}:`).slice(0, 60).replace(/[\r\n\x00-\x1f]/g, '');
    fail('native_frame_invalid', `Native observation requires an actual returned PNG data URL; returned header ${header}, URL characters ${url.length}`);
  }
  const encoded = url.slice(22); if (encoded.length > Math.ceil(MAX_IMAGE / 3) * 4) fail('native_frame_invalid', 'Returned native PNG exceeds 8 MiB');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 57 || bytes.length > MAX_IMAGE || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('native_frame_invalid', 'Returned native PNG is empty or truncated');
  let offset = 8, sawData = false, ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail('native_frame_invalid', 'Native PNG has a truncated chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length, type = bytes.toString('ascii', offset + 4, offset + 8);
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) fail('native_frame_invalid', 'Native PNG chunk is truncated or corrupt');
    if (offset === 8 && (type !== 'IHDR' || length !== 13 || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20))) fail('native_frame_invalid', 'Native PNG requires a nonempty image header');
    if (type === 'IDAT' && length) sawData = true;
    if (type === 'IEND') { if (length || end !== bytes.length) fail('native_frame_invalid', 'Native PNG has an invalid terminator'); ended = true; }
    offset = end;
  }
  if (!ended || !sawData) fail('native_frame_invalid', 'Native PNG has no complete image data');
  return bytes.length;
}
export function validateImage(url) {
  const header = /^data:(image\/(?:png|jpeg));base64,/.exec(url);
  if (!header) { validatePng(url); }
  const mime = header[1], encoded = url.slice(header[0].length);
  if (encoded.length > Math.ceil(MAX_IMAGE / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('native_frame_invalid', 'Returned image encoding exceeds its bound or is invalid');
  const bytes = Buffer.from(encoded, 'base64'); if (bytes.toString('base64') !== encoded || bytes.length > MAX_IMAGE) fail('native_frame_invalid', 'Returned image encoding is not canonical bounded base64');
  if (mime === 'image/png') { validatePng(url); const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width > 32768 || height > 32768 || width * height > 100000000) fail('native_frame_invalid', 'PNG dimensions exceed the bounded frame size');
    return { mime, encoded, bytes: bytes.length, width, height }; }
  if (bytes.length < 20 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) fail('native_frame_invalid', 'Returned JPEG is empty or truncated');
  let offset = 2, width, height, scans = 0, entropy = 0;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) fail('native_frame_invalid', 'JPEG marker boundary is invalid');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) { if (offset !== bytes.length || !width || !height || !scans || !entropy) fail('native_frame_invalid', 'JPEG lacks a complete image scan'); break; }
    if (marker === undefined || marker === 0 || marker === 216 || marker === 1 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) fail('native_frame_invalid', 'JPEG has an unexpected standalone marker');
    const length = bytes.readUInt16BE(offset), end = offset + length;
    if (length < 2 || end > bytes.length) fail('native_frame_invalid', 'JPEG marker segment is truncated');
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (length < 8 || width !== undefined) fail('native_frame_invalid', 'JPEG image header is invalid or repeated');
      height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5);
      const components = bytes[offset + 7];
      if (!width || !height || width > 32768 || height > 32768 || width * height > 100000000 || !components || length !== 8 + 3 * components) fail('native_frame_invalid', 'JPEG image dimensions or component header are invalid');
    }
    offset = end;
    if (marker === 218) {
      const components = bytes[end - length + 2];
      if (!width || !height || !components || length !== 6 + 2 * components) fail('native_frame_invalid', 'JPEG scan header is invalid');
      scans++;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { entropy++; offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || next >= 208 && next <= 215) { entropy++; offset += 2; continue; }
        if (next === 255) { offset++; continue; }
        break;
      }
    }
  }
  if (offset !== bytes.length || !width || !height || !scans || !entropy) fail('native_frame_invalid', 'JPEG image is incomplete');
  return { mime, encoded, bytes: bytes.length, width, height };
}
function bounded(promise, timeout, label) { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new StudyError('native_operation_timeout', `${label} exceeded its deadline; outcome may be unknown`)), timeout); })]).finally(() => clearTimeout(timer)); }

export async function createNativeSkyBridge({ sky, destination, runtime }, dependencies = {}) {
  for (const method of ['list_windows', 'get_window', 'get_window_state', 'press_key', 'click', 'activate_window']) if (typeof sky?.[method] !== 'function') fail('native_sky_invalid', `Supported sky API ${method} is required`);
  const platform = runtime?.platform ?? (typeof process !== 'undefined' ? process.platform : undefined);
  const appdata = runtime?.appdata ?? (typeof process !== 'undefined' ? process.env.APPDATA : undefined);
  if (runtime !== undefined && (!runtime || runtime.platform !== 'win32' || typeof runtime.appdata !== 'string' || !win32.isAbsolute(runtime.appdata))) fail('native_runtime_invalid', 'Explicit native runtime requires Windows platform and absolute APPDATA path');
  if (!destination || !win32.isAbsolute(destination) && !destination.startsWith('/')) fail('native_path_refused', 'Bridge destination must be absolute');
  destination = resolve(destination); await admitNativePath(dirname(destination), true); await mkdir(destination);
  const bridgeIdentity = await admitNativePath(destination, true), bridgePath = join(destination, 'bridge.json');
  const launcher = dependencies.launcher ?? spawn, listProcesses = dependencies.listProcesses ?? (executable => inventory(executable, platform)), savePaths = dependencies.originalSavePaths ?? (() => primarySaves(appdata));
  const loadEnvironment = dependencies.inheritedEnvironment ?? inheritedEnvironment;
  const poll = dependencies.pollMilliseconds ?? 500, windowTimeout = dependencies.windowTimeoutMilliseconds ?? 90000, stopTimeout = dependencies.stopTimeoutMilliseconds ?? 10000;
  const sessions = new Map(), metadata = new Map(), jobs = []; let wakeHost, serving = false, dispatching = false, closed = false, closing = false;
  const receipt = { version: 1, provider: 'windows-native-sky-bridge', bridge_id: randomUUID(), bridge_path: bridgePath, url: '', token: randomBytes(32).toString('hex'), status: 'running' };
  const metadataQueues = new WeakMap();
  function ownedWrite(directory, identity, registry, filename, value) {
    // Launcher events can arrive during initial publication. Serialize all writes
    // sharing an ownership registry before deciding between exclusive create and
    // identity-checked update.
    const result = (metadataQueues.get(registry) ?? Promise.resolve()).then(() => ownedWriteNow(directory, identity, registry, filename, value));
    metadataQueues.set(registry, result.catch(() => {})); return result;
  }
  async function ownedWriteNow(directory, identity, registry, filename, value) {
    const current = await admitNativePath(directory, true); if (!same(current, identity)) fail('native_path_refused', 'Owned directory identity changed');
    const path = join(directory, filename), known = registry.get(filename);
    const handle = await open(path, known ? constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) : 'wx', 0o600);
    try { const stat = await handle.stat(), named = await admitNativePath(path), parent = await admitNativePath(directory, true);
      if (!stat.isFile() || stat.nlink !== 1 || !same(stat, named) || !same(parent, identity) || known && !same(stat, known)) fail('native_path_refused', 'Owned metadata was replaced; refusing overwrite');
      await handle.truncate(0); await handle.writeFile(JSON.stringify(value)); registry.set(filename, await handle.stat());
    } finally { await handle.close(); }
  }
  const writeSession = (session, file, value) => ownedWrite(session.directory, session.directoryIdentity, session.metadata, file, value);
  // HTTP callbacks only submit work. The host invokes each function directly from
  // serve(), so sky inherits the current node_repl execution context rather than
  // the expired context in which this server was created.
  const enqueue = run => new Promise((resolve, reject) => {
    if (closed || jobs.length >= 32) { reject(new StudyError('native_host_busy', 'Native host is closed or its bounded queue is full')); return; }
    jobs.push({ run, resolve, reject }); wakeHost?.();
  });
  async function processesFor(session) { return bounded(listProcesses(session.input.game_executable), 10000, 'Exact game process inventory'); }
  async function revalidateProcess(session, allowAbsent = false) {
    const records = await processesFor(session);
    if (allowAbsent && records.length === 0) return null;
    if (!session.process || records.length !== 1 || records[0].pid !== session.process.pid || records[0].created_at !== session.process.created_at ||
      typeof records[0].executable !== 'string' || processApp(records[0].executable) !== processApp(session.input.game_executable)) fail('native_ownership_unproven', 'Exact game PID/start identity differs from owned ME3 launch');
    return records[0];
  }
  async function bindProcess(session) {
    const log = `${session.launcher_log.stdout}\n${session.launcher_log.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
    const loggedPids = [...new Set([...log.matchAll(/attaching to process[^\r\n]*?\bpid\s*[=:]\s*(\d+)\b/gi)].map(match => Number(match[1])))];
    if (loggedPids.length > 1) fail('native_ownership_unproven', 'Owned launcher reported multiple attaching process IDs');
    if (loggedPids.length === 1) {
      const records = await processesFor(session);
      if (records.length > 1) fail('native_target_ambiguous', 'Multiple exact game processes appeared during launch');
      if (records.length === 1 && records[0].pid === loggedPids[0] && typeof records[0].executable === 'string' && processApp(records[0].executable) === processApp(session.input.game_executable) && records[0].created_at) session.process = records[0];
    }
    return session.process;
  }
  async function uniqueWindow(session, required = true) {
    const process = await revalidateProcess(session, !required);
    const windows = await bounded(sky.list_windows(), 10000, 'Window inventory');
    const candidates = windows.filter(window => matches(window, session.input.game_executable));
    if (!process && candidates.length) fail('native_ownership_unproven', 'Window exists without the owned exact process identity');
    if (candidates.length !== 1) { if (!required && candidates.length === 0) return null; fail('native_target_ambiguous', `Expected exactly one exact process-path window; found ${candidates.length}`); }
    const selected = nativeWindowSchema.parse(candidates[0]);
    if (session.window && (selected.id !== session.window.id || selected.app.toLowerCase() !== session.window.app.toLowerCase())) fail('native_target_changed', 'Owned native target window identity changed');
    const current = await bounded(sky.get_window({ id: selected.id, app: selected.app }), 10000, 'Window revalidation');
    if (current.id !== selected.id || !matches(current, session.input.game_executable)) fail('native_target_changed', 'Rehydrated window does not match the selected exact process');
    session.window = current; return current;
  }
  async function protectSaves(session) {
    for (const save of session.primary_saves) {
      if (!save.exists) { try { await lstat(save.path); fail('native_original_save_changed', 'Previously absent original save backup was created'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      else if (await nativeFileDigest(save.path) !== save.sha256) fail('native_original_save_changed', 'Original primary save or backup changed during managed launch');
    }
  }
  async function observe(session) {
    const window = await uniqueWindow(session);
    const state = await bounded(sky.get_window_state({ window, include_screenshot: true, include_text: true }), 15000, 'Native observation');
    const observedWindow = nativeWindowSchema.parse(state.window);
    if (observedWindow.id !== window.id || !matches(observedWindow, session.input.game_executable) || observedWindow.app.toLowerCase() !== window.app.toLowerCase()) fail('native_target_changed', 'Returned frame belongs to a different target window');
    const screenshots = z.array(nativeScreenshotSchema).min(1).max(8).parse(state.screenshots); let bytes = 0; const images = [];
    for (const frame of screenshots) { const image = validateImage(frame.url); images.push(image); bytes += image.bytes;
      if (bytes > MAX_IMAGE || frame.width !== undefined && frame.width !== image.width || frame.height !== undefined && frame.height !== image.height) fail('native_frame_invalid', 'Combined native frames exceed 8 MiB or returned frame dimensions differ from image header'); }
    const text = [state.accessibility?.tree, state.accessibility?.document_text, state.accessibility?.focused_element].filter(Boolean).join('\n');
    const output = nativeInspectOutput.parse({ provider: 'windows-native', session_path: session.receipt.session_path, session_id: session.receipt.session_id, checkpoint_id: session.receipt.checkpoint_id,
      status: session.receipt.status === 'starting' ? 'running' : session.receipt.status, url: session.receipt.gameplay_url,
      visible_text: new TextDecoder().decode(Buffer.from(text).subarray(0, 16384), { stream: true }), window: observedWindow, screenshots,
      screenshot_image_base64: images[0].encoded, screenshot_mime_type: images[0].mime,
      ...(images[0].mime === 'image/png' ? { screenshot_png_base64: images[0].encoded } : {}), input_behavior: 'foreground-input-may-move-cursor' });
    session.window = state.window; session.observation = output; session.state = state; session.observed_at = Date.now(); await writeSession(session, 'observation.json', output); return output;
  }
  async function appendRecord(session, record) { session.actions.push(record); session.actions = session.actions.slice(-1000); await writeSession(session, 'actions.json', session.actions); }
  async function stop(session) {
    if (session.receipt.status === 'stopped') return nativeStopOutput.parse({ session_path: session.receipt.session_path, session_id: session.receipt.session_id, checkpoint_id: session.receipt.checkpoint_id, status: 'stopped', provider: 'windows-native' });
    clearTimeout(session.timer);
    const record = { kind: 'stop', attempted_at: new Date().toISOString(), status: 'attempted' }; await appendRecord(session, record);
    try {
      let target = await uniqueWindow(session, false);
      const appearingDeadline = Date.now() + stopTimeout;
      while (!target && (await processesFor(session)).length && Date.now() < appearingDeadline) { await pause(poll); target = await uniqueWindow(session, false); }
      if (target) { await bounded(sky.press_key({ window: target, key: 'Alt+F4' }), 10000, 'Targeted close input'); const until = Date.now() + stopTimeout;
        while (Date.now() < until) { const windows = await bounded(sky.list_windows(), 10000, 'Close verification'); if (!windows.some(window => matches(window, session.input.game_executable))) break; await pause(poll); }
      }
      const windows = await bounded(sky.list_windows(), 10000, 'Close verification');
      if (windows.some(window => matches(window, session.input.game_executable))) fail('native_shutdown_incomplete', 'Targeted game window remains open; no PID was killed');
      const processDeadline = Date.now() + stopTimeout;
      while (Date.now() < processDeadline && ((await processesFor(session)).length || session.launcher_log.status !== 'exited')) await pause(poll);
      if ((await processesFor(session)).length || session.launcher_log.status !== 'exited') fail('native_shutdown_incomplete', 'Game process or owned launcher remains after window close; no PID was killed');
      await protectSaves(session);
      session.receipt.status = 'stopped'; record.status = 'window-disappearance-observed'; await writeSession(session, 'session.json', session.receipt);
      if (session.observation) await writeSession(session, 'observation.json', { ...session.observation, status: 'stopped' });
      await writeSession(session, 'actions.json', session.actions); sessions.delete(session.receipt.session_path);
      return nativeStopOutput.parse({ provider: 'windows-native', session_path: session.receipt.session_path, session_id: session.receipt.session_id, checkpoint_id: session.receipt.checkpoint_id, status: 'stopped' });
    } catch (error) { record.status = 'failed'; record.error = diagnostic(error); await writeSession(session, 'actions.json', session.actions); throw error; }
  }
  async function start(raw, signal) {
    signal?.throwIfAborted();
    if (closing) fail('native_bridge_closed', 'Native bridge is shutting down');
    const input = nativeStartInput.parse(raw);
    if (input.backend === 'booth') fail('native_backend_unsupported', 'The Sky bridge cannot host the Booth backend');
    if (resolve(input.bridge_path) !== bridgePath) fail('native_bridge_invalid', 'Start request selected a different bridge receipt');
    if (overlap(input.destination, input.checkpoint) || overlap(input.destination, destination) || overlap(input.destination, dirname(input.game_executable)) || overlap(input.destination, dirname(input.me3_executable))) fail('native_path_refused', 'Session copy must remain separate from checkpoint, bridge and shared executables');
    await admitNativePath(dirname(input.destination), true);
    try { await lstat(input.destination); fail('native_destination_exists', 'Native session destination must be absent'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const existing = (await bounded(sky.list_windows(), 10000, 'Initial window inventory')).filter(window => matches(window, input.game_executable));
    if (existing.length || (await bounded(listProcesses(input.game_executable), 10000, 'Initial process inventory')).length) fail('native_target_already_running', 'Selected game already has a window or process; refusing to take ownership');
    const checkpoint = await verifyFileCheckpoint(input.checkpoint);
    const me3 = { path: input.me3_executable, sha256: await nativeFileDigest(input.me3_executable) }, game = { path: input.game_executable, sha256: await nativeFileDigest(input.game_executable) };
    const capturedGame = checkpoint.files.find(file => file.path === 'game/eldenring.exe');
    if (!capturedGame || capturedGame.sha256 !== game.sha256) fail('native_baseline_mismatch', 'Shared game executable must match the captured game/eldenring.exe identity');
    const saves = [];
    const originalSavePaths = await bounded(savePaths(), 10000, 'Original save inventory');
    for (const path of originalSavePaths) {
      const alternate = join(dirname(path), input.savefile);
      try { await lstat(alternate); fail('native_savefile_exists', 'Selected alternate save already exists; choose a fresh filename'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (overlap(dirname(path), input.destination)) fail('native_path_refused', 'Session copies must not overlap live saves');
      saves.push({ path, exists: true, sha256: await nativeFileDigest(path) });
      const backup = `${path}.bak`; try { saves.push({ path: backup, exists: true, sha256: await nativeFileDigest(backup) }); } catch (error) { if (error.code !== 'ENOENT') throw error; saves.push({ path: backup, exists: false }); }
    }
    let seed;
    if (input.save_seed) {
      if (originalSavePaths.length !== 1) fail('native_seed_target_ambiguous', 'Seeded alternate saves require exactly one actual primary-save directory');
      if (overlap(input.destination, input.save_seed.checkpoint)) fail('native_path_refused', 'Seed checkpoint and session copy must remain separate');
      const verified = await verifyFileCheckpoint(input.save_seed.checkpoint), member = verified.files.find(file => file.path === input.save_seed.path);
      if (!member || member.bytes > 64 * 1024 ** 2) fail('native_seed_invalid', 'Seed must select one captured SL2 file no larger than64MiB');
      const source = join(verified.checkpoint, 'payload', ...member.path.split('/')), bytes = await readNativeFile(source, 64 * 1024 ** 2);
      if (bytes.length !== member.bytes || createHash('sha256').update(bytes).digest('hex') !== member.sha256) fail('native_seed_invalid', 'Selected seed payload differs from its verified checkpoint');
      seed = { bytes, metadata: { checkpoint_id: verified.checkpoint_id, member: member.path, sha256: member.sha256, created_save_path: join(dirname(originalSavePaths[0]), input.savefile) } };
    }
    signal?.throwIfAborted();
    const launchEnvironment = { ...await bounded(loadEnvironment(), 10000, 'Inherited launch environment') };
    if (appdata) launchEnvironment.APPDATA = appdata;
    const directory = resolve(input.destination); await mkdir(directory); const directoryIdentity = await admitNativePath(directory, true);
    const session = { input, directory, directoryIdentity, metadata: new Map(), actions: [], primary_saves: saves, launcher_log: { stdout: '', stderr: '', status: 'not_started' } };
    try {
      const working = join(directory, 'game'); await restoreFileCheckpoint({ checkpoint: input.checkpoint, destination: working });
      const profilePath = join(directory, 'baseline.me3');
      const profileText = `profileVersion = "v1"\nsavefile = ${JSON.stringify(input.savefile)}\nnatives = []\npackages = []\nstart_online = false\nmem_patch = false\ndisable_arxan = false\n\n[[supports]]\ngame = "eldenring"\n\n[debug_properties]\n`;
      const profileHandle = await open(profilePath, 'wx', 0o600); try { await profileHandle.writeFile(profileText); } finally { await profileHandle.close(); }
      const profile = { path: profilePath, sha256: createHash('sha256').update(profileText).digest('hex') };
      const publicReceipt = { provider: 'windows-native', session_path: join(directory, 'session.json'), session_id: randomUUID(), checkpoint_id: checkpoint.checkpoint_id,
        gameplay_url: `native://${randomUUID()}`, audience: input.audience, working_directory: working, savefile: input.savefile,
        runtime: { provider: 'windows-native-sky', me3, game, profile, mode: 'application-offline' }, coverage: 'declared-files-copied-shared-game-assets-referenced',
        input_behavior: 'foreground-input-may-move-cursor', guarantees: ['Declared checkpoint restored to a fresh owned copy', 'Exact returned process-path window required for each input', 'Alternate save filename; original primary saves hashed before and after launch'],
        limitations: ['Shared game assets remain referenced, not captured or reconstructed', 'Application offline flags are not an OS network sandbox', 'Native input brings game foreground and may move cursor', 'ME3 may seed an absent alternate save from the primary save; not a fresh empty profile', 'Alternate game saves are written in the game default save directory outside the copied workspace', 'Window disappearance does not prove full process-tree containment or launcher exit', 'Caller-supplied local metadata is not authenticated provenance'] };
      if (seed) publicReceipt.save_seed = seed.metadata;
      session.public = nativeStartOutput.parse(publicReceipt); session.receipt = { ...session.public, bridge_path: bridgePath, status: 'starting', expires_at: new Date(Date.now() + input.lifetime_seconds * 1000).toISOString() };
      await writeSession(session, 'session.json', session.receipt); await writeSession(session, 'actions.json', []); await writeSession(session, 'protected-saves.json', saves);
      sessions.set(session.receipt.session_path, session);
      const args = ['launch', '--game', 'eldenring', '--exe', input.game_executable, '--profile', profilePath, '--savefile', input.savefile,
        '--online=false', '--no-mem-patch=true', '--show-logos=true', '--no-boot-boost=true', '--disable-arxan=false', '--skip-steam-init=false'];
      signal?.throwIfAborted();
      if (seed) {
        const parent = await admitNativePath(dirname(seed.metadata.created_save_path), true), handle = await open(seed.metadata.created_save_path, 'wx', 0o600);
        try { const opened = await handle.stat(), currentParent = await admitNativePath(dirname(seed.metadata.created_save_path), true); if (!same(parent, currentParent) || !opened.isFile() || opened.nlink !== 1) fail('native_path_refused', 'Alternate save target changed during exclusive seed creation'); await handle.writeFile(seed.bytes); } finally { await handle.close(); }
        if (await nativeFileDigest(seed.metadata.created_save_path) !== seed.metadata.sha256) fail('native_seed_invalid', 'Exclusively created alternate save differs from the declared seed');
        await writeSession(session, 'seed.json', seed.metadata); await protectSaves(session); signal?.throwIfAborted();
      }
      const child = launcher(input.me3_executable, args, { shell: false, windowsHide: true, cwd: dirname(input.game_executable), stdio: ['ignore', 'pipe', 'pipe'], env: launchEnvironment });
      session.launcher = child; session.launcher_log = { command: input.me3_executable, arguments: args, status: 'spawned', pid: child.pid ?? null, stdout: '', stderr: '' };
      let launchFailure;
      child.on?.('error', error => { launchFailure = error; session.launcher_log.status = 'error'; session.launcher_log.error = String(error.message); });
      child.on?.('exit', (code, signal) => { session.launcher_log.status = 'exited'; session.launcher_log.code = code; session.launcher_log.signal = signal; void writeSession(session, 'launcher.json', session.launcher_log).catch(() => {}); });
      for (const field of ['stdout', 'stderr']) child[field]?.on('data', chunk => { session.launcher_log[field] = (session.launcher_log[field] + String(chunk)).slice(-1024 * 1024); });
      await writeSession(session, 'launcher.json', session.launcher_log);
      const refuseExitedLauncher = () => {
        if (session.launcher_log.status !== 'exited') return;
        const excerpt = (session.launcher_log.stderr || session.launcher_log.stdout).replace(/\x1b\[[0-9;]*m/g, '').slice(-2048);
        fail('native_launch_failed', `Owned ME3 launcher exited before a usable running observation (code ${session.launcher_log.code}, signal ${session.launcher_log.signal ?? 'none'}). ${excerpt}`);
      };
      const until = Date.now() + windowTimeout;
      while (Date.now() < until) {
        if (closing || signal?.aborted) { signal?.throwIfAborted(); fail('native_bridge_closed', 'Bridge closed during native startup'); }
        if (launchFailure) fail('native_launch_failed', `Owned ME3 launcher failed: ${launchFailure.message}`);
        refuseExitedLauncher();
        const windows = (await bounded(sky.list_windows(), 10000, 'Startup window inventory')).filter(window => matches(window, input.game_executable));
        if (windows.length > 1) fail('native_target_ambiguous', 'Native startup exposed multiple exact process-path windows');
        await bindProcess(session);
        refuseExitedLauncher();
        if (windows.length === 1 && session.process) { session.window = windows[0]; break; }
        await pause(poll);
      }
      if (!session.window) fail('native_window_timeout', 'No exact target window appeared within the startup deadline');
      session.processes = await processesFor(session); await writeSession(session, 'processes.json', session.processes);
      signal?.throwIfAborted(); const initialWindow = await uniqueWindow(session); await bounded(sky.activate_window({ window: initialWindow }), 10000, 'Initial owned game activation');
      await uniqueWindow(session); await observe(session); signal?.throwIfAborted(); refuseExitedLauncher(); await protectSaves(session);
      if (await nativeFileDigest(input.game_executable) !== game.sha256 || await nativeFileDigest(input.me3_executable) !== me3.sha256) fail('native_artifact_changed', 'Selected executable changed during native startup');
      signal?.throwIfAborted(); refuseExitedLauncher(); session.receipt.status = 'running'; await writeSession(session, 'session.json', session.receipt); await writeSession(session, 'launcher.json', session.launcher_log);
      session.timer = setTimeout(() => { void enqueue(() => stop(session)).catch(() => {}); }, Math.max(0, Date.parse(session.receipt.expires_at) - Date.now()));
      return session.public;
    } catch (error) {
      if (session.receipt) { session.receipt.status = 'failed'; await writeSession(session, 'session.json', session.receipt).catch(() => {}); if (session.observation) await writeSession(session, 'observation.json', { ...session.observation, status: 'failed' }).catch(() => {}); }
      await writeSession(session, 'failure.json', diagnostic(error)).catch(() => {});
      // Keep ownership when a window is still open; never kill an inferred PID.
      if (session.launcher) { try { await bindProcess(session); if (session.process) await stop(session); else if ((await processesFor(session)).length || session.launcher_log.status !== 'exited') fail('native_shutdown_incomplete', 'Cancelled startup has no proven closable game window; retained for explicit recovery'); } catch (cleanupError) { await writeSession(session, 'cleanup-failure.json', diagnostic(cleanupError)).catch(() => {}); } }
      throw error;
    }
  }
  async function operation(raw, signal) {
    signal?.throwIfAborted();
    const request = z.discriminatedUnion('operation', [z.strictObject({ operation: z.literal('start'), input: nativeStartInput }),
      z.strictObject({ operation: z.literal('close-bridge') }),
      ...['inspect', 'focus', 'stop'].map(operation => z.strictObject({ operation: z.literal(operation), session_path: z.string().max(4096) })),
      z.strictObject({ operation: z.literal('act'), session_path: z.string().max(4096), action: nativeActionSchema })]).parse(raw);
    if (request.operation === 'close-bridge') return closeOwned();
    if (request.operation === 'start') return start(request.input, signal);
    if (request.operation === 'act' && request.action.kind === 'gamepad') fail('native_action_unsupported', 'The Sky bridge cannot send virtual gamepad input');
    const session = sessions.get(resolve(request.session_path)); if (!session) fail('native_session_unknown', 'Bridge does not own the selected native session');
    if (request.operation === 'stop') return stop(session);
    if (session.receipt.status !== 'running') fail('native_session_failed', 'Native session did not establish a running observed target');
    if (request.operation === 'inspect') return observe(session);
    if (request.operation === 'focus') { await observe(session); const window = await uniqueWindow(session); await bounded(sky.activate_window({ window }), 10000, 'Window activation'); return nativeFocusOutput.parse({ focused: true, observation: await observe(session) }); }
    const action = request.action, actionRecord = { kind: 'act', action, attempted_at: new Date().toISOString(), status: 'attempted' }; await appendRecord(session, actionRecord);
    try {
      const window = await uniqueWindow(session);
      if (action.kind === 'key') { await observe(session); await revalidateProcess(session); await bounded(sky.press_key({ window: session.window, key: action.key }), 10000, 'Native key input'); }
      else if (action.kind === 'click') {
        if (!session.state?.screenshots?.length || Date.now() - session.observed_at > 15000) fail('native_observation_required', 'Inspect a fresh actual native frame before coordinate input');
        const frame = session.state.screenshots[0]; if (!frame.width || !frame.height || action.x >= frame.width || action.y >= frame.height) fail('native_coordinates_refused', 'Coordinates require returned logical frame dimensions');
        await bounded(sky.click({ window, screenshotId: frame.id, x: action.x, y: action.y }), 10000, 'Native coordinate input');
      } else if (action.kind === 'wait') await pause(action.milliseconds);
      else fail('native_action_unsupported', 'The Sky bridge does not support this input action');
      session.state = null;
      const observation = await observe(session); actionRecord.status = 'observed'; actionRecord.observation = { ...observation, screenshots: observation.screenshots.map(frame => ({ ...frame, url: '[retained-in-observation.json]' })), screenshot_image_base64: '[retained-in-observation.json]', ...(observation.screenshot_png_base64 ? { screenshot_png_base64: '[retained-in-observation.json]' } : {}) };
      await writeSession(session, 'actions.json', session.actions); return nativeActOutput.parse({ action, observation });
    } catch (error) { session.state = null; actionRecord.status = 'failed'; actionRecord.error = diagnostic(error); await writeSession(session, 'actions.json', session.actions); throw error; }
  }
  const server = createServer((req, res) => { void (async () => {
    const controller = new AbortController(); res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    const auth = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${receipt.token}`);
    if (closing || req.method !== 'POST' || req.url !== '/control' || req.headers.origin !== undefined || auth.length !== expected.length || !timingSafeEqual(auth, expected)) { res.writeHead(403, { connection: 'close' }); res.end(JSON.stringify({ error: { code: 'native_control_refused' } })); return; }
    let count = 0; const chunks = []; for await (const chunk of req.iterator({ destroyOnReturn: false })) { count += chunk.length; if (count > 16384) fail('native_limit', 'Native control request exceeds 16 KiB'); chunks.push(chunk); }
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    const output = await enqueue(() => operation(raw, controller.signal)), body = JSON.stringify(output); if (Buffer.byteLength(body) > 24 * 1024 ** 2) fail('native_limit', 'Native response exceeds 24 MiB');
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close', 'cache-control': 'no-store' }); res.end(body);
  })().catch(error => { res.writeHead(400, { 'content-type': 'application/json', connection: 'close' }); res.end(JSON.stringify(diagnostic(error))); }); });
  server.requestTimeout = 150000; server.headersTimeout = 10000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  receipt.url = `http://127.0.0.1:${server.address().port}/control`;
  try { await ownedWrite(destination, bridgeIdentity, metadata, 'bridge.json', nativeBridgeReceiptSchema.parse(receipt)); } catch (error) { await new Promise(done => server.close(done)); throw error; }
  async function closeOwned() {
    if (closed) return { status: 'closed', bridge_path: bridgePath };
    closing = true; const errors = [];
    for (const session of [...sessions.values()]) { try { await stop(session); } catch (error) { errors.push(error); } }
    if (errors.length) { closing = false; throw errors[0]; }
    receipt.status = 'closed'; await ownedWrite(destination, bridgeIdentity, metadata, 'bridge.json', receipt);
    closed = true; server.close(); wakeHost?.();
    return { status: 'closed', bridge_path: bridgePath };
  }
  return { bridge_path: bridgePath,
    async dispatch(request, signal) {
      if (serving || dispatching || closed) fail('native_host_busy', 'Direct dispatch requires an idle open bridge host');
      dispatching = true; try { return await operation(request, signal); } finally { dispatching = false; }
    },
    async serve() {
      if (serving || dispatching || closed) fail('native_host_busy', 'Bridge host is already serving, dispatching or closed');
      serving = true;
      try {
        while (!closed) {
          if (!jobs.length) { await new Promise(done => { wakeHost = done; if (jobs.length || closed) done(); }); wakeHost = undefined; }
          const job = jobs.shift(); if (!job) continue;
          try { job.resolve(await job.run()); } catch (error) { job.reject(error); }
        }
      } finally { serving = false; for (const job of jobs.splice(0)) job.reject(new StudyError('native_bridge_closed', 'Native host closed before queued operation')); }
    },
    async close() { if (closed) return { status: 'closed', bridge_path: bridgePath }; if (dispatching) fail('native_host_busy', 'Wait for direct dispatch before closing its host'); return serving ? enqueue(closeOwned) : closeOwned(); }
  };
}
