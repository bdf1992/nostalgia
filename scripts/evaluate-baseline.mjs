import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as z from 'zod/v4';
import { createFileCheckpoint, verifyFileCheckpoint, restoreFileCheckpoint } from '../dist/fileCheckpoint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestSchema = z.strictObject({
  name: z.string().min(1), source_root: z.string().min(1), files: z.array(z.string()).min(1).max(10000),
  entrypoint: z.string().min(1), run_root: z.string().refine(isAbsolute).optional(),
  cases: z.array(z.strictObject({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    arguments: z.array(z.string()).max(40), expected_output: z.json() })).min(1).max(100),
}).refine(input => input.files.includes(input.entrypoint), 'Entrypoint must be included in captured files')
  .refine(input => new Set(input.cases.map(item => item.id)).size === input.cases.length, 'Case IDs must be unique');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);

async function admitDirectory(path) {
  const normalized = resolve(path), root = parse(normalized).root;
  let current = root;
  for (const segment of ['', ...relative(root, normalized).split(sep).filter(Boolean)]) {
    if (segment) current = join(current, segment);
    const identity = await lstat(current);
    assert.ok(!identity.isSymbolicLink() && identity.isDirectory(),
      `Evaluation paths must use real directories without symlinks or junctions: ${current}`);
  }
}

const contains = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
};
async function hashSource(path, expectedBytes) {
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    assert.ok(bytes <= expectedBytes, 'Source grew after checkpoint capture');
    digest.update(chunk);
  }
  assert.equal(bytes, expectedBytes, 'Source size changed after checkpoint capture');
  return digest.digest('hex');
}

async function probe(directory, entrypoint, scenario, evidence) {
  let result;
  try {
    result = await execute(process.execPath, [join(directory, entrypoint), ...scenario.arguments], {
    cwd: directory, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true,
    shell: false, env: { ...process.env, NODE_OPTIONS: '' },
    });
  } catch (error) {
    evidence.process = { stdout: error.stdout ?? '', stderr: error.stderr ?? '',
      code: error.code ?? null, signal: error.signal ?? null, killed: error.killed ?? false };
    throw error;
  }
  evidence.process = { ...result, code: 0, signal: null, killed: false };
  assert.equal(result.stderr, '', 'Scenario emitted stderr');
  evidence.observed = JSON.parse(result.stdout);
  return evidence.observed;
}

export async function evaluateBaseline(raw) {
  const input = requestSchema.parse(raw);
  const sourceRoot = isAbsolute(input.source_root) ? input.source_root : resolve(root, input.source_root);
  const runRoot = resolve(input.run_root ?? join(root, 'state', `baseline-${randomUUID()}`));
  // Admit both paths before any reservation or receipt can write through an alias.
  await admitDirectory(sourceRoot);
  await admitDirectory(dirname(runRoot));
  assert.ok(!contains(sourceRoot, runRoot) && !contains(runRoot, sourceRoot), 'Run and source roots must not overlap');
  // Reserve the run without taking over an existing directory. Retain failed runs.
  await mkdir(runRoot);
  const receipt = {
    schema_version: 1, name: input.name, recorded_at: new Date().toISOString(), run_root: runRoot,
    status: 'blocked', baseline_admitted: false, reverse_engineering_execution: 'not_attempted',
    scope: 'declared-files-and-node-scenarios', cases: [],
    limitations: ['File copies do not capture live process memory, OS services, account state, or servers.',
      'This Node adapter runs a direct child with host permissions; it is not a sandbox or native-game adapter.',
      'Inherited host environment outside the recorded override is not captured or restorable.',
      'Passing a copied baseline establishes the declared baseline cases, not an independently reconstructed implementation.',
      'This receipt orders this evaluation; it does not intercept or authorize external REA calls.'],
  };
  try {
    const sources = input.files.map(path => ({ source: join(sourceRoot, path), path }));
    const checkpoint = join(runRoot, 'baseline');
    await createFileCheckpoint({ files: sources, destination: checkpoint });
    const manifest = await verifyFileCheckpoint(checkpoint);
    receipt.checkpoint_id = manifest.checkpoint_id;
    receipt.snapshot_path = checkpoint;
    receipt.runtime = { executable: process.execPath, sha256: hash(await readFile(process.execPath)),
      version: process.version, platform: process.platform, architecture: process.arch, environment_override: { NODE_OPTIONS: '' } };
    receipt.protocol = input;
    receipt.adapter_sha256 = hash(await readFile(fileURLToPath(import.meta.url)));
    for (const scenario of input.cases) {
      const outputs = { id: scenario.id, status: 'blocked', expected_output: scenario.expected_output };
      receipt.cases.push(outputs);
      for (const stage of ['reference', 'replica', 'restored']) {
        const destination = join(runRoot, `${stage}-${scenario.id}`);
        outputs[stage] = { directory: destination, status: 'blocked' };
        await restoreFileCheckpoint({ checkpoint, destination });
        const observed = await probe(destination, input.entrypoint, scenario, outputs[stage]);
        assert.deepEqual(observed, scenario.expected_output, `${stage} case ${scenario.id} differs from declared baseline`);
        outputs[stage].status = 'passed';
      }
      assert.deepEqual(outputs.replica.observed, outputs.reference.observed);
      assert.deepEqual(outputs.restored.observed, outputs.reference.observed);
      outputs.status = 'passed';
    }
    // Save/load mutated working profiles. Check frozen state and source afterwards.
    await verifyFileCheckpoint(checkpoint);
    for (const file of manifest.files) assert.equal(await hashSource(join(sourceRoot, file.path), file.bytes), file.sha256, 'Original source changed');
    assert.equal(hash(await readFile(process.execPath)), receipt.runtime.sha256, 'Runtime identity changed');
    receipt.status = 'passed'; receipt.baseline_admitted = true; receipt.source_unchanged = true;
  } catch (error) {
    receipt.failure = { code: error.code ?? 'baseline_case_failed', message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.retained_destination ? { retained_destination: error.retained_destination } : {}),
      ...(error.retained_staging ? { retained_staging: error.retained_staging } : {}) };
  }
  await writeFile(join(runRoot, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Use evaluate-baseline.mjs [request.json]');
    const request = resolve(process.argv[2] ?? join(root, 'evals/baseline-fixture/protocol.json'));
    const bytes = await readFile(request);
    if (bytes.length > 512 * 1024) throw new Error('Evaluation request exceeds 512 KiB');
    const receipt = await evaluateBaseline(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    console.log(JSON.stringify({ status: receipt.status, baseline_admitted: receipt.baseline_admitted,
      checkpoint_id: receipt.checkpoint_id, receipt_path: join(receipt.run_root, 'receipt.json'), failure: receipt.failure }));
    if (!receipt.baseline_admitted) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ status: 'blocked', baseline_admitted: false, failure: error.message }));
    process.exitCode = 1;
  }
}
