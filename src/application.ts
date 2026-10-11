import { createHash } from 'node:crypto';
import { inspectInput, compareInput, inspectOutput, compareOutput } from './contracts.js';
import type { TableChange, TableRow } from './contracts.js';
import { StudyError } from './errors.js';
import { readGameTable } from './providers/gameTable.js';
import type { GameTable } from './providers/gameTable.js';

function identified<T extends object>(value: T) {
  const canonical = JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return item;
  });
  return { evidence_id: `ev_${createHash('sha256').update(canonical).digest('hex')}`, ...value };
}
function page<T>(values: T[], offset: number, limit: number) {
  const selected = values.slice(offset, offset + limit);
  const next = offset + selected.length < values.length ? offset + selected.length : null;
  return {
    selected,
    coverage: { status: (selected.length === values.length ? 'complete' : 'paged') as 'complete' | 'paged', total: values.length, returned: selected.length, offset, next_offset: next },
  };
}
function requireColumns(table: GameTable, names: string[]) {
  const missing = names.filter(name => !table.headers.includes(name));
  if (missing.length) throw new StudyError('columns_missing', 'Selected columns are absent from the table', { path: table.source.path, missing });
}
function keyed(table: GameTable, columns: string[]) {
  requireColumns(table, columns);
  const rows = new Map<string, TableRow>();
  for (const row of table.rows) {
    const values = columns.map(column => row.values[column]!);
    if (values.some(value => value.length === 0)) throw new StudyError('empty_key', 'A key column has an empty value', { path: table.source.path, record: row.record });
    const key = JSON.stringify(values);
    if (rows.has(key)) throw new StudyError('duplicate_key', 'Key columns do not uniquely identify table records', { path: table.source.path, key: values, records: [rows.get(key)!.record, row.record] });
    rows.set(key, row);
  }
  return rows;
}
const limitations = [
  'Values are source strings; formulas, units, dependencies, and game meaning have not been evaluated.',
  'Table data does not establish loaded configuration, runtime behavior, balance, or player experience.',
  'The provider retains decoded records in memory; pagination limits returned records, not source-read memory.',
];

export async function inspectGameTable(raw: unknown, signal?: AbortSignal) {
  const input = inspectInput.parse(raw);
  const table = await readGameTable(input.source, signal);
  const columns = input.columns ?? table.headers;
  requireColumns(table, columns);
  const resultPage = page(table.rows, input.offset, input.limit);
  return inspectOutput.parse(identified({
    operation: 'inspect_game_table', provider: 'delimited-game-table/1', confidence: 'observed',
    source: table.source, parameters: input, headers: table.headers,
    rows: resultPage.selected.map(row => ({ ...row, values: Object.fromEntries(columns.map(column => [column, row.values[column]!])) })),
    coverage: resultPage.coverage, runtime_behavior: 'not_established', limitations,
  }));
}

export async function compareGameTables(raw: unknown, signal?: AbortSignal) {
  const input = compareInput.parse(raw);
  const before = await readGameTable(input.before, signal);
  const after = await readGameTable(input.after, signal);
  const left = keyed(before, input.key_columns);
  const right = keyed(after, input.key_columns);
  const columns = input.columns ?? [...new Set([...before.headers, ...after.headers])];
  if (input.columns) { requireColumns(before, columns); requireColumns(after, columns); }
  const changes: TableChange[] = [];
  const summary = { rows_added: 0, rows_removed: 0, rows_changed: 0, cells_changed: 0, rows_unchanged: 0 };
  // Explicit keys align records; source order must not imply identity.
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const old = left.get(key);
    const next = right.get(key);
    let changed = false;
    if (!old) summary.rows_added++;
    else if (!next) summary.rows_removed++;
    for (const column of columns) {
      const a = old && Object.hasOwn(old.values, column) ? old.values[column]! : null;
      const b = next && Object.hasOwn(next.values, column) ? next.values[column]! : null;
      if (a === b) continue;
      changes.push({ kind: !old ? 'added' : !next ? 'removed' : 'changed', key: JSON.parse(key), column, before: a, after: b, before_record: old?.record ?? null, after_record: next?.record ?? null });
      changed = true;
      if (old && next) summary.cells_changed++;
    }
    if (old && next) {
      if (changed) summary.rows_changed++;
      else summary.rows_unchanged++;
    }
  }
  const resultPage = page(changes, input.offset, input.limit);
  return compareOutput.parse(identified({
    operation: 'compare_game_tables', provider: 'delimited-game-table/1', confidence: 'derived',
    sources: [before.source, after.source], parameters: input,
    headers: { before: before.headers, after: after.headers }, columns_compared: columns,
    columns_added: after.headers.filter(column => !before.headers.includes(column)),
    columns_removed: before.headers.filter(column => !after.headers.includes(column)),
    changes: resultPage.selected, summary, coverage: resultPage.coverage,
    runtime_behavior: 'not_established', limitations,
  }));
}
