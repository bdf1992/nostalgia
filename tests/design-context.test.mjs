import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { queryDesignContext } from '../dist/designContext.js';

// Original synthetic design records. Evidence labels deliberately are not
// authenticated semantic IDs: this operation must treat them as supplied claims.
const evId = `ev_${'a'.repeat(64)}`;
function evidence(confidence = 'inferred') {
  return { evidence_id: evId, subject: null, provider: { id: 'synthetic', name: 'Synthetic recorder', version: '1' },
    analysis_profile: null, predicate_type: 'fixture', operation: 'synthetic_observe', parameters: {},
    raw_result: { supplied: true }, normalized_result: { distance: 4 }, confidence, authority: 'analyst-inference',
    environment: null, limitations: ['Synthetic claim; not a game measurement'], locations: [], evidence_links: [], extra_evidence_field: 'retain' };
}
function observation(observation_id, study_id, confidence = 'inferred') {
  return { observation_id, study_id, evidence_id: evId, role: 'target', description: 'Synthetic movement evidence', builds: [],
    evidence: evidence(confidence), prediction_results: [] };
}
function name(name_id, study_id, fields = {}) {
  return { name_id, revision: 1, study_id, name: name_id, kind: 'model', description: 'Synthetic component', observation_ids: [],
    questions: [], properties: {}, assets: [], relations: [], basis: 'declaration', ...fields };
}
function fixture() {
  const root = { study_id: 'root-study', target: { name: 'Synthetic world', locator: 'fixture://world', sha256: null }, objective: 'Study requested feel',
    criteria: [{ case_id: 'distance', description: 'Declared distance', input: {}, expected: 4, required_authority: 'analyst-inference', tolerance: 0, invariant: false }],
    predictions: [{ prediction_id: 'prediction', explanation: 'Declared prediction', case_id: 'distance', expected: 4, value_pointer: '/distance' }], builds: [],
    extra_study_field: { retained: true } };
  const child = { ...structuredClone(root), study_id: 'child-study', parent_name_id: 'a', objective: 'Study animation' };
  return { studies: [root, child],
    observations: [observation('old-observation', 'root-study'), observation('new-observation', 'root-study', 'derived'),
      observation('check-observation', 'root-study'), observation('child-observation', 'child-study')],
    names: [name('d', 'root-study'),
      name('a', 'root-study', { name: 'Old movement', observation_ids: ['old-observation'], questions: ['Superseded jump question?'], basis: 'inferred' }),
      name('c', 'child-study', { relations: [{ kind: 'depends-on', to_name_id: 'a' }] }),
      name('a', 'root-study', { revision: 2, revise_name_id: 'a', name: 'Movement', description: 'Responsive dodge', questions: ['What interrupts a dodge?'],
        observation_ids: ['new-observation'], properties: { ...JSON.parse('{"__proto__":{"retained":"original JSON property"}}'), numeric_keys: { '10': 'ten', '2': 'two' }, '\u{10000}': 'supplementary', '\ue000': 'bmp' },
        relations: [{ kind: 'uses', to_name_id: 'b' }], basis: 'supported', extra_name_field: 'retain' }),
      name('b', 'child-study', { name: 'Animation', parent_name_id: 'a', observation_ids: ['child-observation'], properties: { feel: 'steady' }, basis: 'inferred' })],
    checks: [{ check_id: 'root-check', study_id: 'root-study', status: 'unresolved', cases: [{ case_id: 'distance', status: 'unresolved',
      reason: 'No controlled playtest', observation_id: 'check-observation', value_pointer: '/distance', actual: 4, expected: 4 }], extra_check_field: 'retain' },
      { check_id: 'child-check', study_id: 'child-study', status: 'fail', cases: [{ case_id: 'distance', status: 'fail', reason: 'Synthetic mismatch',
        observation_id: 'child-observation', value_pointer: '/distance', actual: 4, expected: 5 }] }], extra_state_field: 'retain-checksum' };
}
// Independent canonical emitter; numeric and supplementary-plane keys exercise
// UTF-16 ordering, including where object-rebuilding JSON.stringify is incorrect.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function checkpoint(state, version = 1) {
  return { version, state, checksum: createHash('sha256').update(canonical({ version, state })).digest('hex') };
}
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'nostalgia-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'checkpoint.json');
  const state = fixture(); await writeFile(path, JSON.stringify(checkpoint(state)));
  return { root, path, state, input: { checkpoint_path: path, terms: ['DODGE'], hops: 1 } };
}
async function invoke(root, input) {
  const request = join(root, 'request.json'); await writeFile(request, JSON.stringify(input));
  const result = spawnSync(process.execPath, [resolve('dist/cli.js'), 'query-design-context', request], { encoding: 'utf8' });
  assert.equal(result.signal, null); assert.equal(result.stderr, '');
  return { status: result.status, output: JSON.parse(result.stdout) };
}
async function connect(t) {
  const client = new Client({ name: 'design-context-verifier', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp'] }));
  return client;
}

test('compiled CLI and stdio MCP retrieve the same bounded context with original record fields', async t => {
  const data = await setup(t); const original = await readFile(data.path);
  const input = { ...data.input, limit: 2 };
  const cli = await invoke(data.root, input); assert.equal(cli.status, 0);
  const client = await connect(t);
  const tool = (await client.listTools()).tools.find(tool => tool.name === 'query_design_context');
  assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.inputSchema.additionalProperties, false); assert.equal(tool.outputSchema.additionalProperties, false);
  const mcp = await client.callTool({ name: 'query_design_context', arguments: input });
  assert.equal(mcp.isError, undefined); assert.deepEqual(mcp.structuredContent, cli.output);
  assert.deepEqual(JSON.parse(mcp.content[0].text), cli.output);
  const output = cli.output;
  assert.deepEqual(output.names.map(item => item.name_id), ['a', 'b']);
  assert.deepEqual(output.matched_name_ids, ['a']);
  assert.deepEqual(output.coverage, { matched_names: 1, total_reachable: 3, returned_names: 2, truncated: true });
  assert.deepEqual(output.history.filter(item => item.name_id === 'a').map(item => item.revision), [1, 2]);
  assert.equal(output.history[0].questions[0], 'Superseded jump question?');
  assert.equal(output.names[0].extra_name_field, 'retain');
  assert.deepEqual(output.names[0].properties, data.state.names.find(item => item.name_id === 'a' && item.revision === 2).properties);
  assert.equal(Object.hasOwn(output.names[0].properties, '__proto__'), true);
  assert.deepEqual(output.names[0].properties.__proto__, { retained: 'original JSON property' });
  assert.ok(output.relationships.some(edge => edge.from_name_id === 'c' && edge.to_name_id === 'a' && edge.kind === 'depends-on'));
  assert.ok(output.relationships.some(edge => edge.from_name_id === 'a' && edge.to_name_id === 'b' && edge.kind === 'uses' && edge.from_revision === 2));
  assert.ok(output.relationships.some(edge => edge.from_name_id === 'b' && edge.to_name_id === 'a' && edge.kind === 'parent-name'));
  assert.deepEqual(output.studies.map(item => item.study_id), ['child-study', 'root-study']);
  assert.deepEqual(output.observations.map(item => item.observation_id), ['check-observation', 'child-observation', 'new-observation', 'old-observation']);
  assert.equal(output.observations[0].evidence.extra_evidence_field, 'retain');
  assert.equal(output.observations[0].evidence.confidence, 'inferred');
  assert.equal(output.observations[0].evidence.authority, 'analyst-inference');
  assert.deepEqual(output.observations[0].evidence.limitations, ['Synthetic claim; not a game measurement']);
  assert.equal(output.checks.find(item => item.check_id === 'root-check').status, 'unresolved');
  assert.equal(output.studies[1].predictions[0].prediction_id, 'prediction');
  assert.equal(output.provenance, 'caller-supplied-not-authenticated'); assert.equal(output.runtime_behavior, 'not_established');
  assert.equal(output.source.sha256, createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(await readFile(data.path), original);
});

test('latest-only relevance, OR union, sorted breadth-first traversal and zero-hop boundaries', async t => {
  const data = await setup(t);
  assert.equal((await queryDesignContext({ ...data.input, terms: ['Superseded jump'] })).names.length, 0);
  const output = await queryDesignContext({ ...data.input, terms: ['not found', 'steady'], name_ids: ['d'], hops: 0 });
  assert.deepEqual(output.matched_name_ids, ['b', 'd']); assert.deepEqual(output.names.map(item => item.name_id), ['b', 'd']);
  assert.deepEqual(output.studies.map(item => item.study_id), ['child-study', 'root-study']);
  assert.ok(output.relationships.some(edge => edge.to_name_id === 'a'));
  const incoming = await queryDesignContext({ checkpoint_path: data.path, name_ids: ['c'], hops: 2 });
  assert.deepEqual(incoming.names.map(item => item.name_id), ['c', 'a', 'b']);
  const noMatch = await queryDesignContext({ ...data.input, terms: ['nothing-matches'] });
  for (const field of ['matched_name_ids', 'names', 'history', 'relationships', 'studies', 'observations', 'checks']) assert.deepEqual(noMatch[field], []);
  assert.deepEqual(noMatch.coverage, { matched_names: 0, total_reachable: 0, returned_names: 0, truncated: false });
});

test('matching CLI/MCP corruption and reference diagnostics have nonzero CLI exits', async t => {
  const data = await setup(t); const client = await connect(t);
  for (const [mutation, code] of [
    [value => { value.checksum = '0'.repeat(64); }, 'checkpoint_checksum_mismatch'],
    [value => { value.version = 2; }, 'unsupported_checkpoint_version'],
    [value => { value.state.names[0].relations.push({ kind: 'uses', to_name_id: 'absent' }); value.checksum = checkpoint(value.state).checksum; }, 'checkpoint_reference_invalid'],
  ]) {
    const value = checkpoint(fixture()); mutation(value); await writeFile(data.path, JSON.stringify(value));
    const cli = await invoke(data.root, data.input);
    const mcp = await client.callTool({ name: 'query_design_context', arguments: data.input });
    assert.equal(cli.status, 1); assert.equal(cli.output.error.code, code); assert.equal(mcp.isError, true);
    assert.deepEqual(JSON.parse(mcp.content[0].text), cli.output);
  }
  await writeFile(data.path, JSON.stringify(checkpoint(data.state)));
  await assert.rejects(queryDesignContext({ ...data.input, expected_sha256: '0'.repeat(64) }), error => error.code === 'source_digest_mismatch');
  await assert.rejects(queryDesignContext({ checkpoint_path: data.path, name_ids: ['absent'] }), error => error.code === 'unknown_name');
});

test('duplicate IDs, invalid revisions and dangling references are refused throughout the checkpoint', async t => {
  const data = await setup(t);
  const cases = [
    [state => state.studies.push(state.studies[0]), 'invalid_checkpoint'],
    [state => { state.checks[0].check_id = 'a'; }, 'invalid_checkpoint'],
    [state => state.names.push(state.names[1]), 'invalid_checkpoint'],
    [state => { state.names[3].revision = 3; }, 'invalid_checkpoint'],
    [state => { state.names[3].study_id = 'child-study'; }, 'invalid_checkpoint'],
    [state => { state.studies[1].parent_name_id = 'missing'; }, 'checkpoint_reference_invalid'],
    [state => { state.studies[0].parent_name_id = 'a'; }, 'checkpoint_reference_invalid'],
    [state => { state.studies[0].parent_name_id = 'c'; state.studies[1].parent_name_id = 'missing'; }, 'checkpoint_reference_invalid'],
    [state => { state.studies[0].predictions[0].case_id = 'missing'; }, 'checkpoint_reference_invalid'],
    [state => { state.observations[0].study_id = 'missing'; }, 'checkpoint_reference_invalid'],
    [state => { state.observations[0].evidence_id = 'different'; }, 'checkpoint_reference_invalid'],
    [state => { state.observations[0].case_id = 'missing'; }, 'checkpoint_reference_invalid'],
    [state => { state.names[0].parent_name_id = 'missing'; }, 'checkpoint_reference_invalid'],
    [state => { state.names[0].observation_ids = ['missing']; }, 'checkpoint_reference_invalid'],
    [state => { state.names[0].observation_ids = ['child-observation']; }, 'checkpoint_reference_invalid'],
    [state => { state.checks[0].study_id = 'missing'; }, 'checkpoint_reference_invalid'],
    [state => { state.checks[0].cases[0].observation_id = 'missing'; }, 'checkpoint_reference_invalid'],
    [state => { state.names[0].questions = [3]; }, 'invalid_checkpoint'],
    [state => { state.names[0].kind = 'gap'; }, 'invalid_checkpoint'],
    [state => { state.names[0].basis = 'supported'; }, 'invalid_checkpoint'],
    [state => { state.observations[0].evidence.confidence = 'certain'; }, 'invalid_checkpoint'],
  ];
  for (const [mutate, code] of cases) {
    const state = fixture(); mutate(state); await writeFile(data.path, JSON.stringify(checkpoint(state)));
    await assert.rejects(queryDesignContext(data.input), error => error.code === code, `${code} for ${mutate}`);
  }
});

test('source admission, UTF8, nesting, invalid input and cancellation are bounded and read-only', async t => {
  const data = await setup(t);
  await assert.rejects(queryDesignContext({ ...data.input, checkpoint_path: data.root }), error => error.code === 'checkpoint_unavailable');
  await assert.rejects(queryDesignContext({ ...data.input, checkpoint_path: join(data.root, 'missing') }), error => error.code === 'checkpoint_unavailable');
  for (const bytes of [Buffer.from('{'), Buffer.from([0xff]), Buffer.from('{"version":1,"state":{}}')]) {
    await writeFile(data.path, bytes);
    await assert.rejects(queryDesignContext(data.input), error => error.code === 'invalid_checkpoint');
  }
  const deep = `${'['.repeat(102)}0${']'.repeat(102)}`; await writeFile(data.path, deep);
  await assert.rejects(queryDesignContext(data.input), error => error.code === 'invalid_checkpoint');
  await writeFile(data.path, '{"version":1,"state":{"number":1e999}}');
  await assert.rejects(queryDesignContext(data.input), error => error.code === 'invalid_checkpoint');
  await truncate(data.path, 5 * 1024 * 1024 + 1);
  await assert.rejects(queryDesignContext(data.input), error => error.code === 'checkpoint_unavailable');
  await writeFile(data.path, JSON.stringify(checkpoint(data.state)));
  for (const input of [{ checkpoint_path: data.path }, { ...data.input, terms: [' '] }, { ...data.input, hops: 4 },
    { ...data.input, limit: 0 }, { ...data.input, extra: true }, { ...data.input, checkpoint_path: 'relative' }]) {
    await assert.rejects(queryDesignContext(input), error => error.name === 'ZodError');
  }
  const original = await readFile(data.path);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(queryDesignContext(data.input, controller.signal), { name: 'AbortError' });
  const during = new AbortController(); const pending = queryDesignContext(data.input, during.signal); during.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(await readFile(data.path), original);
});
