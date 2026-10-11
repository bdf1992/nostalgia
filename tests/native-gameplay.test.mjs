import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright';
import { createFileCheckpoint } from '../dist/fileCheckpoint.js';
import { startGameplayEnvironment, inspectGameplayEnvironment, actInGameplayEnvironment, focusOnGameplayEnvironment, stopGameplayEnvironment } from '../dist/gameplayEnvironment.js';
import { createNativeSkyBridge } from '../scripts/native-sky-bridge.mjs';
import { nativeStartInput, nativeStartOutput, nativeActionSchema, nativeBridgeReceiptSchema } from '../dist/nativeGameplayEnvironment.js';
const execute = promisify(execFile);

const neutralGamepad = { kind: 'gamepad', connected: true, buttons: 0, left_trigger: 0, right_trigger: 0, left_x: 0, left_y: 0, right_x: 0, right_y: 0, lease_ms: 500 };

test('gamepad contract admits full bounded state and refuses unsafe leases, reserved buttons and disconnected controls', () => {
  assert.deepEqual(nativeActionSchema.parse(neutralGamepad), neutralGamepad);
  assert.equal(nativeActionSchema.parse({ ...neutralGamepad, buttons: 0xF3FF, left_trigger: 255, right_trigger: 255, left_x: -32768, left_y: 32767, right_x: -32768, right_y: 32767, lease_ms: 2000 }).buttons, 0xF3FF);
  assert.equal(nativeActionSchema.parse({ ...neutralGamepad, connected: false, lease_ms: 0 }).connected, false);
  for (const change of [{ buttons: 0x400 }, { buttons: 65536 }, { left_trigger: 256 }, { right_trigger: -1 }, { left_x: -32769 }, { left_y: 32768 }, { right_x: 0.5 }, { lease_ms: 2001 }, { lease_ms: 0 }, { connected: false }, { connected: false, lease_ms: 0, buttons: 16 }, { connected: false, lease_ms: 0, right_y: 1 }])
    assert.equal(nativeActionSchema.safeParse({ ...neutralGamepad, ...change }).success, false, JSON.stringify(change));
  const { right_trigger, ...incomplete } = neutralGamepad;
  assert.equal(nativeActionSchema.safeParse(incomplete).success, false);
});

test('Booth selection refuses Sky before launch and direct Sky dispatch refuses gamepad before any input', async t => {
  const data = await setup(t, { noHost: true });
  assert.equal(nativeStartInput.parse(data.request).backend, undefined);
  assert.equal(nativeStartInput.parse({ ...data.request, backend: 'booth' }).backend, 'booth');
  await assert.rejects(() => startGameplayEnvironment({ ...data.request, backend: 'booth' }), error => error.code === 'native_backend_mismatch');
  await assert.rejects(() => data.bridge.dispatch({ operation: 'start', input: { ...data.request, backend: 'booth' } }), error => error.code === 'native_backend_unsupported');
  assert.equal(data.model.launch, undefined); assert.deepEqual(data.model.calls, []);
  const result = await data.bridge.dispatch({ operation: 'start', input: data.request });
  const before = data.model.calls.length;
  await assert.rejects(() => data.bridge.dispatch({ operation: 'act', session_path: result.session_path, action: neutralGamepad }), error => error.code === 'native_action_unsupported');
  assert.equal(data.model.calls.length, before);
  const boothOutput = { ...result, runtime: { ...result.runtime, provider: 'windows-native-booth-protoinput' }, input_behavior: 'owned-hidden-desktop-virtual-input' };
  assert.equal(nativeStartOutput.parse(boothOutput).runtime.provider, 'windows-native-booth-protoinput');
  assert.equal(nativeStartOutput.safeParse({ ...boothOutput, input_behavior: result.input_behavior }).success, false);
  const bridge = JSON.parse(await readFile(data.bridge.bridge_path, 'utf8'));
  assert.equal(nativeBridgeReceiptSchema.parse({ ...bridge, provider: 'windows-native-booth-bridge' }).provider, 'windows-native-booth-bridge');
  await data.bridge.dispatch({ operation: 'stop', session_path: result.session_path });
});

