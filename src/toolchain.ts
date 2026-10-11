import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import * as z from 'zod/v4';

export const providerIds = ['rea', 'stormlib', 'casclib', 'wow-export', 'blender', 'imagemagick', 'ffmpeg', 'godot', 'renderdoc', 'frida'] as const;
const path = z.string().refine(isAbsolute, 'Provide an absolute local path');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const toolchainInput = z.strictObject({ manifest_path: path });
const artifactSchema = z.strictObject({ path, sha256 });
const providerSchema = z.strictObject({
  id: z.enum(providerIds), version: z.string().min(1), mode: z.string().min(1),
  verification: z.enum(['operation-verified', 'availability-verified', 'installed-untested']),
  artifacts: z.array(artifactSchema).min(1),
  receipt_path: path, limitations: z.array(z.string()),
});
export const toolchainManifest = z.strictObject({
  schema_version: z.literal(1),
  recorded_at: z.iso.datetime(),
  providers: z.array(providerSchema).length(10).refine(items => new Set(items.map(item => item.id)).size === 10, 'Each selected provider must appear exactly once'),
});
export const toolchainOutput = z.strictObject({
  operation: z.literal('inspect_toolchain'), manifest_path: path, manifest_sha256: sha256,
  recorded_at: z.iso.datetime(),
  providers: z.array(providerSchema.extend({
    artifacts: z.array(artifactSchema.extend({ observed_sha256: sha256.nullable(), status: z.enum(['matched', 'drifted', 'unreadable']), reason: z.string().optional() })),
    status: z.enum(['files-matched', 'needs-attention']),
  })),
  execution: z.literal('not_executed'), limitations: z.array(z.string()),
});

async function hashFile(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new Error('Not a regular file');
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false, signal })) hash.update(chunk);
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('File changed while hashing');
    return hash.digest('hex');
  } finally { await file.close(); }
}

export async function inspectToolchain(raw: unknown, signal?: AbortSignal) {
  const input = toolchainInput.parse(raw);
  signal?.throwIfAborted();
  const file = await open(input.manifest_path, constants.O_RDONLY | constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new Error('Manifest must be a regular file');
    if (before.size > 5 * 1024 * 1024) throw new Error('Manifest exceeds 5 MiB');
    bytes = await file.readFile({ signal });
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Manifest changed while reading');
  } finally { await file.close(); }
  const manifest = toolchainManifest.parse(JSON.parse(bytes.toString('utf8')));
  const providers = [];
  for (const provider of manifest.providers) {
    const artifacts = [];
    for (const artifact of provider.artifacts) {
      signal?.throwIfAborted();
      try {
        const observed_sha256 = await hashFile(artifact.path, signal);
        artifacts.push({ ...artifact, observed_sha256, status: observed_sha256 === artifact.sha256 ? 'matched' : 'drifted' });
      } catch (error) {
        signal?.throwIfAborted();
        artifacts.push({ ...artifact, observed_sha256: null, status: 'unreadable', reason: error instanceof Error ? error.message : String(error) });
      }
    }
    providers.push({ ...provider, artifacts, status: artifacts.every(item => item.status === 'matched') ? 'files-matched' : 'needs-attention' });
  }
  return toolchainOutput.parse({
    operation: 'inspect_toolchain', manifest_path: input.manifest_path,
    manifest_sha256: createHash('sha256').update(bytes).digest('hex'),
    recorded_at: manifest.recorded_at, providers,
    execution: 'not_executed',
    limitations: ['File hashes establish identity against caller-supplied records, not runtime health or trusted publisher provenance.', 'Verification fields describe recorded checks, not checks rerun by this operation.', 'Dependency files not listed in the manifest are outside this inspection; no game support or playable result is established.'],
  });
}
