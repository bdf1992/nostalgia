import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { test } from 'node:test';
import { evaluateBaseline } from '../scripts/evaluate-baseline.mjs';
import { verifyFileCheckpoint } from '../dist/fileCheckpoint.js';

async function temporary(t) {
  const parent = resolve(tmpdir());
  const root = await mkdtemp(join(parent, 'nostalgia-baseline-evaluation-'));
  t.after(async () => {
    const child = relative(parent, resolve(root));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
const protocolPath = resolve('evals/baseline-fixture/protocol.json');
const load = async run_root => ({ ...JSON.parse(await readFile(protocolPath, 'utf8')), run_root });

test('baseline admission requires matching reference, local replica and fresh restore before investigation', async t => {
  const root = await temporary(t);
  const input = await load(join(root, 'run'));
  const original = await readFile(resolve(input.source_root, 'player.json'));
  const receipt = await evaluateBaseline(input);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.baseline_admitted, true);
  assert.equal(receipt.reverse_engineering_execution, 'not_attempted');
  assert.equal(receipt.source_unchanged, true);
  assert.equal(receipt.cases.length, 3);
  for (const scenario of receipt.cases) {
    assert.deepEqual(scenario.reference.observed, scenario.replica.observed);
    assert.deepEqual(scenario.reference.observed, scenario.restored.observed);
  }
  const saved = receipt.cases.find(item => item.id === 'save-load');
  assert.equal(JSON.parse(await readFile(join(saved.replica.directory, 'player.json'), 'utf8')).gold, 5);
  assert.deepEqual(await readFile(join(receipt.snapshot_path, 'payload/player.json')), original);
  assert.deepEqual(await readFile(resolve(input.source_root, 'player.json')), original);
  const manifest = await verifyFileCheckpoint(receipt.snapshot_path);
  assert.equal(manifest.checkpoint_id, receipt.checkpoint_id);
  assert.equal(manifest.runtime_state, 'not_captured');
  assert.equal(JSON.parse(await readFile(join(receipt.run_root, 'receipt.json'), 'utf8')).baseline_admitted, true);
});

test('a baseline mismatch blocks admission and retains the failed evaluation without touching originals', async t => {
  const root = await temporary(t);
  const input = await load(join(root, 'failed-run'));
  const original = await readFile(resolve(input.source_root, 'player.json'));
  input.cases.find(item => item.id === 'combat').expected_output.target_hp = -1;
  const receipt = await evaluateBaseline(input);
  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.baseline_admitted, false);
  assert.equal(receipt.reverse_engineering_execution, 'not_attempted');
  assert.match(receipt.failure.message, /reference case combat/);
  assert.equal(receipt.cases.length, 2);
  const failed = receipt.cases[1];
  assert.equal(failed.status, 'blocked');
  assert.equal(failed.expected_output.target_hp, -1);
  assert.equal(failed.reference.observed.target_hp, 75);
  assert.equal(failed.reference.process.code, 0);
  assert.deepEqual(JSON.parse(failed.reference.process.stdout), failed.reference.observed);
  await assert.rejects(stat(join(receipt.run_root, 'replica-combat')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(resolve(input.source_root, 'player.json')), original);
  assert.equal(JSON.parse(await readFile(join(receipt.run_root, 'receipt.json'), 'utf8')).baseline_admitted, false);
});

test('a failed child process retains diagnostics in the blocked receipt', async t => {
  const root = await temporary(t);
  const input = await load(join(root, 'process-failure'));
  input.cases[0].arguments = ['unknown-case'];
  const receipt = await evaluateBaseline(input);
  assert.equal(receipt.baseline_admitted, false);
  assert.equal(receipt.cases[0].status, 'blocked');
  assert.equal(receipt.cases[0].reference.process.code, 1);
  assert.match(receipt.cases[0].reference.process.stderr, /Unknown/);
  const retained = JSON.parse(await readFile(join(receipt.run_root, 'receipt.json'), 'utf8'));
  assert.deepEqual(retained.cases, receipt.cases);
});

test('existing evaluation directories and overlapping roots are not reused', async t => {
  const root = await temporary(t);
  await assert.rejects(evaluateBaseline(await load(root)), { code: 'EEXIST' });
  const input = await load(resolve('evals/baseline-fixture/unwanted-run'));
  await assert.rejects(evaluateBaseline(input), /must not overlap/);
  await assert.rejects(stat(input.run_root), { code: 'ENOENT' });
});

test('source and destination directory aliases are refused before source writes', async t => {
  const root = await temporary(t);
  const source = join(root, 'source'), alias = join(root, 'alias');
  await mkdir(source);
  try { await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('Directory links unavailable');
    throw error;
  }
  const input = await load(join(alias, 'new-run'));
  input.source_root = source;
  await assert.rejects(evaluateBaseline(input), /without symlinks or junctions/);
  await assert.rejects(stat(join(source, 'new-run')), { code: 'ENOENT' });
  input.source_root = alias;
  input.run_root = join(source, 'other-run');
  await assert.rejects(evaluateBaseline(input), /without symlinks or junctions/);
  await assert.rejects(stat(join(source, 'other-run')), { code: 'ENOENT' });
});