test('retained observations cannot change the selected native input behavior', async t => {
  const data = await setup(t), started = await startGameplayEnvironment(data.request);
  await stopGameplayEnvironment({ session_path: started.session_path });
  const path = join(data.request.destination, 'observation.json'), observation = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...observation, input_behavior: 'owned-hidden-desktop-virtual-input' }));
  await assert.rejects(() => inspectGameplayEnvironment({ session_path: started.session_path }), error => error.code === 'native_backend_mismatch');
});

test('a bridge receipt cannot substitute a different runtime backend in its response', async t => {
  const data = await setup(t), started = await startGameplayEnvironment(data.request);
  await stopGameplayEnvironment({ session_path: started.session_path });
  let calls = 0;
  const server = createServer((request, response) => { calls++; request.resume(); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(started)); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const bridge = JSON.parse(await readFile(data.bridge.bridge_path, 'utf8'));
  await writeFile(data.bridge.bridge_path, JSON.stringify({ ...bridge, provider: 'windows-native-booth-bridge', url: `http://127.0.0.1:${server.address().port}/control` }));
  await assert.rejects(() => startGameplayEnvironment({ ...data.request, backend: 'booth' }), error => error.code === 'native_backend_mismatch');
  assert.equal(calls, 1);
  await assert.rejects(() => startGameplayEnvironment(data.request), error => error.code === 'native_backend_mismatch');
  assert.equal(calls, 1, 'Legacy Sky selection must refuse the Booth bridge before HTTP');
});

function png() {
  const chunk = (type, data) => { const kind = Buffer.from(type), output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); kind.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([kind, data])), data.length + 8); return output; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0,255]))), chunk('IEND', Buffer.alloc(0))]);
}
async function setup(t, options = {}) {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'nostalgia-native-'));
  const model = { windows: [], alive: false, calls: [], closeWorks: true, processRemains: false, frameDelay: 0, png: `data:image/png;base64,${png().toString('base64')}`, ...options };
  let bridge;
  t.after(async () => { model.closeWorks = true; model.processRemains = false; if (model.child && !model.alive) model.child.emit('exit', 0, null); await bridge?.close(); const child = relative(parent, resolve(root)); assert.ok(child && !child.startsWith('..') && !isAbsolute(child)); await rm(root, { recursive: true, force: true }); });
  const shared = join(root, 'shared'); await mkdir(shared);
  const game_executable = join(shared, 'eldenring.exe'), me3_executable = join(shared, 'me3.exe');
  await writeFile(game_executable, 'original synthetic executable identity'); await writeFile(me3_executable, 'original synthetic ME3 identity');
  const saves = join(root, 'saves'); await mkdir(saves); const primary = join(saves, 'ER0000.sl2'); await writeFile(primary, 'original primary save');
  const checkpoint = join(root, 'checkpoint');
  await createFileCheckpoint({ files: [{ source: game_executable, path: 'game/eldenring.exe' }, { source: primary, path: 'profile/account/ER0000.sl2' }], destination: checkpoint });
  const target = { id: 42, app: `process:${game_executable}`, title: 'Original fake window' };
  const sky = {
    async list_windows() { return model.windows; },
    async get_window(input) { model.calls.push(['get_window', input]); return model.rehydrated ?? model.windows.find(window => window.id === input.id); },
    async get_window_state(input) { model.calls.push(['get_window_state', input]); model.frameStarted?.(); if (model.frameDelay) await new Promise(done => setTimeout(done, model.frameDelay)); return { window: model.frameWindow ?? input.window,
      screenshots: model.emptyFrame ? [] : [{ id: `frame-${model.calls.length}`, url: model.png, width: model.frameWidth ?? 1, height: 1, zIndex: 0 }], accessibility: { tree: 'Original synthetic accessibility frame' } }; },
    async press_key(input) { model.calls.push(['press_key', input]); if (input.key === 'Alt+F4' && model.closeWorks) { model.windows = []; if (!model.processRemains) { model.alive = false; model.child?.emit('exit', 0, null); } } },
    async click(input) { model.calls.push(['click', input]); }, async activate_window(input) { model.calls.push(['activate_window', input]); },
  };
  const launcher = (command, args, settings) => {
    model.launch = { command, args, settings }; const child = new EventEmitter(); child.pid = 111; child.stdout = new PassThrough(); child.stderr = new PassThrough(); model.child = child;
    queueMicrotask(() => {
      if (model.exitBeforeWindow) { child.stderr.write('error: unable to locate savefile directory'); child.emit('exit', 0, null); return; }
      model.alive = true; model.windows = model.ambiguous ? [target, { ...target, id: 43 }] : [target]; child.stderr.write('DEBUG me3_launcher::game: attaching to process pid=9000\n');
    });
    return child;
  };
  if (options.checkContext) for (const method of Object.keys(sky)) { const call = sky[method]; sky[method] = async input => { options.checkContext(); return call(input); }; }
  const listProcesses = async () => model.alive ? [{ pid: model.processPid ?? 9000, created_at: model.processCreated ?? '2026-10-11T00:00:00.000Z', executable: game_executable }] : [];
  bridge = await createNativeSkyBridge({ sky, destination: join(root, 'bridge'), ...(options.runtime ? { runtime: options.runtime } : {}) }, { launcher, listProcesses, originalSavePaths: async () => [primary], ...(options.environment ? { inheritedEnvironment: async () => options.environment } : {}), pollMilliseconds: 5, windowTimeoutMilliseconds: 300, stopTimeoutMilliseconds: 30 });
  if (!options.noHost) { const host = options.hostRun ? options.hostRun(() => bridge.serve()) : bridge.serve(); t.after(() => host); }
  const request = { provider: 'windows-native', bridge_path: bridge.bridge_path, checkpoint, destination: join(root, 'session'), me3_executable, game_executable, savefile: 'Nostalgia_Synthetic.sl2', mode: 'application-offline' };
  return { root, bridge, model, target, request, primary, checkpoint, game_executable, me3_executable };
}

