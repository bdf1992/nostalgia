import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as z from 'zod/v4';
import { evaluateBaseline } from './evaluate-baseline.mjs';
import { createFileCheckpoint, verifyFileCheckpoint, restoreFileCheckpoint } from '../dist/fileCheckpoint.js';
import { inspectGameTable, compareGameTables } from '../dist/application.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repo, 'evals', 'baseline-fixture');
const schema = z.strictObject({ run_root: z.string().refine(isAbsolute).optional(),
  baseline_expectations: z.strictObject({ combat_target_hp: z.number().int().min(0).max(100) }).optional() });
const configSchema = z.strictObject({ version: z.literal('original-fixture-1'), damage: z.number().int(), mana_cost: z.number().int(), movement_limit: z.number().int() });
const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function contains(parent, child) { const path = relative(parent, child); return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`); }
async function admit(path, directory = true) {
  const full = resolve(path), root = parse(full).root; let current = root;
  const parts = relative(root, full).split(sep).filter(Boolean);
  for (let index = 0; index <= parts.length; index++) {
    const stat = await lstat(current);
    assert.ok(!stat.isSymbolicLink() && (index < parts.length || directory ? stat.isDirectory() : stat.isFile()), `Rehearsal paths require real directories and regular files without aliases: ${current}`);
    if (index === parts.length) return stat;
    current = join(current, parts[index]);
  }
}
async function bytesAt(path, limit = 1024 * 1024) {
  const before = await admit(path, false); assert.ok(before.size <= limit, 'Rehearsal file exceeds bounded read');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat(); assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
    const chunks = []; let count = 0;
    while (true) { const buffer = Buffer.alloc(65536), { bytesRead } = await handle.read(buffer); if (!bytesRead) break; count += bytesRead; assert.ok(count <= limit, 'Rehearsal file exceeds bounded read'); chunks.push(buffer.subarray(0, bytesRead)); }
    const after = await admit(path, false); assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.size, count);
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}
async function probe(directory, scenario, evidence) {
  await admit(directory); await admit(join(directory, 'game.mjs'), false);
  try {
    const result = await execute(process.execPath, [join(directory, 'game.mjs'), scenario.id], { cwd: directory, timeout: 10000, maxBuffer: 1024 * 1024,
      encoding: 'utf8', windowsHide: true, shell: false, env: { ...process.env, NODE_OPTIONS: '' } });
    evidence.process = { ...result, code: 0, signal: null, killed: false };
    assert.equal(result.stderr, '', 'Scenario emitted stderr'); evidence.observed = JSON.parse(result.stdout);
    assert.deepEqual(evidence.observed, scenario.expected_output, `Rehearsal case ${scenario.id} differs from independent declared expectation`);
    evidence.status = 'passed';
  } catch (error) {
    if (!evidence.process) evidence.process = { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code ?? null, signal: error.signal ?? null, killed: error.killed ?? false };
    evidence.error = { code: error.code ?? 'rehearsal_case_failed', message: error.message }; throw error;
  }
}
async function changeDamage(path) {
  const before = await admit(path, false), bytes = await bytesAt(path), config = configSchema.parse(JSON.parse(bytes.toString('utf8')));
  assert.deepEqual(config, { version: 'original-fixture-1', damage: 25, mana_cost: 10, movement_limit: 4 });
  const changed = bytes.toString('utf8').replace(/("damage"\s*:\s*)25\b/, (_match, prefix) => `${prefix}35`);
  assert.deepEqual(JSON.parse(changed), { ...config, damage: 35 }, 'Only declared damage parameter may change');
  const handle = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  try { const stat = await handle.stat(), named = await admit(path, false); assert.equal(stat.nlink, 1); assert.equal(stat.ino, before.ino); assert.equal(stat.dev, before.dev); assert.equal(named.ino, stat.ino); assert.equal(hash(await handle.readFile()), hash(bytes)); await handle.truncate(0); const output = Buffer.from(changed); let offset = 0; while (offset < output.length) { const { bytesWritten } = await handle.write(output, offset, output.length - offset, offset); assert.ok(bytesWritten > 0); offset += bytesWritten; } } finally { await handle.close(); }
  assert.deepEqual(JSON.parse((await bytesAt(path)).toString('utf8')), { ...config, damage: 35 });
}
async function projection(configPath, path) {
  const bytes = await bytesAt(configPath), config = configSchema.parse(JSON.parse(bytes.toString('utf8')));
  const text = `parameter\tvalue\ndamage\t${config.damage}\nmana_cost\t${config.mana_cost}\nmovement_limit\t${config.movement_limit}\n`;
  await writeFile(path, text, { flag: 'wx' });
  const evidence = await inspectGameTable({ source: { path, delimiter: 'tab' } });
  return { source_config: configPath, source_config_sha256: hash(bytes), path, evidence };
}

export async function rehearseStudio(raw = {}) {
  const input = schema.parse(raw);
  await admit(sourceRoot);
  let runRoot = input.run_root;
  if (!runRoot) {
    const state = join(repo, 'state'); await admit(repo);
    try { await mkdir(state); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await admit(state); runRoot = join(state, `studio-${randomUUID()}`);
  }
  runRoot = resolve(runRoot); await admit(dirname(runRoot));
  assert.ok(!contains(sourceRoot, runRoot) && !contains(runRoot, sourceRoot), 'Rehearsal and source roots must not overlap');
  const protocol = JSON.parse((await bytesAt(join(sourceRoot, 'protocol.json'))).toString('utf8'));
  assert.deepEqual(protocol.files, ['game.mjs', 'config.json', 'player.json']); assert.equal(protocol.entrypoint, 'game.mjs');
  assert.equal(resolve(repo, protocol.source_root), sourceRoot);
  assert.deepEqual(protocol.cases.map(item => [item.id, item.arguments]), [['startup', ['startup']], ['combat', ['combat']], ['save-load', ['save-load']]]);
  if (input.baseline_expectations) protocol.cases.find(item => item.id === 'combat').expected_output.target_hp = input.baseline_expectations.combat_target_hp;
  await mkdir(runRoot);
  const runIdentity = await admit(runRoot);
  const receipt = { schema_version: 1, scope: 'original-node-fixture', status: 'blocked', run_root: runRoot,
    recorded_at: new Date().toISOString(), declared_change: { parameter: 'damage', before: 25, after: 35 },
    input, source_root: sourceRoot, stages: [], variant_created: false,
    limitations: ['Original authored Node fixture only; no commercial game, native adapter or playable-Souls quality claim.',
      'Declared-file restore does not restore live memory, services, accounts or host environment.',
      'Scenarios run with host permissions and NODE_OPTIONS cleared; this is not an OS sandbox.',
      'Table evidence observes declared source cells; runtime assertions cover only the retained fixture scenarios.'] };
  try {
    receipt.source_files = await Promise.all(protocol.files.map(async path => { const bytes = await bytesAt(join(sourceRoot, path)); return { path, bytes: bytes.length, sha256: hash(bytes) }; }));
    receipt.script_sha256 = hash(await bytesAt(fileURLToPath(import.meta.url)));
    receipt.baseline = await evaluateBaseline({ ...protocol, source_root: sourceRoot, run_root: join(runRoot, 'baseline-evaluation') });
    assert.equal(receipt.baseline.baseline_admitted, true, 'Baseline admission blocked; variant was not attempted');
    const originalCheckpoint = receipt.baseline.snapshot_path;
    receipt.original_checkpoint = await verifyFileCheckpoint(originalCheckpoint);
    const originalCombat = receipt.baseline.cases.find(item => item.id === 'combat');
    assert.equal(originalCombat.reference.observed.target_hp, 75, 'Baseline must establish original target HP 75');
    const working = join(runRoot, 'working'); await restoreFileCheckpoint({ checkpoint: originalCheckpoint, destination: working });
    await mkdir(join(runRoot, 'projections'));
    receipt.baseline_projection = await projection(join(working, 'config.json'), join(runRoot, 'projections', 'baseline.tsv'));
    await changeDamage(join(working, 'config.json'));
    receipt.variant_projection = await projection(join(working, 'config.json'), join(runRoot, 'projections', 'variant.tsv'));
    receipt.table_comparison = await compareGameTables({ before: { path: receipt.baseline_projection.path, delimiter: 'tab' }, after: { path: receipt.variant_projection.path, delimiter: 'tab' }, key_columns: ['parameter'] });
    assert.deepEqual(receipt.table_comparison.summary, { rows_added: 0, rows_removed: 0, rows_changed: 1, cells_changed: 1, rows_unchanged: 2 });
    assert.deepEqual(receipt.table_comparison.changes.map(item => ({ key: item.key, column: item.column, before: item.before, after: item.after })), [{ key: ['damage'], column: 'value', before: '25', after: '35' }]);
    const variantCheckpoint = join(runRoot, 'variant-checkpoint');
    await createFileCheckpoint({ files: protocol.files.map(path => ({ source: join(working, path), path })), destination: variantCheckpoint });
    receipt.variant_checkpoint = await verifyFileCheckpoint(variantCheckpoint); receipt.variant_created = true;
    for (const path of ['game.mjs', 'player.json']) assert.equal(receipt.variant_checkpoint.files.find(item => item.path === path).sha256, receipt.original_checkpoint.files.find(item => item.path === path).sha256, 'Variant may not change game or initial player');
    const variantCases = [{ id: 'startup', expected_output: { status: 'ready', version: 'original-fixture-1', player: { mana: 50, gold: 3, x: 0 } } },
      { id: 'combat', expected_output: { player: { mana: 40, gold: 3, x: 2 }, target_hp: 65 } },
      { id: 'save-load', expected_output: { saved: { mana: 50, gold: 5, x: 0 } } }];
    for (const scenario of variantCases) {
      const directory = join(runRoot, `variant-${scenario.id}`), stage = { id: scenario.id, kind: 'variant', directory, expected_output: scenario.expected_output, status: 'blocked' }; receipt.stages.push(stage);
      await restoreFileCheckpoint({ checkpoint: variantCheckpoint, destination: directory }); await probe(directory, scenario, stage);
    }
    const restored = join(runRoot, 'original-restored'), scenario = { id: 'combat', expected_output: { player: { mana: 40, gold: 3, x: 2 }, target_hp: 75 } };
    const stage = { id: 'combat', kind: 'original-restored', directory: restored, expected_output: scenario.expected_output, status: 'blocked' }; receipt.stages.push(stage);
    await restoreFileCheckpoint({ checkpoint: originalCheckpoint, destination: restored }); await probe(restored, scenario, stage);
    assert.equal((await verifyFileCheckpoint(originalCheckpoint)).checkpoint_id, receipt.original_checkpoint.checkpoint_id);
    assert.equal((await verifyFileCheckpoint(variantCheckpoint)).checkpoint_id, receipt.variant_checkpoint.checkpoint_id);
    for (const file of receipt.source_files) assert.equal(hash(await bytesAt(join(sourceRoot, file.path))), file.sha256, 'Original fixture source changed');
    receipt.source_unchanged = true; receipt.checkpoints_verified = true; receipt.status = 'passed';
  } catch (error) { receipt.failure = { code: error.code ?? 'rehearsal_failed', message: error.message }; }
  const current = await admit(runRoot); assert.equal(current.dev, runIdentity.dev); assert.equal(current.ino, runIdentity.ino);
  await writeFile(join(runRoot, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Use rehearse-studio.mjs [request.json]');
    const input = process.argv[2] ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytesAt(resolve(process.argv[2]), 512 * 1024))) : {};
    const receipt = await rehearseStudio(input);
    console.log(JSON.stringify({ status: receipt.status, scope: receipt.scope, receipt_path: join(receipt.run_root, 'receipt.json'), failure: receipt.failure }));
    if (receipt.status !== 'passed') process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ status: 'blocked', scope: 'original-node-fixture', failure: { code: error.code ?? 'rehearsal_failed', message: error.message } })); process.exitCode = 1; }
}
