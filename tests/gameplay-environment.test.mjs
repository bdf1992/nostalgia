import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createFileCheckpoint } from '../dist/fileCheckpoint.js';
import { startGameplayEnvironment, inspectGameplayEnvironment, actInGameplayEnvironment, stopGameplayEnvironment, closeAllGameplayEnvironments } from '../dist/gameplayEnvironment.js';

async function setup(t, html) {
  const root = await mkdtemp(join(tmpdir(), 'nostalgia-gameplay-'));
  const owned = resolve(root), parent = resolve(tmpdir());
  t.after(async () => { await closeAllGameplayEnvironments(); assert.notEqual(owned, parent); assert.ok(owned.startsWith(parent + sep)); await rm(owned, { recursive: true, force: true }); });
  const source = join(root, 'source'); await mkdir(source);
  const original = html ?? await readFile(resolve('evals/gameplay-fixture/index.html'));
  const sourcePath = join(source, 'index.html'); await writeFile(sourcePath, original);
  const checkpoint = join(root, 'checkpoint');
  await createFileCheckpoint({ files: [{ source: sourcePath, path: 'index.html' }], destination: checkpoint });
  const manifest = await readFile(join(checkpoint, 'manifest.json'));
  const started = [];
  t.after(async () => { for (const session_path of started) await stopGameplayEnvironment({ session_path }).catch(() => {}); });
  async function start(name, options = {}) { const result = await startGameplayEnvironment({ checkpoint, destination: join(root, name), ...options }); started.push(result.session_path); return result; }
  return { root, sourcePath, original: Buffer.from(original), checkpoint, manifest, start };
}
async function unchanged(data) {
  assert.deepEqual(await readFile(data.sourcePath), data.original);
  assert.deepEqual(await readFile(join(data.checkpoint, 'manifest.json')), data.manifest);
  assert.deepEqual(await readFile(join(data.checkpoint, 'payload', 'index.html')), data.original);
}
async function server(t, handler) {
  const http = createServer(handler); await new Promise(resolveListen => http.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => { await new Promise(done => { http.close(done); http.closeAllConnections(); }); });
  return { http, origin: `http://127.0.0.1:${http.address().port}` };
}