test('foreign HTTP callbacks execute every sky operation inside the active host pump context', async t => {
  const context = new AsyncLocalStorage(); let checked = 0;
  const data = await context.run('creator', () => setup(t, {
    checkContext: () => { assert.equal(context.getStore(), 'active-host'); checked++; },
    hostRun: run => context.run('active-host', run),
  }));
  await context.run('foreign-client', async () => {
    const result = await startGameplayEnvironment(data.request);
    await inspectGameplayEnvironment({ session_path: result.session_path });
    await actInGameplayEnvironment({ session_path: result.session_path, action: { kind: 'key', key: 'Return' } });
    await focusOnGameplayEnvironment({ session_path: result.session_path });
    const receipt = JSON.parse(await readFile(data.bridge.bridge_path, 'utf8'));
    const response = await fetch(receipt.url, { method: 'POST', headers: { authorization: `Bearer ${receipt.token}` }, body: JSON.stringify({ operation: 'close-bridge' }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'closed');
    assert.equal(data.model.alive, false);
  });
  assert.ok(checked > 10); assert.equal(JSON.parse(await readFile(data.bridge.bridge_path, 'utf8')).status, 'closed');
});

test('idle direct dispatch refuses concurrent dispatch, serving and close before ownership settles', async t => {
  let frameStarted; const appeared = new Promise(done => { frameStarted = done; });
  const data = await setup(t, { noHost: true, frameDelay: 50, frameStarted });
  const starting = data.bridge.dispatch({ operation: 'start', input: data.request });
  await appeared;
  await assert.rejects(() => data.bridge.dispatch({ operation: 'close-bridge' }), error => error.code === 'native_host_busy');
  await assert.rejects(() => data.bridge.serve(), error => error.code === 'native_host_busy');
  await assert.rejects(() => data.bridge.close(), error => error.code === 'native_host_busy');
  const result = await starting;
  assert.equal((await data.bridge.dispatch({ operation: 'stop', session_path: result.session_path })).status, 'stopped');
});

test('a zero launcher exit before a usable game frame promptly refuses startup with its retained diagnostic', async t => {
  const data = await setup(t, { exitBeforeWindow: true });
  await assert.rejects(() => startGameplayEnvironment(data.request), error => error.code === 'native_launch_failed' && error.message.includes('unable to locate savefile directory'));
  const receipt = JSON.parse(await readFile(join(data.request.destination, 'session.json'), 'utf8'));
  assert.equal(receipt.status, 'failed'); assert.equal(data.model.alive, false);
  assert.equal(JSON.parse(await readFile(join(data.request.destination, 'launcher.json'), 'utf8')).code, 0);
});

test('explicit APPDATA applies only to the owned launcher while preserving private inherited environment', async t => {
  const data = await setup(t, { runtime: { platform: 'win32', appdata: 'C:\\Synthetic\\Roaming' }, environment: { PATH: 'synthetic-path', APPDATA: 'wrong', PRIVATE_SYNTHETIC: 'not-a-receipt' } });
  const result = await startGameplayEnvironment(data.request);
  assert.equal(data.model.launch.settings.env.APPDATA, 'C:\\Synthetic\\Roaming');
  assert.equal(data.model.launch.settings.env.PATH, 'synthetic-path');
  assert.equal(data.model.launch.settings.env.PRIVATE_SYNTHETIC, 'not-a-receipt');
  for (const file of ['session.json', 'launcher.json', 'observation.json']) assert.ok(!(await readFile(join(data.request.destination, file), 'utf8')).includes('not-a-receipt'));
  await stopGameplayEnvironment({ session_path: result.session_path });
});

test('compiled CLI and stdio MCP share the retained native bridge with actual synthetic frame content', async t => {
  const data = await setup(t), cli = resolve('dist/cli.js');
  const callCli = async (command, input) => {
    const request = join(data.root, `${command}.json`); await writeFile(request, JSON.stringify(input));
    const { stdout, stderr } = await execute(process.execPath, [cli, command, request], { timeout: 10000, maxBuffer: 1024 * 1024 });
    assert.equal(stderr, ''); return JSON.parse(stdout);
  };
  const started = await callCli('start-gameplay-environment', data.request);
  const client = new Client({ name: 'native-fixture-verifier', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', bytes => { stderr += bytes; });
  t.after(async () => { await client.close(); assert.equal(stderr, ''); });
  await client.connect(transport);
  const selected = { session_path: started.session_path };
  const observed = await client.callTool({ name: 'inspect_gameplay_environment', arguments: selected });
  assert.equal(observed.isError, undefined); assert.equal(observed.structuredContent.session_id, started.session_id);
  assert.equal(observed.content.find(item => item.type === 'image').data, data.model.png.slice(22));
  const acted = await client.callTool({ name: 'act_in_gameplay_environment', arguments: { ...selected, action: { kind: 'key', key: 'Return' } } });
  assert.equal(acted.structuredContent.observation.session_id, started.session_id);
  const focused = await client.callTool({ name: 'focus_on_gameplay_environment', arguments: selected });
  assert.equal(focused.structuredContent.focused, true); assert.equal(focused.content.find(item => item.type === 'image').mimeType, 'image/png');
  assert.equal((await callCli('stop-gameplay-environment', selected)).status, 'stopped');
  assert.equal(await readFile(data.primary, 'utf8'), 'original primary save');
});

test('actual authored JPEG bytes retain their MIME and truncated or dimension-mismatched frames refuse', async t => {
  const browser = await chromium.launch({ headless: true }); let jpeg;
  try { const page = await browser.newPage(); jpeg = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); context.fillStyle = '#009966'; context.fillRect(0, 0, 1, 1); return canvas.toDataURL('image/jpeg'); }); }
  finally { await browser.close(); }
  const data = await setup(t, { png: jpeg }), started = await startGameplayEnvironment(data.request);
  const observed = await inspectGameplayEnvironment({ session_path: started.session_path });
  assert.equal(observed.screenshot_mime_type, 'image/jpeg'); assert.equal(observed.screenshot_image_base64, jpeg.slice(jpeg.indexOf(',') + 1));
  assert.equal(observed.screenshot_png_base64, undefined); assert.equal(observed.screenshots[0].url, jpeg);
  const complete = Buffer.from(observed.screenshot_image_base64, 'base64'); data.model.png = `data:image/jpeg;base64,${complete.subarray(0, -2).toString('base64')}`;
  await assert.rejects(() => inspectGameplayEnvironment({ session_path: started.session_path }), error => error.code === 'native_frame_invalid');
  data.model.png = jpeg; data.model.frameWidth = 2;
  await assert.rejects(() => inspectGameplayEnvironment({ session_path: started.session_path }), error => error.code === 'native_frame_invalid');
  data.model.frameWidth = undefined; await stopGameplayEnvironment({ session_path: started.session_path });
});

test('shared native routes restore fresh files, pin launch identity and retain actual frames with targeted controls', async t => {
  const data = await setup(t), result = await startGameplayEnvironment(data.request);
  assert.equal(result.provider, 'windows-native'); assert.equal(result.coverage, 'declared-files-copied-shared-game-assets-referenced');
  assert.equal(result.token, undefined); assert.equal(result.runtime.mode, 'application-offline');
  assert.ok(data.model.launch.args.includes('--online=false')); assert.ok(data.model.launch.args.includes('--no-mem-patch=true')); assert.ok(data.model.launch.args.includes('--show-logos=true'));
  assert.ok(!data.model.launch.args.includes('--package')); assert.equal(data.model.launch.settings.shell, false); assert.equal(data.model.launch.settings.windowsHide, true);
  const profile = await readFile(result.runtime.profile.path, 'utf8'); assert.match(profile, /natives = \[\]/); assert.match(profile, /packages = \[\]/); assert.match(profile, /savefile = "Nostalgia_Synthetic.sl2"/);
  assert.equal(await readFile(join(result.working_directory, 'profile/account/ER0000.sl2'), 'utf8'), 'original primary save');
  const observed = await inspectGameplayEnvironment({ session_path: result.session_path }); assert.equal(observed.screenshots[0].url, data.model.png); assert.equal(observed.window.id, data.target.id);
  assert.equal(observed.screenshots[0].width, 1); assert.equal(observed.visible_text, 'Original synthetic accessibility frame');
  const key = await actInGameplayEnvironment({ session_path: result.session_path, action: { kind: 'key', key: 'Return' } }); assert.equal(key.observation.window.app, data.target.app);
  await actInGameplayEnvironment({ session_path: result.session_path, action: { kind: 'click', x: 0, y: 0 } });
  const click = data.model.calls.find(call => call[0] === 'click')[1]; assert.equal(click.window.app, data.target.app); assert.match(click.screenshotId, /^frame-/);
  assert.equal((await focusOnGameplayEnvironment({ session_path: result.session_path })).focused, true);
  assert.equal((await stopGameplayEnvironment({ session_path: result.session_path })).status, 'stopped');
  assert.equal(data.model.alive, false); assert.equal((await inspectGameplayEnvironment({ session_path: result.session_path })).status, 'stopped');
  assert.equal(await readFile(data.primary, 'utf8'), 'original primary save'); assert.ok(!(await readdir(join(data.root, 'saves'))).includes('ER0000.sl2.bak'));
  const journal = JSON.parse(await readFile(join(data.root, 'session', 'actions.json'), 'utf8')); assert.ok(journal.some(record => record.status === 'window-disappearance-observed'));
});

test('existing processes, mismatched frames and ambiguous exact windows refuse ownership and input', async t => {
  const running = await setup(t); running.model.alive = true;
  await assert.rejects(() => startGameplayEnvironment(running.request), error => error.code === 'native_target_already_running'); assert.equal(running.model.launch, undefined); running.model.alive = false;
  const ambiguous = await setup(t, { ambiguous: true });
  await assert.rejects(() => startGameplayEnvironment(ambiguous.request), error => error.code === 'native_target_ambiguous'); ambiguous.model.windows = []; ambiguous.model.alive = false; ambiguous.model.child.emit('exit', 0, null);
  const mismatch = await setup(t, { frameWindow: { id: 42, app: 'process:C:\\unrelated\\eldenring.exe' } });
  await assert.rejects(() => startGameplayEnvironment(mismatch.request), error => error.code === 'native_target_changed');
  assert.ok(!mismatch.model.calls.some(call => call[0] === 'click')); assert.equal(mismatch.model.alive, false);
});

test('bridge metadata, authentication, request bounds and malformed native controls are refused', async t => {
  const data = await setup(t), bridge = JSON.parse(await readFile(data.bridge.bridge_path, 'utf8'));
  assert.equal((await fetch(bridge.url, { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(bridge.url, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, origin: 'http://localhost' }, body: '{}' })).status, 403);
  assert.equal((await fetch(bridge.url, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body: ' '.repeat(17000) })).status, 400);
  await assert.rejects(() => startGameplayEnvironment({ ...data.request, savefile: 'ER0000.sl2' }));
  await assert.rejects(() => startGameplayEnvironment({ ...data.request, me3_executable: join(data.root, 'cmd.exe') }));
  const result = await startGameplayEnvironment(data.request);
  await assert.rejects(() => actInGameplayEnvironment({ session_path: result.session_path, action: { kind: 'key', key: 'Win+r' } }));
  await assert.rejects(() => actInGameplayEnvironment({ session_path: result.session_path, action: { kind: 'click', x: 2, y: 0 } }), error => error.code === 'native_coordinates_refused');
  await stopGameplayEnvironment({ session_path: result.session_path });
  const bad = { ...bridge, url: 'http://example.com/control' }; const badPath = join(data.root, 'bad-bridge.json'); bad.bridge_path = badPath; await writeFile(badPath, JSON.stringify(bad));
  await assert.rejects(() => startGameplayEnvironment({ ...data.request, destination: join(data.root, 'bad-session'), bridge_path: badPath }));
});

