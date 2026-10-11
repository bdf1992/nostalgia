import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const cli = resolve('dist/cli.js');
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'nostalgia-checkpoint-tools-'));
  const owned = resolve(root), parent = resolve(tmpdir());
  t.after(async () => {
    assert.notEqual(owned, parent);
    assert.ok(owned.startsWith(parent.endsWith(sep) ? parent : parent + sep));
    await rm(owned, { recursive: true, force: true });
  });
  const source = join(root, 'source'); await mkdir(source);
  const files = [{ source: join(source, 'rules.txt'), path: 'config/rules.txt' },
    { source: join(source, 'image.bin'), path: 'manifest.json' },
    { source: join(source, 'empty.txt'), path: 'empty.txt' }];
  const bytes = [Buffer.from('original synthetic rule data\n'), Buffer.from([0, 1, 2, 255]), Buffer.alloc(0)];
  for (let i = 0; i < files.length; i++) await writeFile(files[i].source, bytes[i]);
  const client = new Client({ name: 'nostalgia-checkpoint-verifier', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', data => { stderr += data; });
  t.after(async () => { await client.close(); assert.equal(stderr, ''); });
  await client.connect(transport);
  return { root, source, files, bytes, client };
}
async function invoke(root, command, input) {
  const request = join(root, 'request.json');
  await writeFile(request, JSON.stringify(input));
  const result = spawnSync(process.execPath, [cli, command, request], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.stderr, '');
  return { status: result.status, output: JSON.parse(result.stdout) };
}
function successful(result) {
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}
async function originalsUnchanged(data) {
  for (let i = 0; i < data.files.length; i++) assert.deepEqual(await readFile(data.files[i].source), data.bytes[i]);
  assert.deepEqual((await readdir(data.root)).filter(name => name.startsWith('.nostalgia-checkpoint-')), []);
}
async function failureParity(data, command, input, code) {
  const fromCli = await invoke(data.root, command, input);
  const fromMcp = await data.client.callTool({ name: command.replaceAll('-', '_'), arguments: input });
  assert.equal(fromCli.status, 1); assert.equal(fromMcp.isError, true);
  assert.equal(fromMcp.structuredContent, undefined);
  assert.equal(fromCli.output.error.code, code);
  assert.deepEqual(JSON.parse(fromMcp.content[0].text), fromCli.output);
}

test('compiled CLI and stdio MCP capture, verify and restore declared files with consistent records', async t => {
  const data = await setup(t);
  const checkpoint = join(data.root, 'checkpoint-cli'), mcpCheckpoint = join(data.root, 'checkpoint-mcp');
  const created = await invoke(data.root, 'create-file-checkpoint', { files: data.files, destination: checkpoint });
  assert.equal(created.status, 0);
  const mcpCreated = successful(await data.client.callTool({ name: 'create_file_checkpoint', arguments: { files: data.files, destination: mcpCheckpoint } }));
  assert.deepEqual(mcpCreated.files, created.output.files);
  assert.equal(mcpCreated.checkpoint, mcpCheckpoint); assert.equal(created.output.checkpoint, checkpoint);
  const manifests = new Map();
  for (const [path, record] of [[checkpoint, created.output], [mcpCheckpoint, mcpCreated]]) {
    assert.match(record.checkpoint_id, /^cp_[a-f0-9]{64}$/);
    assert.equal(record.coverage, 'declared-files-only'); assert.equal(record.runtime_state, 'not_captured');
    const verified = await invoke(data.root, 'verify-file-checkpoint', { checkpoint: path });
    assert.equal(verified.status, 0);
    const mcpVerified = successful(await data.client.callTool({ name: 'verify_file_checkpoint', arguments: { checkpoint: path } }));
    assert.deepEqual(mcpVerified, verified.output);
    assert.deepEqual(verified.output, { ...record, provenance: 'caller-supplied-not-authenticated' });
    manifests.set(path, await readFile(join(path, 'manifest.json')));
  }
  const destination = join(data.root, 'restore-cli'), mcpDestination = join(data.root, 'restore-mcp');
  const restored = await invoke(data.root, 'restore-file-checkpoint', { checkpoint, destination });
  assert.equal(restored.status, 0);
  const mcpRestored = successful(await data.client.callTool({ name: 'restore_file_checkpoint', arguments: { checkpoint, destination: mcpDestination } }));
  assert.deepEqual(mcpRestored, { ...restored.output, destination: mcpDestination });
  assert.equal(restored.output.checkpoint_id, created.output.checkpoint_id);
  assert.deepEqual(restored.output.files, created.output.files);
  for (const path of [destination, mcpDestination]) {
    for (let i = 0; i < data.files.length; i++) assert.deepEqual(await readFile(join(path, ...data.files[i].path.split('/'))), data.bytes[i]);
  }
  for (const [path, bytes] of manifests) assert.deepEqual(await readFile(join(path, 'manifest.json')), bytes);
  await originalsUnchanged(data);
});

test('checkpoint tool semantic failures match CLI diagnostics and preserve existing destinations', async t => {
  const data = await setup(t), checkpoint = join(data.root, 'checkpoint');
  const capture = { files: data.files, destination: checkpoint };
  assert.equal((await invoke(data.root, 'create-file-checkpoint', capture)).status, 0);
  const manifest = await readFile(join(checkpoint, 'manifest.json'));
  await failureParity(data, 'create-file-checkpoint', capture, 'checkpoint_destination_exists');
  assert.deepEqual(await readFile(join(checkpoint, 'manifest.json')), manifest);
  const destination = join(data.root, 'existing'); await mkdir(destination);
  await writeFile(join(destination, 'keep.txt'), 'preserve existing destination');
  await failureParity(data, 'restore-file-checkpoint', { checkpoint, destination }, 'checkpoint_destination_exists');
  assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'preserve existing destination');
  await writeFile(join(checkpoint, 'payload', 'config', 'rules.txt'), 'corrupted payload');
  await failureParity(data, 'verify-file-checkpoint', { checkpoint }, 'checkpoint_digest_mismatch');
  const refused = join(data.root, 'refused-restore');
  await failureParity(data, 'restore-file-checkpoint', { checkpoint, destination: refused }, 'checkpoint_digest_mismatch');
  assert.ok(!(await readdir(data.root)).includes('refused-restore'));
  assert.deepEqual(await readFile(join(checkpoint, 'manifest.json')), manifest);
  await originalsUnchanged(data);
});