test('real browser gameplay can be observed, controlled, stopped and restarted with fresh storage', async t => {
  const data = await setup(t), started = await data.start('first');
  assert.equal(started.runtime.provider, 'playwright-chromium'); assert.equal(started.runtime.playwright_version, '1.64.0');
  assert.match(started.runtime.sha256, /^[a-f0-9]{64}$/); assert.equal(started.token, undefined); assert.equal(started.control_url, undefined);
  let observation = await inspectGameplayEnvironment({ session_path: started.session_path });
  assert.match(observation.visible_text, /Position: 0 \| Kills: 0 \| Gold: 0/);
  assert.deepEqual(Buffer.from(observation.screenshot_png_base64, 'base64').subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const moved = await actInGameplayEnvironment({ session_path: started.session_path, action: { kind: 'key', key: 'ArrowRight' } });
  assert.match(moved.observation.visible_text, /Position: 1/);
  const attacked = await actInGameplayEnvironment({ session_path: started.session_path, action: { kind: 'key', key: 'Space' } });
  assert.match(attacked.observation.visible_text, /Kills: 1/);
  // Test-only DOM reading locates the authored fixture; product actions remain coordinates/keys.
  const helper = await chromium.launch({ headless: true });
  let bounds;
  try { const page = await helper.newPage({ viewport: { width: 1280, height: 720 } }); await page.goto(started.gameplay_url); bounds = await page.locator('#collect').boundingBox(); } finally { await helper.close(); }
  assert.ok(bounds);
  const collected = await actInGameplayEnvironment({ session_path: started.session_path, action: { kind: 'click', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } });
  assert.match(collected.observation.visible_text, /Gold: 1/);
  observation = await inspectGameplayEnvironment({ session_path: started.session_path });
  assert.equal(observation.visible_text, collected.observation.visible_text);
  const journal = JSON.parse(await readFile(join(data.root, 'first', 'actions.json'), 'utf8'));
  assert.equal(journal.length, 3); assert.ok(journal.every(record => record.status === 'observed' && record.observation.screenshot_sha256));
  const receipt = JSON.parse(await readFile(started.session_path, 'utf8'));
  assert.equal((await fetch(receipt.control_url, { method: 'POST', body: '{"operation":"stop"}' })).status, 403);
  assert.equal((await fetch(receipt.control_url, { method: 'GET', headers: { authorization: `Bearer ${receipt.token}` } })).status, 403);
  assert.equal((await fetch(receipt.control_url, { method: 'POST', headers: { authorization: `Bearer ${receipt.token}`, origin: started.gameplay_url }, body: '{"operation":"stop"}' })).status, 403);
  assert.equal((await stopGameplayEnvironment({ session_path: started.session_path })).status, 'stopped');
  assert.equal((await inspectGameplayEnvironment({ session_path: started.session_path })).status, 'stopped');
  await assert.rejects(() => fetch(started.gameplay_url)); await assert.rejects(() => fetch(receipt.control_url));
  await assert.rejects(() => actInGameplayEnvironment({ session_path: started.session_path, action: { kind: 'key', key: 'Space' } }), error => error.code === 'environment_stopped');
  const restarted = await data.start('second');
  assert.notEqual(restarted.session_id, started.session_id);
  assert.match((await inspectGameplayEnvironment({ session_path: restarted.session_path })).visible_text, /Position: 0 \| Kills: 0 \| Gold: 0/);
  await unchanged(data);
});

test('real browser isolates HTTP and WebSocket origins and denies unlisted redirect hops', async t => {
  let allowedHits = 0, deniedHits = 0, allowedSockets = 0, deniedSockets = 0;
  const denied = await server(t, (_req, res) => { deniedHits++; res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('denied'); });
  const allowed = await server(t, (req, res) => { allowedHits++; if (req.url === '/redirect') { res.writeHead(302, { location: `${denied.origin}/redirect-target` }); res.end(); } else { res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('allowed'); } });
  allowed.http.on('upgrade', (_req, socket) => { allowedSockets++; socket.destroy(); }); denied.http.on('upgrade', (_req, socket) => { deniedSockets++; socket.destroy(); });
  const html = `<!doctype html><body>Network fixture<script>
    Promise.allSettled([fetch('${allowed.origin}/ok'),fetch('${allowed.origin}/redirect'),fetch('${denied.origin}/no')]).then(()=>document.body.append(' requests finished'));
    window.allowedSocket=new WebSocket('${allowed.origin.replace('http:', 'ws:')}/socket');window.allowedSocket.onerror=()=>document.body.append(' allowed socket ended');
    window.deniedSocket=new WebSocket('${denied.origin.replace('http:', 'ws:')}/socket');window.deniedSocket.onerror=()=>document.body.append(' denied socket ended');
    </script></body>`;
  const data = await setup(t, html), isolated = await data.start('isolated');
  await actInGameplayEnvironment({ session_path: isolated.session_path, action: { kind: 'wait', milliseconds: 500 } });
  assert.equal(allowedHits, 0); assert.equal(deniedHits, 0); assert.equal(allowedSockets, 0); assert.equal(deniedSockets, 0);
  await stopGameplayEnvironment({ session_path: isolated.session_path });
  const networked = await data.start('networked', { network: { mode: 'networked', allowed_origins: [allowed.origin] } });
  const networkObservation = await actInGameplayEnvironment({ session_path: networked.session_path, action: { kind: 'wait', milliseconds: 1000 } });
  assert.ok(allowedHits >= 2); assert.equal(deniedHits, 0); assert.ok(allowedSockets >= 1, networkObservation.observation.visible_text); assert.equal(deniedSockets, 0);
  const receipt = JSON.parse(await readFile(networked.session_path, 'utf8'));
  assert.equal((await fetch(`${new URL(networked.gameplay_url).origin}/session.json`)).status, 404);
  assert.equal((await fetch(`${new URL(networked.gameplay_url).origin}/../session.json`)).status, 404);
  assert.equal((await fetch(receipt.control_url, { method: 'POST', headers: { authorization: `Bearer ${receipt.token}` }, body: JSON.stringify({ operation: 'act', action: { kind: 'eval', code: '1' } }) })).status, 400);
  await unchanged(data);
});

test('unsafe gameplay paths and invalid entrypoints are refused before session writes', async t => {
  const data = await setup(t);
  const existing = join(data.root, 'existing'); await mkdir(existing); await writeFile(join(existing, 'keep'), 'unchanged');
  await assert.rejects(() => startGameplayEnvironment({ checkpoint: data.checkpoint, destination: existing }), error => error.code === 'environment_destination_exists');
  await assert.rejects(() => startGameplayEnvironment({ checkpoint: data.checkpoint, destination: join(data.checkpoint, 'session') }), error => error.code === 'environment_path_refused');
  const invalid = join(data.root, 'invalid');
  await assert.rejects(() => startGameplayEnvironment({ checkpoint: data.checkpoint, destination: invalid, entrypoint: '../source/index.html' }), error => error.code === 'environment_entrypoint_refused');
  await assert.rejects(() => startGameplayEnvironment({ checkpoint: data.checkpoint, destination: invalid, network: { mode: 'isolated', allowed_origins: ['https://example.com'] } }));
  const alias = join(data.root, 'alias'); await symlink(data.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => startGameplayEnvironment({ checkpoint: data.checkpoint, destination: join(alias, 'refused') }), error => error.code === 'environment_path_refused');
  const checkpointAlias = join(data.root, 'checkpoint-alias'); await symlink(data.checkpoint, checkpointAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => startGameplayEnvironment({ checkpoint: checkpointAlias, destination: invalid }));
  assert.equal(await readFile(join(existing, 'keep'), 'utf8'), 'unchanged');
  assert.ok(!(await readdir(data.root)).includes('invalid')); assert.ok(!(await readdir(data.root)).includes('refused'));
  await unchanged(data);
});

test('startup failure closes its real owned browser and endpoints while retaining the copied workspace', async t => {
  const data = await setup(t, Buffer.alloc(64 * 1024 ** 2 + 1, 32));
  await assert.rejects(() => data.start('failed'), error => error.code === 'environment_start_failed');
  const session_path = join(data.root, 'failed', 'session.json'), receipt = JSON.parse(await readFile(session_path, 'utf8'));
  assert.equal(receipt.status, 'failed');
  await assert.rejects(() => fetch(receipt.gameplay_url)); await assert.rejects(() => fetch(receipt.control_url));
  assert.ok((await readdir(join(data.root, 'failed'))).includes('game'));
  await unchanged(data);
});

test('non-HTTP top navigation closes the owned browser and retains a failed session', async t => {
  const data = await setup(t, '<!doctype html><body><button style="position:absolute;left:0;top:0;width:100px;height:100px" onclick="location.href=\'about:blank\'">Navigate</button></body>');
  const started = await data.start('navigation');
  await assert.rejects(() => actInGameplayEnvironment({ session_path: started.session_path, action: { kind: 'click', x: 50, y: 50 } }));
  let receipt;
  for (let attempt = 0; attempt < 50; attempt++) {
    receipt = JSON.parse(await readFile(started.session_path, 'utf8'));
    if (receipt.status === 'failed') break;
    await new Promise(done => setTimeout(done, 20));
  }
  assert.equal(receipt.status, 'failed');
  assert.equal((await inspectGameplayEnvironment({ session_path: started.session_path })).status, 'failed');
  await assert.rejects(() => fetch(started.gameplay_url)); await assert.rejects(() => fetch(receipt.control_url));
  await unchanged(data);
});

test('replaced or hard-linked metadata never truncates another file', async t => {
  const data = await setup(t), started = await data.start('metadata');
  const victim = join(data.root, 'external.txt'); await writeFile(victim, 'preserve external bytes');
  const observationPath = join(data.root, 'metadata', 'observation.json');
  await unlink(observationPath); await link(victim, observationPath);
  await assert.rejects(() => inspectGameplayEnvironment({ session_path: started.session_path }), error => error.code === 'environment_path_refused');
  assert.equal(await readFile(victim, 'utf8'), 'preserve external bytes');
  // Shutdown closes owned handles even when caller-modified metadata refuses updates.
  await closeAllGameplayEnvironments().catch(() => {});
  assert.equal(await readFile(victim, 'utf8'), 'preserve external bytes');
  await unchanged(data);
});

test('shutdown aborts and awaits pending startup before returning, and permits later starts', async t => {
  const data = await setup(t);
  const start = data.start('pending');
  const refused = assert.rejects(start, error => error.name === 'AbortError');
  await closeAllGameplayEnvironments(); await refused;
  // Immediate cancellation occurs before destination admission or browser launch.
  assert.ok(!(await readdir(data.root)).includes('pending'));
  const later = await data.start('later');
  assert.equal((await inspectGameplayEnvironment({ session_path: later.session_path })).status, 'running');
  await unchanged(data);
});
