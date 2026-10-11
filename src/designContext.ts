import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import * as z from 'zod/v4';
import { StudyError } from './errors.js';

const path = z.string().refine(isAbsolute, 'Provide an absolute local file path');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1);
const text = z.string().refine(value => value.trim().length > 0, 'Text must not be blank');
export const designContextInput = z.strictObject({
  checkpoint_path: path, expected_sha256: digest.optional(),
  name_ids: z.array(id).max(100).default([]),
  terms: z.array(text.max(120)).max(20).default([]),
  hops: z.number().int().min(0).max(3).default(1),
  limit: z.number().int().min(1).max(100).default(30),
}).refine(value => value.name_ids.length > 0 || value.terms.length > 0, 'Provide a name ID or search term');

// SON owns these records. Validate the fields consumed here and preserve every
// additional upstream field; this reader does not authenticate REA Evidence.
const authority = z.enum(['shipped-artifact', 'controlled-replay', 'historical-reference', 'external-service', 'analyst-inference']);
const build = z.looseObject({ locator: text, sha256: digest });
const criterion = z.looseObject({ case_id: id, description: text, input: z.unknown(), expected: z.unknown(), required_authority: authority,
  tolerance: z.number().finite().nonnegative().optional(), units: text.optional(), adapter: text.optional(), invariant: z.boolean().optional(), intentional_difference: text.optional() });
const prediction = z.looseObject({ prediction_id: id, explanation: text, case_id: id, expected: z.unknown(), value_pointer: z.string().optional() });
const study = z.looseObject({ study_id: id, target: z.looseObject({ name: text, locator: text, sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable() }),
  objective: text, parent_name_id: id.optional(), criteria: z.array(criterion), predictions: z.array(prediction).optional(), builds: z.array(build).optional(),
  protocol: z.looseObject({ reset: text, ordered_actions: z.array(z.unknown()), source_adapter: text, replica_adapter: text }).optional() });
const evidence = z.looseObject({ evidence_id: z.string().regex(/^ev_[a-f0-9]{64}$/), subject: z.unknown().nullable(),
  provider: z.looseObject({ id, name: id, version: z.string().nullable() }), analysis_profile: z.unknown().nullable(),
  predicate_type: id, operation: id, parameters: z.record(z.string(), z.unknown()), raw_result: z.unknown().nullable(), normalized_result: z.unknown(),
  confidence: z.enum(['observed', 'derived', 'inferred']), authority, environment: z.unknown().nullable(), limitations: z.array(z.string()),
  locations: z.array(z.unknown()), evidence_links: z.array(z.string().regex(/^ev_[a-f0-9]{64}$/)) });
const observation = z.looseObject({ observation_id: id, study_id: id, evidence_id: id, role: z.enum(['target', 'replica']), description: text,
  case_id: id.optional(), builds: z.array(build).optional(), evidence,
  prediction_results: z.array(z.looseObject({ prediction_id: id, status: z.enum(['supported', 'contradicted', 'unresolved']), question: text.nullable() })).optional() });
const relationKinds = ['uses', 'contains', 'depends-on', 'explains', 'contradicts', 'refines'] as const;
const name = z.looseObject({ name_id: id, revision: z.number().int().positive(), study_id: id, name: text, kind: z.enum(['part', 'model', 'gap']),
  description: text, parent_name_id: id.optional(), revise_name_id: id.optional(), observation_ids: z.array(id), questions: z.array(text),
  properties: z.record(z.string(), z.unknown()), assets: z.array(z.looseObject({ role: text, input: build, output: build, conversion: text })).optional(),
  relations: z.array(z.looseObject({ kind: z.enum(relationKinds), to_name_id: id })), basis: z.enum(['supported', 'inferred', 'declaration']) });
const check = z.looseObject({ check_id: id, study_id: id, status: z.enum(['pass', 'fail', 'unresolved']), cases: z.array(z.looseObject({
  case_id: id, status: z.enum(['pass', 'fail', 'unresolved']), reason: text, observation_id: id.nullable(), value_pointer: z.string().nullable(),
  actual: z.unknown().nullable(), expected: z.unknown().nullable() })) });
