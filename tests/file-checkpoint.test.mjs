import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { createFileCheckpoint, verifyFileCheckpoint, restoreFileCheckpoint } from '../dist/fileCheckpoint.js';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'nostalgia-files-'));
  const resolved = resolve(root), parent = resolve(tmpdir());
  t.after(async () => {
    assert.ok(resolved.startsWith(parent.endsWith(sep) ? parent : parent + sep));
    assert.notEqual(resolved, parent);
    await rm(resolved, { recursive: true, force: true });
  });
  const source = join(root, 'source'); await mkdir(source);
  await writeFile(join(source, 'rules.txt'), 'original synthetic rule data\n');
  await writeFile(join(source, 'image.bin'), Buffer.from([0, 1, 2, 255]));
  await writeFile(join(source, 'empty.txt'), '');
  const files = [{ source: join(source, 'rules.txt'), path: 'config/rules.txt' },
    { source: join(source, 'image.bin'), path: 'manifest.json' }, { source: join(source, 'empty.txt'), path: 'empty.txt' }];
  return { root, source, files, destination: join(root, 'checkpoint') };
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
async function alterManifest(path, mutate, recompute = true) {
  const file = join(path, 'manifest.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
  mutate(manifest);
  if (recompute) { const { checkpoint_id, ...fields } = manifest; manifest.checkpoint_id = `cp_${createHash('sha256').update(canonical(fields)).digest('hex')}`; }
  await writeFile(file, JSON.stringify(manifest));
}
function rejection(code) { return error => error.code === code; }
async function noStaging(root) { assert.deepEqual((await readdir(root)).filter(entry => entry.startsWith('.nostalgia-checkpoint-')), []); }

test('declared baseline captures unchanged sources and supports two independent byte-identical restores', async t => {
  const data = await setup(t);
  const originals = await Promise.all(data.files.map(file => readFile(file.source)));
  const created = await createFileCheckpoint({ files: data.files, destination: data.destination });
  assert.equal(created.coverage, 'declared-files-only'); assert.equal(created.runtime_state, 'not_captured');
  assert.match(created.checkpoint_id, /^cp_[a-f0-9]{64}$/);
  assert.deepEqual(created.files.map(file => file.path), ['config/rules.txt', 'empty.txt', 'manifest.json']);
  const manifest = JSON.parse(await readFile(join(data.destination, 'manifest.json'), 'utf8'));
  const { checkpoint_id, ...fields } = manifest;
  assert.equal(checkpoint_id, `cp_${createHash('sha256').update(canonical(fields)).digest('hex')}`);
  const verified = await verifyFileCheckpoint(data.destination);
  assert.deepEqual(verified.files, manifest.files); assert.equal(verified.checkpoint_id, created.checkpoint_id);
  assert.equal(verified.provenance, 'caller-supplied-not-authenticated');
  for (const name of ['restore-one', 'restore-two']) {
    const destination = join(data.root, name);
    const restored = await restoreFileCheckpoint({ checkpoint: data.destination, destination });
    assert.equal(restored.checkpoint_id, created.checkpoint_id); assert.equal(restored.runtime_state, 'not_captured');
    for (let index = 0; index < data.files.length; index++) assert.deepEqual(await readFile(join(destination, ...data.files[index].path.split('/'))), originals[index]);
    assert.deepEqual((await readdir(destination)).sort(), ['config', 'empty.txt', 'manifest.json']);
  }
  for (let index = 0; index < data.files.length; index++) assert.deepEqual(await readFile(data.files[index].source), originals[index]);
  assert.equal((await verifyFileCheckpoint(data.destination)).checkpoint_id, created.checkpoint_id);
  await noStaging(data.root);
});

test('existing capture and restore destinations, including empty directories, remain intact', async t => {
  const data = await setup(t);
  await mkdir(data.destination); await writeFile(join(data.destination, 'existing.txt'), 'keep');
  await assert.rejects(createFileCheckpoint({ files: data.files, destination: data.destination }), rejection('checkpoint_destination_exists'));
  assert.equal(await readFile(join(data.destination, 'existing.txt'), 'utf8'), 'keep');
  const cp = join(data.root, 'valid-checkpoint'); await createFileCheckpoint({ files: data.files, destination: cp });
  await assert.rejects(restoreFileCheckpoint({ checkpoint: cp, destination: data.destination }), rejection('checkpoint_destination_exists'));
  assert.deepEqual(await readdir(data.destination), ['existing.txt']);
  const empty = join(data.root, 'empty-destination'); await mkdir(empty);
  await assert.rejects(createFileCheckpoint({ files: data.files, destination: empty }), rejection('checkpoint_destination_exists'));
  await assert.rejects(restoreFileCheckpoint({ checkpoint: cp, destination: empty }), rejection('checkpoint_destination_exists'));
  assert.deepEqual(await readdir(empty), []); await noStaging(data.root);
});

test('corrupted manifest and payload or extra files and directories are rejected before restore', async t => {
  const data = await setup(t);
  const scenarios = [
    [async cp => alterManifest(cp, manifest => { manifest.files[0].sha256 = '0'.repeat(64); }, false), 'checkpoint_digest_mismatch'],
    [async cp => writeFile(join(cp, 'payload', 'config', 'rules.txt'), 'corrupted'), 'checkpoint_digest_mismatch'],
    [async cp => writeFile(join(cp, 'payload', 'extra.txt'), 'extra'), 'checkpoint_invalid'],
    [async cp => mkdir(join(cp, 'payload', 'unexpected-empty-directory')), 'checkpoint_invalid'],
    [async cp => writeFile(join(cp, 'extra.txt'), 'extra'), 'checkpoint_invalid'],
    [async cp => alterManifest(cp, manifest => { manifest.files[0].bytes += 1; }), 'checkpoint_digest_mismatch'],
    [async cp => alterManifest(cp, manifest => { manifest.files[0].path = '../outside'; }), 'checkpoint_invalid'],
    [async cp => alterManifest(cp, manifest => { manifest.version = 2; }), 'checkpoint_invalid'],
    [async cp => writeFile(join(cp, 'manifest.json'), '{malformed'), 'checkpoint_invalid'],
    [async cp => writeFile(join(cp, 'manifest.json'), Buffer.alloc(5 * 1024 ** 2 + 1)), 'checkpoint_invalid'],
  ];
  for (let index = 0; index < scenarios.length; index++) {
    const cp = join(data.root, `checkpoint-${index}`), destination = join(data.root, `restore-${index}`);
    await createFileCheckpoint({ files: data.files, destination: cp });
    await scenarios[index][0](cp);
    await assert.rejects(restoreFileCheckpoint({ checkpoint: cp, destination }), rejection(scenarios[index][1]));
    await assert.rejects(readFile(join(destination, 'config', 'rules.txt')), error => error.code === 'ENOENT');
  }
  await noStaging(data.root);
});

test('portable names, case-insensitive duplicates, prefix collisions, and overlaps are refused', async t => {
  const data = await setup(t);
  for (const path of ['../escape', '/absolute', 'C:/drive', 'a\\b', 'a//b', './a', 'a/../b', 'file:stream', 'CON', 'CONIN$', 'CONOUT$', 'aux.txt', 'LPT1.bin', 'COM¹.bin', 'a.', 'a ', 'a/']) {
    await assert.rejects(createFileCheckpoint({ files: [{ source: data.files[0].source, path }], destination: data.destination }), error => error.name === 'ZodError', path);
  }
  for (const paths of [['A.txt', 'a.txt'], ['folder', 'folder/file'], ['Folder', 'folder/file']]) {
    await assert.rejects(createFileCheckpoint({ files: paths.map(path => ({ source: data.files[0].source, path })), destination: data.destination }), rejection('checkpoint_invalid'));
  }
  await assert.rejects(createFileCheckpoint({ files: [], destination: data.destination }), error => error.name === 'ZodError');
  await assert.rejects(createFileCheckpoint({ files: data.files, destination: join(data.source, 'checkpoint') }), rejection('checkpoint_invalid'));
  await assert.rejects(createFileCheckpoint({ files: data.files, destination: data.root }), rejection('checkpoint_invalid'));
  await createFileCheckpoint({ files: data.files, destination: data.destination });
  await assert.rejects(restoreFileCheckpoint({ checkpoint: data.destination, destination: join(data.destination, 'restore') }), rejection('checkpoint_invalid'));
  await assert.rejects(restoreFileCheckpoint({ checkpoint: data.destination, destination: data.root }), rejection('checkpoint_invalid'));
  await noStaging(data.root);
});

test('size limits and unavailable or nonregular sources fail without retained staging', async t => {
  const data = await setup(t);
  await assert.rejects(createFileCheckpoint({ files: data.files, destination: data.destination, max_bytes: 1 }), rejection('checkpoint_invalid'));
  await assert.rejects(createFileCheckpoint({ files: [{ source: data.source, path: 'directory' }], destination: data.destination }), rejection('checkpoint_source_unavailable'));
  await assert.rejects(createFileCheckpoint({ files: [{ source: join(data.source, 'missing'), path: 'missing' }], destination: data.destination }), rejection('checkpoint_source_unavailable'));
  await assert.rejects(createFileCheckpoint({ files: data.files, destination: join(data.root, 'missing-parent', 'cp') }), rejection('checkpoint_source_unavailable'));
  await createFileCheckpoint({ files: data.files, destination: data.destination });
  await assert.rejects(restoreFileCheckpoint({ checkpoint: data.destination, destination: join(data.root, 'restore'), max_bytes: 1 }), rejection('checkpoint_invalid'));
  await noStaging(data.root);
});

test('source and payload symlink or junction paths are rejected where the OS permits link fixtures', async t => {
  const data = await setup(t); const link = join(data.root, 'linked-source');
  try { await symlink(data.source, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip(`OS does not permit link fixtures: ${error.code}`); return; } throw error; }
  await assert.rejects(createFileCheckpoint({ files: [{ source: join(link, 'rules.txt'), path: 'rules' }], destination: data.destination }), rejection('checkpoint_source_unavailable'));
  await createFileCheckpoint({ files: data.files, destination: data.destination });
  await symlink(data.source, join(data.destination, 'payload', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyFileCheckpoint(data.destination), rejection('checkpoint_invalid'));
  await noStaging(data.root);
});

test('pre-cancelled and mid-copy requests preserve sources and clean exact owned staging', async t => {
  const data = await setup(t); const large = join(data.source, 'large.bin');
  await writeFile(large, Buffer.alloc(8 * 1024 ** 2, 42));
  const files = [{ source: large, path: 'large.bin' }];
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createFileCheckpoint({ files, destination: data.destination }, controller.signal), { name: 'AbortError' });
  const during = new AbortController();
  const pending = createFileCheckpoint({ files, destination: data.destination }, during.signal);
  const expected = assert.rejects(pending, { name: 'AbortError' });
  let observed = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await readdir(data.root)).some(entry => entry.startsWith('.nostalgia-checkpoint-'))) { observed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal(observed, true); during.abort(); await expected;
  await noStaging(data.root);
  assert.equal((await readFile(large)).length, 8 * 1024 ** 2);
  assert.equal((await readFile(large))[0], 42);
  await createFileCheckpoint({ files, destination: data.destination });
  await assert.rejects(verifyFileCheckpoint(data.destination, controller.signal), { name: 'AbortError' });
  await assert.rejects(restoreFileCheckpoint({ checkpoint: data.destination, destination: join(data.root, 'restore') }, controller.signal), { name: 'AbortError' });
  await noStaging(data.root);
});
