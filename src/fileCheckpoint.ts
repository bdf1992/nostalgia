import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import * as z from 'zod/v4';
import { StudyError } from './errors.js';

const MAX_FILES = 10000;
const MAX_BYTES = 100 * 1024 ** 3;
const DEFAULT_BYTES = 2 * 1024 ** 3;
const MAX_MANIFEST = 5 * 1024 ** 2;
const absolute = z.string().max(4096).refine(isAbsolute, 'Provide an absolute local path');
function portable(value: string) {
  return value.length > 0 && value.length <= 4096 && value.split('/').every(segment =>
    segment.length > 0 && segment !== '.' && segment !== '..' && !/[\\:\x00-\x1f<>"|?*]/.test(segment) &&
    !/[. ]$/.test(segment) && !/^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment));
}
const portablePath = z.string().refine(portable, 'Provide a portable relative path with forward slash segments');
export const checkpointInput = z.strictObject({
  files: z.array(z.strictObject({ source: absolute, path: portablePath })).min(1).max(MAX_FILES),
  destination: absolute, max_bytes: z.number().int().positive().max(MAX_BYTES).default(DEFAULT_BYTES),
});
export const restoreInput = z.strictObject({ checkpoint: absolute, destination: absolute, max_bytes: z.number().int().positive().max(MAX_BYTES).default(DEFAULT_BYTES) });
export const verifyCheckpointInput = z.strictObject({ checkpoint: absolute });
const fileRecord = z.strictObject({ path: portablePath, bytes: z.number().int().nonnegative().max(MAX_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const manifestSchema = z.strictObject({
  version: z.literal(1), checkpoint_id: z.string().regex(/^cp_[a-f0-9]{64}$/), recorded_at: z.iso.datetime(),
  files: z.array(fileRecord).min(1).max(MAX_FILES), coverage: z.literal('declared-files-only'), runtime_state: z.literal('not_captured'),
});
export type FileCheckpointManifest = z.output<typeof manifestSchema>;
export const createCheckpointOutput = manifestSchema.extend({ checkpoint: absolute });
export const verifyCheckpointOutput = createCheckpointOutput.extend({ provenance: z.literal('caller-supplied-not-authenticated') });
export const restoreCheckpointOutput = z.strictObject({
  checkpoint_id: manifestSchema.shape.checkpoint_id, checkpoint: absolute, destination: absolute,
  files: manifestSchema.shape.files, coverage: z.literal('declared-files-only'), runtime_state: z.literal('not_captured'),
});
type FileRecord = z.output<typeof fileRecord>;
type Budget = { remaining: number };
type Staging = { path: string; parent: string; identity: Stats; parentIdentity: Stats };
function fail(code: string, message: string, details: Record<string, unknown> = {}): never { throw new StudyError(code, message, details); }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
}
function manifestId(manifest: Omit<FileCheckpointManifest, 'checkpoint_id'>) { return `cp_${createHash('sha256').update(canonical(manifest)).digest('hex')}`; }
function sameIdentity(a: Stats, b: Stats) { return a.dev === b.dev && a.ino === b.ino; }
function sameFile(a: Stats, b: Stats) { return sameIdentity(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function overlap(a: string, b: string) {
  const left = resolve(a).toLowerCase(), right = resolve(b).toLowerCase();
  return left === right || left.startsWith(right.endsWith(sep) ? right : right + sep) || right.startsWith(left.endsWith(sep) ? left : left + sep);
}
function validatePaths(files: ReadonlyArray<{ path: string }>) {
  const paths = files.map(file => file.path.toLowerCase()).sort(compare);
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) fail('checkpoint_invalid', 'Duplicate case-insensitive payload path', { path });
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) if (seen.has(segments.slice(0, i).join('/'))) fail('checkpoint_invalid', 'File and directory payload paths collide', { path });
    seen.add(path);
  }
}
async function guardedPath(path: string, code = 'checkpoint_source_unavailable') {
  const normalized = resolve(path), root = parse(normalized).root;
  const segments = relative(root, normalized).split(sep).filter(Boolean);
  let current = root;
  try {
    let identity = await lstat(current);
    if (!identity.isDirectory() || identity.isSymbolicLink()) fail(code, 'Path root is not a real directory', { path: current });
    for (let index = 0; index < segments.length; index++) {
      current = join(current, segments[index]!); identity = await lstat(current);
      if (identity.isSymbolicLink()) fail(code, 'Symlinks and junctions are not admitted', { path: current });
      if (index < segments.length - 1 && !identity.isDirectory()) fail(code, 'Path ancestor is not a directory', { path: current });
    }
    return identity;
  } catch (error) {
    if (error instanceof StudyError) throw error;
    fail(code, 'Cannot admit local path', { path: current, reason: error instanceof Error ? error.message : String(error) });
  }
}
async function absent(path: string) {
  try { await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  fail('checkpoint_destination_exists', 'Destination already exists; existing content was not changed', { destination: path });
}
async function makeStaging(destination: string): Promise<Staging> {
  const parent = dirname(resolve(destination)); const parentIdentity = await guardedPath(parent);
  if (!parentIdentity.isDirectory()) fail('checkpoint_source_unavailable', 'Destination parent must already exist as a directory');
  await absent(destination);
  const path = join(parent, `.nostalgia-checkpoint-${randomUUID()}`);
  await mkdir(path); const identity = await guardedPath(path);
  return { path, parent, identity, parentIdentity };
}
async function cleanup(stage: Staging, error: unknown) {
  try {
    const parent = await guardedPath(stage.parent, 'checkpoint_changed');
    const current = await guardedPath(stage.path, 'checkpoint_changed');
    if (!sameIdentity(parent, stage.parentIdentity) || !sameIdentity(current, stage.identity) || dirname(resolve(stage.path)) !== resolve(stage.parent) || !basename(stage.path).startsWith('.nostalgia-checkpoint-')) {
      throw new Error('Owned staging identity changed; refusing cleanup');
    }
    await rm(stage.path, { recursive: true, force: false });
  } catch (cleanupError) {
    if (error instanceof StudyError) error.details = { ...error.details, retained_staging: stage.path, cleanup_reason: String(cleanupError) };
    else if (error instanceof Error) Object.assign(error, { retained_staging: stage.path, cleanup_reason: String(cleanupError) });
  }
}
async function publish(stage: Staging, destination: string, signal?: AbortSignal, manifestLast = false) {
  signal?.throwIfAborted();
  const parent = await guardedPath(stage.parent, 'checkpoint_changed'), current = await guardedPath(stage.path, 'checkpoint_changed');
  if (!sameIdentity(parent, stage.parentIdentity) || !sameIdentity(current, stage.identity)) fail('checkpoint_changed', 'Destination parent or staging identity changed');
  await absent(destination); signal?.throwIfAborted();
  // Exclusive reservation prevents POSIX rename from replacing a concurrently
  // created empty directory. Publication is complete on successful return;
  // checkpoint manifest.json is moved last, not an atomic directory snapshot.
  try { await mkdir(destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('checkpoint_destination_exists', 'Destination appeared before publication', { destination });
    throw error;
  }
  const ownedDestination = await guardedPath(destination, 'checkpoint_changed');
  try {
    const entries = (await readdir(stage.path)).sort(compare);
    if (manifestLast) entries.sort((a, b) => a === 'manifest.json' ? 1 : b === 'manifest.json' ? -1 : compare(a, b));
    for (const entry of entries) {
      signal?.throwIfAborted();
      const currentDestination = await guardedPath(destination, 'checkpoint_changed');
      if (!sameIdentity(ownedDestination, currentDestination)) fail('checkpoint_changed', 'Reserved destination identity changed');
      await absent(join(destination, entry));
      await rename(join(stage.path, entry), join(destination, entry));
    }
    await rmdir(stage.path);
  } catch (error) {
    if (error instanceof StudyError) error.details = { ...error.details, retained_destination: destination };
    else if (error instanceof Error) Object.assign(error, { retained_destination: destination });
    throw error;
  }
}
async function readRegular(source: string, budget: Budget, signal?: AbortSignal, destination?: string, collect?: (chunk: Buffer) => void): Promise<FileRecord> {
  signal?.throwIfAborted();
  const admitted = await guardedPath(source);
  if (!admitted.isFile()) fail('checkpoint_source_unavailable', 'Selected source must be a regular file', { source });
  if (admitted.size > budget.remaining) fail('checkpoint_invalid', 'Declared files exceed max_bytes');
  let file: Awaited<ReturnType<typeof open>>;
  try { file = await open(source, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { return fail('checkpoint_source_unavailable', 'Cannot open selected regular source', { source, reason: String(error) }); }
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await file.stat();
    if (!before.isFile() || !sameFile(admitted, before)) fail('checkpoint_changed', 'Source changed during file admission', { source });
    if (destination) {
      await mkdir(dirname(destination), { recursive: true });
      await guardedPath(dirname(destination), 'checkpoint_changed');
      output = await open(destination, 'wx');
    }
    const hash = createHash('sha256'); let bytes = 0;
    while (true) {
      signal?.throwIfAborted(); const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      signal?.throwIfAborted(); if (!bytesRead) break;
      budget.remaining -= bytesRead; if (budget.remaining < 0) fail('checkpoint_invalid', 'Files exceeded max_bytes while copying');
      const data = chunk.subarray(0, bytesRead); hash.update(data); collect?.(data); bytes += bytesRead;
      if (output) {
        let offset = 0;
        while (offset < bytesRead) { signal?.throwIfAborted(); const written = await output.write(data, offset, bytesRead - offset, null); if (!written.bytesWritten) fail('checkpoint_changed', 'Copy made no write progress'); offset += written.bytesWritten; }
      }
    }
    const after = await file.stat(), current = await guardedPath(source, 'checkpoint_changed');
    if (!sameFile(before, after) || !sameFile(before, current) || bytes !== before.size) fail('checkpoint_changed', 'Source changed while reading', { source });
    if (output) await output.sync();
    return { path: source, bytes, sha256: hash.digest('hex') };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof StudyError) throw error;
    return fail('checkpoint_source_unavailable', 'Cannot copy or inspect declared source', { source, reason: error instanceof Error ? error.message : String(error) });
  } finally { await output?.close(); await file.close(); }
}
async function recheck(files: ReadonlyArray<FileRecord>, root: string, signal?: AbortSignal) {
  const budget = { remaining: MAX_BYTES };
  for (const expected of files) {
    const actual = await readRegular(join(root, ...expected.path.split('/')), budget, signal);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail('checkpoint_digest_mismatch', 'File bytes do not match checkpoint', { path: expected.path });
  }
}
function expectedDirectories(files: ReadonlyArray<FileRecord>) {
  const dirs = new Set<string>();
  for (const file of files) { const segments = file.path.split('/'); for (let i = 1; i < segments.length; i++) dirs.add(segments.slice(0, i).join('/')); }
  return dirs;
}
async function exactPayload(root: string, files: ReadonlyArray<FileRecord>, signal?: AbortSignal) {
  const expectedFiles = new Set(files.map(file => file.path)), expectedDirs = expectedDirectories(files);
  const pending = ['']; let entries = 0;
  while (pending.length) {
    signal?.throwIfAborted(); const sub = pending.pop()!, path = join(root, ...sub.split('/').filter(Boolean));
    const directory = await guardedPath(path, 'checkpoint_invalid');
    if (!directory.isDirectory()) fail('checkpoint_invalid', 'Payload must be a real directory');
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (++entries > MAX_FILES + expectedDirs.size) fail('checkpoint_invalid', 'Payload contains unexpected entries');
      const portable = sub ? `${sub}/${entry.name}` : entry.name;
      const identity = await guardedPath(join(path, entry.name), 'checkpoint_invalid');
      if (identity.isDirectory()) { if (!expectedDirs.has(portable)) fail('checkpoint_invalid', 'Unexpected payload directory', { path: portable }); pending.push(portable); }
      else if (identity.isFile()) { if (!expectedFiles.has(portable)) fail('checkpoint_invalid', 'Unexpected payload file', { path: portable }); expectedFiles.delete(portable); }
      else fail('checkpoint_invalid', 'Payload contains a nonregular entry', { path: portable });
    }
  }
  if (expectedFiles.size) fail('checkpoint_invalid', 'Declared payload files are missing', { paths: [...expectedFiles] });
}

export async function createFileCheckpoint(raw: unknown, signal?: AbortSignal) {
  const input = checkpointInput.parse(raw); signal?.throwIfAborted(); validatePaths(input.files);
  const destination = resolve(input.destination), files = [...input.files].sort((a, b) => compare(a.path, b.path));
  let declaredBytes = 0;
  for (const file of files) {
    signal?.throwIfAborted();
    const identity = await guardedPath(file.source);
    if (!identity.isFile()) fail('checkpoint_source_unavailable', 'Selected source must be a regular file', { source: file.source });
    declaredBytes += identity.size;
    if (declaredBytes > input.max_bytes) fail('checkpoint_invalid', 'Declared files exceed max_bytes');
    if (overlap(dirname(file.source), destination)) fail('checkpoint_invalid', 'Source roots and checkpoint destination may not overlap', { source: file.source, destination });
  }
  const stage = await makeStaging(destination);
  try {
    const payload = join(stage.path, 'payload'); await mkdir(payload);
    const records: FileRecord[] = [], budget = { remaining: input.max_bytes };
    for (const file of files) records.push({ ...await readRegular(file.source, budget, signal, join(payload, ...file.path.split('/'))), path: file.path });
    // Sequential stable copies are not a simultaneous process snapshot.
    const sourceBudget = { remaining: input.max_bytes };
    for (let index = 0; index < files.length; index++) {
      const actual = await readRegular(files[index]!.source, sourceBudget, signal), expected = records[index]!;
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail('checkpoint_changed', 'Declared source changed before checkpoint publication', { source: files[index]!.source });
    }
    await recheck(records, payload, signal);
    const fields = { version: 1 as const, files: records, recorded_at: new Date().toISOString(), coverage: 'declared-files-only' as const, runtime_state: 'not_captured' as const };
    const manifest: FileCheckpointManifest = { ...fields, checkpoint_id: manifestId(fields) };
    const bytes = Buffer.from(JSON.stringify(manifest)); if (bytes.length > MAX_MANIFEST) fail('checkpoint_invalid', 'Manifest exceeds 5 MiB');
    const handle = await open(join(stage.path, 'manifest.json'), 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await publish(stage, destination, signal, true);
    return { ...manifest, checkpoint: destination };
  } catch (error) { await cleanup(stage, error); throw error; }
}

export async function verifyFileCheckpoint(checkpointAbsolute: string, signal?: AbortSignal) {
  const checkpoint = resolve(absolute.parse(checkpointAbsolute)); signal?.throwIfAborted();
  const rootIdentity = await guardedPath(checkpoint, 'checkpoint_invalid');
  if (!rootIdentity.isDirectory()) fail('checkpoint_invalid', 'Checkpoint must be a directory');
  const entries = (await readdir(checkpoint)).sort(compare);
  if (entries.length !== 2 || entries[0] !== 'manifest.json' || entries[1] !== 'payload') fail('checkpoint_invalid', 'Checkpoint must contain only manifest.json and payload');
  const chunks: Buffer[] = [];
  const manifestIdentity = await readRegular(join(checkpoint, 'manifest.json'), { remaining: MAX_MANIFEST }, signal, undefined, chunk => chunks.push(chunk));
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('checkpoint_invalid', 'Manifest must be valid UTF-8 JSON'); }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) fail('checkpoint_invalid', 'Invalid file checkpoint manifest', { issues: parsed.error.issues });
  const manifest = parsed.data; validatePaths(manifest.files);
  if (manifest.files.reduce((sum, file) => sum + file.bytes, 0) > MAX_BYTES) fail('checkpoint_invalid', 'Checkpoint exceeds 100 GiB');
  const { checkpoint_id, ...fields } = manifest;
  if (manifestId(fields) !== checkpoint_id) fail('checkpoint_digest_mismatch', 'Manifest checkpoint ID does not match its fields');
  await exactPayload(join(checkpoint, 'payload'), manifest.files, signal);
  await recheck(manifest.files, join(checkpoint, 'payload'), signal);
  await exactPayload(join(checkpoint, 'payload'), manifest.files, signal);
  const after = await readRegular(join(checkpoint, 'manifest.json'), { remaining: MAX_MANIFEST }, signal);
  const current = await guardedPath(checkpoint, 'checkpoint_changed');
  if (!sameIdentity(rootIdentity, current) || after.sha256 !== manifestIdentity.sha256 || after.bytes !== manifestIdentity.bytes) fail('checkpoint_changed', 'Checkpoint changed during verification');
  return { ...manifest, checkpoint, provenance: 'caller-supplied-not-authenticated' as const };
}

export async function verifySelectedFileCheckpoint(raw: unknown, signal?: AbortSignal) {
  return verifyFileCheckpoint(verifyCheckpointInput.parse(raw).checkpoint, signal);
}

export async function restoreFileCheckpoint(raw: unknown, signal?: AbortSignal) {
  const input = restoreInput.parse(raw), destination = resolve(input.destination), checkpoint = resolve(input.checkpoint);
  signal?.throwIfAborted();
  if (overlap(checkpoint, destination)) fail('checkpoint_invalid', 'Checkpoint and restore destination may not overlap');
  await absent(destination);
  const verified = await verifyFileCheckpoint(checkpoint, signal);
  if (verified.files.reduce((sum, file) => sum + file.bytes, 0) > input.max_bytes) fail('checkpoint_invalid', 'Restore exceeds max_bytes');
  const stage = await makeStaging(destination);
  try {
    const budget = { remaining: input.max_bytes };
    for (const expected of verified.files) {
      const actual = await readRegular(join(checkpoint, 'payload', ...expected.path.split('/')), budget, signal, join(stage.path, ...expected.path.split('/')));
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail('checkpoint_digest_mismatch', 'Checkpoint changed before restore completed', { path: expected.path });
    }
    await recheck(verified.files, stage.path, signal);
    const stillVerified = await verifyFileCheckpoint(checkpoint, signal);
    if (stillVerified.checkpoint_id !== verified.checkpoint_id) fail('checkpoint_changed', 'Checkpoint identity changed during restore');
    await publish(stage, destination, signal);
    return { checkpoint_id: verified.checkpoint_id, checkpoint, destination, files: verified.files, coverage: 'declared-files-only' as const, runtime_state: 'not_captured' as const };
  } catch (error) { await cleanup(stage, error); throw error; }
}