const stateSchema = z.looseObject({ studies: z.array(study), observations: z.array(observation), names: z.array(name), checks: z.array(check) });
const checkpointSchema = z.looseObject({ version: z.literal(1), state: stateSchema, checksum: digest });
const relationship = z.strictObject({ from_name_id: id, from_revision: z.number().int().positive(), kind: z.enum([...relationKinds, 'parent-name']), to_name_id: id });
export const designContextOutput = z.strictObject({
  operation: z.literal('query_design_context'), source: z.strictObject({ path, bytes: z.number().int().nonnegative(), sha256: digest, checkpoint_checksum: digest }),
  parameters: designContextInput, matched_name_ids: z.array(id), names: z.array(name), history: z.array(name), relationships: z.array(relationship),
  studies: z.array(study), observations: z.array(observation), checks: z.array(check),
  coverage: z.strictObject({ matched_names: z.number().int().nonnegative(), total_reachable: z.number().int().nonnegative(), returned_names: z.number().int().nonnegative(), truncated: z.boolean() }),
  provenance: z.literal('caller-supplied-not-authenticated'), runtime_behavior: z.literal('not_established'), limitations: z.array(z.string()),
});

function fail(code: string, message: string, details: Record<string, unknown> = {}): never { throw new StudyError(code, message, details); }
const MAX_BYTES = 5 * 1024 * 1024;
function guardJson(value: unknown) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > 100) fail('invalid_checkpoint', 'Checkpoint JSON exceeds nesting depth 100');
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) fail('invalid_checkpoint', 'Checkpoint contains a nonfinite number');
    if (item.value !== null && typeof item.value === 'object') {
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
}
async function readCheckpoint(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile()) fail('checkpoint_unavailable', 'Checkpoint must be a regular file');
      if (before.size > MAX_BYTES) fail('checkpoint_unavailable', 'Checkpoint exceeds 5 MiB');
      const chunks: Buffer[] = []; let size = 0;
      while (true) {
        signal?.throwIfAborted();
        const chunk = Buffer.alloc(64 * 1024);
        const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
        signal?.throwIfAborted();
        if (bytesRead === 0) break;
        size += bytesRead;
        if (size > MAX_BYTES) fail('checkpoint_unavailable', 'Checkpoint exceeds 5 MiB while reading');
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const after = await file.stat(); const current = await stat(path);
      if ([after, current].some(item => item.dev !== before.dev || item.ino !== before.ino || item.size !== before.size || item.mtimeMs !== before.mtimeMs || item.ctimeMs !== before.ctimeMs)) {
        fail('checkpoint_unavailable', 'Checkpoint changed while reading');
      }
      signal?.throwIfAborted();
      return Buffer.concat(chunks);
    } finally { await file.close(); }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof StudyError) throw error;
    fail('checkpoint_unavailable', 'Cannot read checkpoint', { path, reason: error instanceof Error ? error.message : String(error) });
  }
}

