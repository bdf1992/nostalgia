import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { rehearseStudio } from '../scripts/rehearse-studio.mjs';
import { verifyFileCheckpoint } from '../dist/fileCheckpoint.js';

async function temporary(t) {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'nostalgia-studio-'));
  t.after(async () => { const child = relative(parent, resolve(root)); assert.ok(child && !child.startsWith('..') && !isAbsolute(child)); await rm(root, { recursive: true, force: true }); });
  return root;
}
const originals = async () => Promise.all(['game.mjs', 'config.json', 'player.json'].map(path => readFile(resolve('evals/baseline-fixture', path))));

test('studio rehearsal changes one damage cell, verifies independent variant cases and restores original combat', async t => {
  const root = await temporary(t), before = await originals(), run_root = join(root, 'run');
  const receipt = await rehearseStudio({ run_root });
  assert.equal(receipt.status, 'passed'); assert.equal(receipt.scope, 'original-node-fixture');
  assert.equal(receipt.baseline.baseline_admitted, true); assert.equal(receipt.source_unchanged, true); assert.equal(receipt.checkpoints_verified, true);
  assert.equal(receipt.variant_created, true); assert.equal(receipt.table_comparison.summary.cells_changed, 1);
  assert.deepEqual(receipt.table_comparison.changes.map(item => [item.key, item.before, item.after]), [[['damage'], '25', '35']]);
  for (const evidence of [receipt.baseline_projection.evidence, receipt.variant_projection.evidence, receipt.table_comparison]) assert.match(evidence.evidence_id, /^ev_[a-f0-9]{64}$/);
  const variant = receipt.stages.find(stage => stage.kind === 'variant' && stage.id === 'combat');
  const restored = receipt.stages.find(stage => stage.kind === 'original-restored');
  assert.equal(variant.observed.target_hp, 65); assert.equal(restored.observed.target_hp, 75);
  assert.deepEqual(variant.observed.player, { mana: 40, gold: 3, x: 2 });
  assert.equal(receipt.stages.find(stage => stage.id === 'save-load').observed.saved.gold, 5);
  for (const stage of receipt.stages) { assert.equal(stage.status, 'passed'); assert.equal(stage.process.code, 0); assert.deepEqual(JSON.parse(stage.process.stdout), stage.observed); }
  assert.notEqual(receipt.original_checkpoint.checkpoint_id, receipt.variant_checkpoint.checkpoint_id);
  assert.equal((await verifyFileCheckpoint(receipt.original_checkpoint.checkpoint)).checkpoint_id, receipt.original_checkpoint.checkpoint_id);
  assert.equal((await verifyFileCheckpoint(receipt.variant_checkpoint.checkpoint)).checkpoint_id, receipt.variant_checkpoint.checkpoint_id);
  assert.deepEqual(await originals(), before);
  assert.deepEqual(JSON.parse(await readFile(join(run_root, 'receipt.json'), 'utf8')), receipt);
});

test('existing, overlapping and aliased rehearsal roots are refused without replacing source or destination', async t => {
  const root = await temporary(t), before = await originals(); await writeFile(join(root, 'keep'), 'keep');
  await assert.rejects(() => rehearseStudio({ run_root: root }), { code: 'EEXIST' });
  await assert.rejects(() => rehearseStudio({ run_root: resolve('evals/baseline-fixture/unwanted-studio-run') }), /must not overlap/);
  const alias = join(root, 'alias'); await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => rehearseStudio({ run_root: join(alias, 'unwanted') }), /without aliases/);
  assert.ok(!(await readdir(root)).includes('unwanted')); assert.equal(await readFile(join(root, 'keep'), 'utf8'), 'keep');
  assert.deepEqual(await originals(), before);
});

test('declared incorrect baseline expectation blocks rehearsal before variant and CLI exits nonzero', async t => {
  const root = await temporary(t), before = await originals(), run_root = join(root, 'blocked');
  const input = { run_root, baseline_expectations: { combat_target_hp: 74 } };
  const request = join(root, 'request.json'); await writeFile(request, JSON.stringify(input));
  const result = spawnSync(process.execPath, [resolve('scripts/rehearse-studio.mjs'), request], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout); assert.equal(output.status, 'blocked');
  const receipt = JSON.parse(await readFile(output.receipt_path, 'utf8'));
  assert.equal(receipt.baseline.baseline_admitted, false); assert.equal(receipt.variant_created, false); assert.deepEqual(receipt.stages, []);
  assert.equal(receipt.baseline.cases.find(stage => stage.id === 'combat').reference.observed.target_hp, 75);
  assert.equal(receipt.baseline.cases.find(stage => stage.id === 'combat').expected_output.target_hp, 74);
  assert.ok(!(await readdir(run_root)).includes('working')); assert.ok(!(await readdir(run_root)).includes('variant-checkpoint'));
  assert.deepEqual(await originals(), before);
  await assert.rejects(() => rehearseStudio({ run_root: join(root, 'unknown'), command: 'arbitrary' }));
  assert.ok(!(await readdir(root)).includes('unknown'));
});