test('truncated PNG and changed owned process identity cannot become valid input observations', async t => {
  const invalid = await setup(t, { png: 'data:image/png;base64,iVBORw0KGgo=' });
  await assert.rejects(() => startGameplayEnvironment(invalid.request), error => error.code === 'native_frame_invalid'); assert.equal(invalid.model.alive, false);
  const data = await setup(t), result = await startGameplayEnvironment(data.request); data.model.processCreated = 'reused-PID-different-start';
  await assert.rejects(() => actInGameplayEnvironment({ session_path: result.session_path, action: { kind: 'key', key: 'Return' } }), error => error.code === 'native_ownership_unproven');
  assert.ok(!data.model.calls.some(call => call[0] === 'press_key')); data.model.processCreated = undefined; await stopGameplayEnvironment({ session_path: result.session_path });
});

test('stop reports incomplete shutdown when window or process remains and retains owned session', async t => {
  const data = await setup(t), result = await startGameplayEnvironment(data.request); data.model.closeWorks = false;
  await assert.rejects(() => stopGameplayEnvironment({ session_path: result.session_path }), error => error.code === 'native_shutdown_incomplete');
  assert.equal(JSON.parse(await readFile(result.session_path, 'utf8')).status, 'running');
  data.model.closeWorks = true; data.model.processRemains = true;
  await assert.rejects(() => stopGameplayEnvironment({ session_path: result.session_path }), error => error.code === 'native_shutdown_incomplete');
  data.model.alive = false; data.model.processRemains = false; data.model.child.emit('exit', 0, null); await stopGameplayEnvironment({ session_path: result.session_path });
});