export async function queryDesignContext(raw: unknown, signal?: AbortSignal) {
  const input = designContextInput.parse(raw);
  const bytes = await readCheckpoint(input.checkpoint_path, signal);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (input.expected_sha256 && input.expected_sha256 !== sha256) fail('source_digest_mismatch', 'Checkpoint file SHA256 does not match requested identity');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('invalid_checkpoint', 'Checkpoint must be valid UTF-8 JSON'); }
  guardJson(parsed);
  if (parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version !== 1) fail('unsupported_checkpoint_version', 'Only REA-SON checkpoint version 1 is supported');
  const validation = checkpointSchema.safeParse(parsed);
  if (!validation.success) fail('invalid_checkpoint', 'Checkpoint fields do not match consumed SON record shapes', { issues: validation.error.issues });
  // Shape validation must not become normalization: Zod clones can omit special
  // JSON keys such as __proto__. Preserve the original parsed record values.
  const checkpoint = parsed as z.output<typeof checkpointSchema>;
  const rawCheckpoint = parsed as { version: number; state: unknown };
  const checksum = createHash('sha256').update(canonical({ version: rawCheckpoint.version, state: rawCheckpoint.state })).digest('hex');
  if (checksum !== checkpoint.checksum) fail('checkpoint_checksum_mismatch', 'SON checkpoint checksum does not match version and state');
  const state = checkpoint.state;
  const studies = new Map(state.studies.map(item => [item.study_id, item]));
  const observations = new Map(state.observations.map(item => [item.observation_id, item]));
  const latest = new Map<string, z.output<typeof name>>();
  const histories = new Map<string, z.output<typeof name>[]>();
  for (const item of state.names) {
    const history = histories.get(item.name_id) ?? []; history.push(item); histories.set(item.name_id, history);
    if (!latest.has(item.name_id) || latest.get(item.name_id)!.revision < item.revision) latest.set(item.name_id, item);
  }
  const allIds = [...state.studies.map(item => item.study_id), ...histories.keys(), ...state.observations.map(item => item.observation_id), ...state.checks.map(item => item.check_id)];
  if (new Set(allIds).size !== allIds.length) fail('invalid_checkpoint', 'Duplicate SON record IDs');
  for (const [nameId, revisions] of histories) {
    revisions.sort((a, b) => a.revision - b.revision);
    if (revisions.some((item, index) => item.revision !== index + 1 || item.study_id !== revisions[0]!.study_id)) fail('invalid_checkpoint', 'Invalid name revision sequence', { name_id: nameId });
  }
  const requireReference = (valid: boolean, message: string) => { if (!valid) fail('checkpoint_reference_invalid', message); };
  // Admit all references used by ancestor walks before walking any of them.
  for (const item of state.studies) requireReference(!item.parent_name_id || latest.has(item.parent_name_id), 'Dangling study parent name');
  for (const item of state.names) requireReference(studies.has(item.study_id), 'Dangling name study');
  for (const item of state.studies) {
    if (new Set(item.criteria.map(criterion => criterion.case_id)).size !== item.criteria.length) fail('invalid_checkpoint', 'Duplicate study criterion IDs');
    const predictions = item.predictions ?? [];
    if (new Set(predictions.map(prediction => prediction.prediction_id)).size !== predictions.length) fail('invalid_checkpoint', 'Duplicate study prediction IDs');
    requireReference(predictions.every(prediction => item.criteria.some(criterion => criterion.case_id === prediction.case_id)), 'Prediction refers to an undeclared study case');
    const visited = new Set<string>(); let current: typeof item | undefined = item;
    while (current) {
      requireReference(!visited.has(current.study_id), 'Recursive study parent cycle'); visited.add(current.study_id);
      current = current.parent_name_id ? studies.get(latest.get(current.parent_name_id)!.study_id) : undefined;
    }
  }
  for (const item of state.observations) {
    requireReference(studies.has(item.study_id), 'Dangling observation study');
    requireReference(item.evidence_id === item.evidence.evidence_id, 'Observation evidence ID mismatch');
    requireReference(!item.case_id || studies.get(item.study_id)!.criteria.some(criterion => criterion.case_id === item.case_id), 'Observation refers to an undeclared study case');
    const predictionIds = new Set((studies.get(item.study_id)!.predictions ?? []).map(item => item.prediction_id));
    requireReference((item.prediction_results ?? []).every(result => predictionIds.has(result.prediction_id)), 'Dangling observation prediction result');
  }
  for (const item of state.names) {
    requireReference(studies.has(item.study_id) && (!item.parent_name_id || latest.has(item.parent_name_id)) && item.relations.every(relation => latest.has(relation.to_name_id)), 'Dangling name study or relationship');
    requireReference(item.observation_ids.every(observationId => observations.get(observationId)?.study_id === item.study_id), 'Dangling or foreign-study name observation');
    if (item.revise_name_id) requireReference(item.revise_name_id === item.name_id, 'Name revision points to another name');
    if (item.kind === 'gap' && item.questions.length === 0) fail('invalid_checkpoint', 'Gap is missing its question');
    const basis = item.observation_ids.length === 0 ? 'declaration' : item.observation_ids.every(observationId => observations.get(observationId)!.evidence.confidence === 'inferred') ? 'inferred' : 'supported';
    if (basis !== item.basis) fail('invalid_checkpoint', 'Name basis is inconsistent with supplied observation labels');
  }
  for (const item of state.checks) requireReference(studies.has(item.study_id) && item.cases.every(result => result.observation_id === null || observations.has(result.observation_id)), 'Dangling check study or observation');
  for (const nameId of input.name_ids) if (!latest.has(nameId)) fail('unknown_name', 'Requested name ID is not present', { name_id: nameId });
  signal?.throwIfAborted();
  const terms = input.terms.map(term => term.toLowerCase());
  const seeds = new Set(input.name_ids);
  for (const item of latest.values()) {
    const searchable = [item.name, item.description, ...item.questions, canonical(item.properties)].join('\n').toLowerCase();
    if (terms.some(term => searchable.includes(term))) seeds.add(item.name_id);
  }
  const matched = [...seeds].sort();
  const relationships: z.output<typeof relationship>[] = [];
  const neighbors = new Map([...latest.keys()].map(key => [key, new Set<string>()]));
  for (const item of [...latest.values()].sort((a, b) => a.name_id < b.name_id ? -1 : a.name_id > b.name_id ? 1 : 0)) {
    const edges = [...item.relations, ...(item.parent_name_id ? [{ kind: 'parent-name' as const, to_name_id: item.parent_name_id }] : [])];
    for (const edge of edges) {
      relationships.push({ from_name_id: item.name_id, from_revision: item.revision, kind: edge.kind, to_name_id: edge.to_name_id });
      neighbors.get(item.name_id)!.add(edge.to_name_id); neighbors.get(edge.to_name_id)!.add(item.name_id);
    }
  }
  const order = [...matched]; const reached = new Set(order); let layer = matched;
  for (let hop = 0; hop < input.hops && layer.length; hop++) {
    signal?.throwIfAborted(); const next = new Set<string>();
    for (const nameId of layer) for (const neighbor of neighbors.get(nameId)!) if (!reached.has(neighbor)) next.add(neighbor);
    layer = [...next].sort(); for (const nameId of layer) { reached.add(nameId); order.push(nameId); }
  }
  const selectedIds = order.slice(0, input.limit); const selected = new Set(selectedIds);
  const selectedHistory = selectedIds.flatMap(nameId => histories.get(nameId)!);
  const studyIds = new Set(selectedHistory.map(item => item.study_id));
  for (const studyId of studyIds) {
    const current = studies.get(studyId)!;
    if (current.parent_name_id) studyIds.add(latest.get(current.parent_name_id)!.study_id);
  }
  const selectedChecks = state.checks.filter(item => studyIds.has(item.study_id)).sort((a, b) => a.check_id < b.check_id ? -1 : a.check_id > b.check_id ? 1 : 0);
  const observationIds = new Set(selectedHistory.flatMap(item => item.observation_ids));
  for (const item of selectedChecks) for (const result of item.cases) if (result.observation_id) observationIds.add(result.observation_id);
  signal?.throwIfAborted();
  const output: z.output<typeof designContextOutput> = {
    operation: 'query_design_context', source: { path: input.checkpoint_path, bytes: bytes.length, sha256, checkpoint_checksum: checksum }, parameters: input,
    matched_name_ids: matched, names: selectedIds.map(nameId => latest.get(nameId)!), history: selectedHistory,
    relationships: relationships.filter(edge => selected.has(edge.from_name_id) || selected.has(edge.to_name_id)),
    studies: [...studyIds].sort().map(studyId => studies.get(studyId)!), observations: [...observationIds].sort().map(observationId => observations.get(observationId)!), checks: selectedChecks,
    coverage: { matched_names: matched.length, total_reachable: order.length, returned_names: selectedIds.length, truncated: selectedIds.length < order.length },
    provenance: 'caller-supplied-not-authenticated', runtime_behavior: 'not_established',
    limitations: ['Checkpoint hashes establish consistency with caller-supplied records, not source authenticity or evidence authentication.',
      'Matching and traversal use latest name revisions; retained history may describe superseded claims.',
      'Context is bounded by requested hops and name limit; relationships may reference names outside the returned boundary.',
      'Declared relationships are retained without inferring causality or generating a game-design answer.',
      'Recorded evidence and checks do not establish fresh source observations, current runtime behavior, or game quality.'],
  };
  designContextOutput.parse(output);
  return output;
}
