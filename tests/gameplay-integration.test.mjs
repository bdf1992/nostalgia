import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createFileCheckpoint } from '../dist/fileCheckpoint.js';

const cli = resolve('dist/cli.js');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nostalgia-gameplay-integration-'));
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    const part = relative(resolve(tmpdir()), resolve(root));
    assert.ok(part && part !== '..' && !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(part));
    await rm(root, { recursive: true, force: true });
  });
  const source = resolve('evals/gameplay-fixture/index.html'), original = await readFile(source);
  const checkpoint = join(root, 'checkpoint');
  await createFileCheckpoint({ files: [{ source, path: 'index.html' }], destination: checkpoint });
  return { root, source, original, checkpoint, cleanups };
}
async function callCli(root, command, input) {
  const request = join(root, `${command}.json`);
  await writeFile(request, JSON.stringify(input));
  const result = spawnSync(process.execPath, [cli, command, request], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('CLI gameplay launch stays available for separate input and stop commands', { timeout: 60000 }, async t => {
  const data = await fixture(t), request = join(data.root, 'start.json');
  await writeFile(request, JSON.stringify({ checkpoint: data.checkpoint, destination: join(data.root, 'session'), lifetime_seconds: 60 }));
  const child = spawn(process.execPath, [cli, 'start-gameplay-environment', request], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const ended = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  data.cleanups.push(async () => {
    if (child.exitCode === null) child.kill();
    await Promise.race([ended, new Promise(done => setTimeout(done, 3000).unref())]);
  });
  const lines = createInterface({ input: child.stdout });
  const started = await new Promise((resolveStart, reject) => {
    const timer = setTimeout(() => reject(new Error(`CLI startup timed out: ${stderr}`)), 30000);
    lines.once('line', line => { clearTimeout(timer); try { resolveStart(JSON.parse(line)); } catch (error) { reject(error); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.ok(started.session_path);
  const session = { session_path: started.session_path };
  data.cleanups.unshift(async () => { if (child.exitCode === null) await callCli(data.root, 'stop-gameplay-environment', session).catch(() => {}); });
  const before = await callCli(data.root, 'inspect-gameplay-environment', session);
  assert.match(before.visible_text, /Position: 0/);
  const moved = await callCli(data.root, 'act-in-gameplay-environment', { ...session, action: { kind: 'key', key: 'ArrowRight' } });
  assert.match(moved.observation.visible_text, /Position: 1/);
  const stopped = await callCli(data.root, 'stop-gameplay-environment', session);
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(await ended, { code: 0, signal: null });
  lines.close();
  assert.equal(stderr, '');
  await assert.rejects(fetch(started.gameplay_url));
  assert.deepEqual(await readFile(data.source), data.original);
});

test('stdio MCP starts, plays and observes a game, and disconnect closes its session', { timeout: 60000 }, async t => {
  const data = await fixture(t);
  const client = new Client({ name: 'nostalgia-gameplay-verifier', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', bytes => { stderr += bytes; });
  data.cleanups.push(() => client.close());
  await client.connect(transport);
  const launched = await client.callTool({ name: 'start_gameplay_environment', arguments: { checkpoint: data.checkpoint, destination: join(data.root, 'mcp-session'), lifetime_seconds: 60 } });
  assert.equal(launched.isError, undefined);
  const started = launched.structuredContent, session = { session_path: started.session_path };
  const action = await client.callTool({ name: 'act_in_gameplay_environment', arguments: { ...session, action: { kind: 'key', key: 'Space' } } });
  assert.equal(action.isError, undefined);
  assert.match(action.structuredContent.observation.visible_text, /Kills: 1/);
  assert.ok(action.content.some(block => block.type === 'image' && block.mimeType === 'image/png'));
  const observation = await client.callTool({ name: 'inspect_gameplay_environment', arguments: session });
  assert.equal(observation.structuredContent.session_id, started.session_id);
  assert.equal(observation.structuredContent.visible_text, action.structuredContent.observation.visible_text);
  await client.close();
  // EOF cleanup is asynchronous; poll the owned endpoint within a bounded period.
  let closed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await fetch(started.gameplay_url, { signal: AbortSignal.timeout(500) }); }
    catch { closed = true; break; }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(closed, 'Disconnect must close owned gameplay host');
  assert.equal(stderr, '');
  assert.deepEqual(await readFile(data.source), data.original);
});