test('cancelled delayed startup closes its owned fake game before becoming running', async t => {
  const data = await setup(t, { frameDelay: 150 }), controller = new AbortController();
  let started; const enteredFrame = new Promise(done => { started = done; }); data.model.frameStarted = started;
  const pending = startGameplayEnvironment(data.request, controller.signal); const refusal = assert.rejects(pending, error => error.name === 'AbortError');
  await enteredFrame; controller.abort();
  await refusal;
  await new Promise(done => setTimeout(done, 250));
  assert.equal(data.model.alive, false); assert.equal(JSON.parse(await readFile(join(data.root, 'session', 'session.json'), 'utf8')).status, 'stopped');
});

test('an explicitly captured save seeds one fresh alternate without replacing primary or existing files', async t => {
  const data = await setup(t), seedSource = join(data.root, 'seed-source'); await mkdir(seedSource);
  const save = join(seedSource, 'test.sl2'); await writeFile(save, 'original synthetic resumed test save'); const seedCheckpoint = join(data.root, 'seed-checkpoint');
  const seed = await createFileCheckpoint({ files: [{ source: save, path: 'profile/test.sl2' }], destination: seedCheckpoint });
  const result = await startGameplayEnvironment({ ...data.request, save_seed: { checkpoint: seedCheckpoint, path: 'profile/test.sl2' } });
  assert.equal(result.save_seed.checkpoint_id, seed.checkpoint_id); assert.equal(result.save_seed.sha256, seed.files[0].sha256);
  assert.equal(await readFile(result.save_seed.created_save_path, 'utf8'), 'original synthetic resumed test save');
  assert.equal(await readFile(data.primary, 'utf8'), 'original primary save'); await stopGameplayEnvironment({ session_path: result.session_path });
  await assert.rejects(() => startGameplayEnvironment({ ...data.request, destination: join(data.root, 'existing-alternate'), save_seed: { checkpoint: seedCheckpoint, path: 'profile/test.sl2' } }), error => error.code === 'native_savefile_exists');
  assert.equal(await readFile(result.save_seed.created_save_path, 'utf8'), 'original synthetic resumed test save');
});