test('checkpoint tool schemas reject malformed requests without creating output directories', async t => {
  const data = await setup(t), destination = join(data.root, 'must-not-exist');
  const cases = [
    ['create-file-checkpoint', { files: [{ ...data.files[0], path: '../escape' }], destination }],
    ['create-file-checkpoint', { files: data.files, destination, max_bytes: 0 }],
    ['create-file-checkpoint', { files: data.files, destination, unknown: true }],
    ['verify-file-checkpoint', { checkpoint: 'relative-checkpoint' }],
    ['verify-file-checkpoint', { checkpoint: join(data.root, 'absent'), unknown: true }],
    ['restore-file-checkpoint', { checkpoint: 'relative-checkpoint', destination }],
    ['restore-file-checkpoint', { checkpoint: join(data.root, 'absent'), destination, unknown: true }],
  ];
  for (const [command, input] of cases) {
    const fromCli = await invoke(data.root, command, input);
    assert.equal(fromCli.status, 1); assert.equal(fromCli.output.error.code, 'invalid_request');
    const fromMcp = await data.client.callTool({ name: command.replaceAll('-', '_'), arguments: input });
    // SDK validation may wrap a schema failure differently from the provider diagnostic.
    assert.equal(fromMcp.isError, true); assert.equal(fromMcp.structuredContent, undefined);
  }
  assert.ok(!(await readdir(data.root)).includes('must-not-exist'));
  assert.ok(!(await readdir(data.root)).includes('escape'));
  await originalsUnchanged(data);
});
