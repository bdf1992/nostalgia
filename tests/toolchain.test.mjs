import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { inspectToolchain, providerIds } from '../dist/toolchain.js';

test('CLI/MCP toolchain inspection detects changed and missing files without running providers', async t => {
  for (const file of ['catalog/toolchain.json', 'catalog/toolchain.windows.lock.json']) {
    const registry = JSON.parse(await readFile(resolve(file), 'utf8'));
    assert.deepEqual(registry.providers.map(p => p.id).sort(), [...providerIds].sort());
  }
  const root = await mkdtemp(join(tmpdir(), 'nostalgia-toolchain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // A file deliberately unsuitable for execution: only identity should be checked.
  const artifact = join(root, 'provider.bin');
  const original = 'original provider fixture';
  await writeFile(artifact, original);
  const digest = createHash('sha256').update(original).digest('hex');
  const manifest = { schema_version: 1, recorded_at: '2026-10-11T00:00:00Z', providers: providerIds.map(id => ({
    id, version: 'fixture', mode: 'synthetic', verification: 'installed-untested',
    artifacts: [{ path: artifact, sha256: digest }], receipt_path: artifact, limitations: ['fixture only'],
  })) };
  const manifestPath = join(root, 'manifest.json');
  const requestPath = join(root, 'request.json');
  const input = { manifest_path: manifestPath };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(requestPath, JSON.stringify(input));
  const result = spawnSync(process.execPath, [resolve('dist/cli.js'), 'inspect-toolchain', requestPath], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const cli = JSON.parse(result.stdout);
  assert.equal(cli.execution, 'not_executed');
  assert.ok(cli.providers.every(p => p.status === 'files-matched'));
  const client = new Client({ name: 'nostalgia-toolchain-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp'] }));
  const mcp = await client.callTool({ name: 'inspect_toolchain', arguments: input });
  assert.deepEqual(mcp.structuredContent, cli);
  await writeFile(artifact, 'changed');
  assert.ok((await inspectToolchain(input)).providers.every(p => p.artifacts[0].status === 'drifted'));
  await rm(artifact);
  assert.ok((await inspectToolchain(input)).providers.every(p => p.artifacts[0].status === 'unreadable'));
  manifest.providers[0].id = manifest.providers[1].id;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(inspectToolchain(input), /exactly once/);
  await assert.rejects(inspectToolchain({ manifest_path: 'relative.json' }), /absolute/);
  await assert.rejects(inspectToolchain({ manifest_path: root }), /regular file|EISDIR|EPERM/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectToolchain(input, controller.signal), { name: 'AbortError' });
});
