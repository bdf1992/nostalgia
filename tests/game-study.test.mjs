import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { inspectGameTable, compareGameTables } from '../dist/application.js';

const cli = resolve('dist/cli.js');
async function fixtures(t) {
  const root = await mkdtemp(join(tmpdir(), 'nostalgia-study-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = join(root, 'before.tsv');
  const after = join(root, 'after.tsv');
  // Original synthetic data, not Diablo or other commercial game bytes.
  await writeFile(before, 'skill\tmana\tcooldown\nnova\t12\t0\nrush\t8\t3\n');
  await writeFile(after, 'skill\tmana\tcooldown\nrush\t8\t3\nnova\t9\t0\nfrost\t4\t2\n');
  return { root, before, after };
}
function source(path, overrides = {}) { return { path, delimiter: 'tab', ...overrides }; }
async function invoke(root, command, input) {
  const request = join(root, 'request.json');
  await writeFile(request, JSON.stringify(input));
  const result = spawnSync(process.execPath, [cli, command, request], { encoding: 'utf8' });
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  return { status: result.status, output: JSON.parse(result.stdout) };
}
async function connect(t) {
  const client = new Client({ name: 'nostalgia-verifier', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', data => { stderr += data; });
  t.after(async () => { await client.close(); assert.equal(stderr, ''); });
  await client.connect(transport);
  return client;
}

test('compiled CLI and real stdio MCP inspect and compare the same identified data', async t => {
  const data = await fixtures(t);
  const client = await connect(t);
  const catalog = await client.listTools();
  assert.deepEqual(catalog.tools.map(tool => tool.name).sort(), ['act_in_gameplay_environment', 'compare_game_tables', 'create_file_checkpoint', 'focus_on_gameplay_environment', 'inspect_game_table', 'inspect_gameplay_environment', 'inspect_toolchain', 'query_design_context', 'restore_file_checkpoint', 'start_gameplay_environment', 'stop_gameplay_environment', 'verify_file_checkpoint']);
  for (const tool of catalog.tools) {
    const writes = ['create_file_checkpoint', 'restore_file_checkpoint', 'start_gameplay_environment', 'inspect_gameplay_environment', 'act_in_gameplay_environment', 'focus_on_gameplay_environment', 'stop_gameplay_environment'].includes(tool.name);
    assert.equal(tool.annotations.readOnlyHint, !writes);
    assert.equal(tool.annotations.idempotentHint, tool.name === 'stop_gameplay_environment' || !writes);
    assert.equal(tool.annotations.destructiveHint, tool.name === 'stop_gameplay_environment');
    assert.equal(tool.annotations.openWorldHint, tool.name.includes('gameplay_environment') && tool.name !== 'stop_gameplay_environment');
    assert.ok(tool.outputSchema);
    if (['start_gameplay_environment', 'act_in_gameplay_environment'].includes(tool.name) && tool.inputSchema.anyOf) {
      assert.ok(tool.inputSchema.anyOf.length >= 2);
      for (const provider of tool.inputSchema.anyOf) assert.equal(provider.additionalProperties, false);
    } else assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const inspect = { source: source(data.before), columns: ['skill', 'mana'], limit: 1 };
  const fromCli = await invoke(data.root, 'inspect-game-table', inspect);
  assert.equal(fromCli.status, 0);
  const fromMcp = await client.callTool({ name: 'inspect_game_table', arguments: inspect });
  assert.equal(fromMcp.isError, undefined);
  assert.deepEqual(fromMcp.structuredContent, fromCli.output);
  assert.deepEqual(JSON.parse(fromMcp.content[0].text), fromCli.output);
  assert.equal(fromCli.output.source.sha256, createHash('sha256').update(await readFile(data.before)).digest('hex'));
  assert.deepEqual(fromCli.output.rows[0], { record: 1, line_end: 2, values: { skill: 'nova', mana: '12' } });
  assert.deepEqual(fromCli.output.coverage, { status: 'paged', total: 2, returned: 1, offset: 0, next_offset: 1 });
  assert.equal(fromCli.output.runtime_behavior, 'not_established');
  const { evidence_id, ...payload } = fromCli.output;
  const canonical = JSON.stringify(payload, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
  assert.equal(evidence_id, `ev_${createHash('sha256').update(canonical).digest('hex')}`);
  const next = await client.callTool({ name: 'inspect_game_table', arguments: { ...inspect, offset: 1 } });
  assert.equal(next.structuredContent.rows[0].values.skill, 'rush');
  assert.equal(next.structuredContent.coverage.next_offset, null);

  const compare = { before: source(data.before), after: source(data.after), key_columns: ['skill'] };
  const delta = await invoke(data.root, 'compare-game-tables', compare);
  assert.equal(delta.status, 0);
  const mcpDelta = await client.callTool({ name: 'compare_game_tables', arguments: compare });
  assert.deepEqual(mcpDelta.structuredContent, delta.output);
  assert.deepEqual(delta.output.summary, { rows_added: 1, rows_removed: 0, rows_changed: 1, cells_changed: 1, rows_unchanged: 1 });
  const changed = delta.output.changes.filter(change => change.kind === 'changed');
  assert.deepEqual(changed, [{ kind: 'changed', key: ['nova'], column: 'mana', before: '12', after: '9', before_record: 1, after_record: 2 }]);
  const reverse = await compareGameTables({ ...compare, before: compare.after, after: compare.before });
  assert.equal(reverse.summary.rows_removed, 1);
  assert.equal(reverse.changes.find(change => change.kind === 'changed').after, '12');
});

test('source failures have matching CLI/MCP diagnostics and CLI nonzero exits', async t => {
  const data = await fixtures(t);
  const client = await connect(t);
  for (const [input, code] of [
    [{ source: source(join(data.root, 'missing.tsv')) }, 'source_unavailable'],
    [{ source: source(data.before, { expected_sha256: '0'.repeat(64) }) }, 'source_digest_mismatch'],
    [{ source: source(data.before), columns: ['not-a-column'] }, 'columns_missing'],
  ]) {
    const fromCli = await invoke(data.root, 'inspect-game-table', input);
    const fromMcp = await client.callTool({ name: 'inspect_game_table', arguments: input });
    assert.equal(fromCli.status, 1);
    assert.equal(fromMcp.isError, true);
    assert.deepEqual(JSON.parse(fromMcp.content[0].text), fromCli.output);
    assert.equal(fromCli.output.error.code, code);
    assert.equal(fromMcp.structuredContent, undefined);
  }
  const relative = await invoke(data.root, 'inspect-game-table', { source: source('before.tsv') });
  assert.equal(relative.output.error.code, 'invalid_request');
  const invalid = await client.callTool({ name: 'inspect_game_table', arguments: { source: source('before.tsv') } });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent, undefined);
});

test('parser preserves quoted, multiline and encoded values; rejects ambiguous or malformed data', async t => {
  const data = await fixtures(t);
  const csv = join(data.root, 'quoted.csv');
  await writeFile(csv, '\ufeffname,text\nhero,"a,b\nsecond line"\n');
  const observed = await inspectGameTable({ source: { path: csv, delimiter: 'comma' } });
  assert.equal(observed.rows[0].values.text, 'a,b\nsecond line');
  assert.equal(observed.rows[0].line_end, 3);
  const cp = join(data.root, 'encoded.csv');
  await writeFile(cp, Buffer.from('name,text\nhero,caf\xe9\n', 'latin1'));
  const encoded = await inspectGameTable({ source: { path: cp, delimiter: 'comma', encoding: 'windows-1252' } });
  assert.equal(encoded.rows[0].values.text, 'café');
  await assert.rejects(() => inspectGameTable({ source: { path: cp, delimiter: 'comma' } }), error => error.code === 'table_read_failed');
  for (const [content, expected] of [
    ['skill\tskill\na\tb\n', 'invalid_headers'],
    ['id\t__proto__\na\tvalue\n', 'invalid_headers'],
    ['skill\tmana\na\n', 'table_read_failed'],
    ['', 'invalid_headers'],
  ]) {
    await writeFile(data.after, content);
    await assert.rejects(() => inspectGameTable({ source: source(data.after) }), error => error.code === expected);
  }
  await writeFile(data.after, 'skill\tmana\na\t1\na\t2\n');
  await assert.rejects(() => compareGameTables({ before: source(data.before), after: source(data.after), key_columns: ['skill'] }), error => error.code === 'duplicate_key');
  await writeFile(data.after, 'skill\tmana\n\t1\n');
  await assert.rejects(() => compareGameTables({ before: source(data.before), after: source(data.after), key_columns: ['skill'] }), error => error.code === 'empty_key');
});

test('schema changes remain visible and selected-column comparisons disclose scope', async t => {
  const data = await fixtures(t);
  await writeFile(data.after, 'skill\tmana\trange\nnova\t12\t5\nrush\t8\t1\n');
  const input = { before: source(data.before), after: source(data.after), key_columns: ['skill'], limit: 1 };
  const comparison = await compareGameTables(input);
  assert.deepEqual(comparison.columns_added, ['range']);
  assert.deepEqual(comparison.columns_removed, ['cooldown']);
  assert.equal(comparison.coverage.total, 4);
  assert.equal(comparison.coverage.status, 'paged');
  assert.equal(comparison.coverage.next_offset, 1);
  const selected = await compareGameTables({ ...input, columns: ['mana'] });
  assert.deepEqual(selected.columns_compared, ['mana']);
  assert.equal(selected.summary.rows_unchanged, 2);
  assert.deepEqual(selected.columns_removed, ['cooldown']);
  const empty = await inspectGameTable({ source: source(data.before), offset: 100 });
  assert.equal(empty.coverage.returned, 0);
  assert.equal(empty.coverage.status, 'paged');
  assert.equal(empty.coverage.next_offset, null);
});

test('cancelled reads release the source without modifying it', async t => {
  const data = await fixtures(t);
  const original = await readFile(data.before);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => inspectGameTable({ source: source(data.before) }, controller.signal), error => error.code === 'cancelled');
  assert.deepEqual(await readFile(data.before), original);
  await rm(data.before); // On Windows an unreleased read handle would prevent this.
});

test('removed and added prototype-named columns are source cells rather than inherited properties', async t => {
  const data = await fixtures(t);
  await writeFile(data.before, 'id\ttoString\tconstructor\na\tx\ty\n');
  await writeFile(data.after, 'id\na\n');
  const input = { before: source(data.before), after: source(data.after), key_columns: ['id'] };
  const compared = await compareGameTables(input);
  assert.deepEqual(compared.changes.map(change => [change.column, change.before, change.after]), [['toString', 'x', null], ['constructor', 'y', null]]);
  const reverse = await compareGameTables({ ...input, before: input.after, after: input.before });
  assert.deepEqual(reverse.changes.map(change => [change.column, change.before, change.after]), [['toString', null, 'x'], ['constructor', null, 'y']]);
});
