import { isAbsolute } from 'node:path';
import * as z from 'zod/v4';

const path = z.string().refine(isAbsolute, 'Provide an absolute local file path');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const tableSource = z.strictObject({
  path,
  delimiter: z.enum(['tab', 'comma']),
  encoding: z.enum(['utf-8', 'windows-1252']).default('utf-8'),
  expected_sha256: digest.optional(),
});
const columns = z.array(z.string().min(1)).min(1)
  .refine(values => new Set(values).size === values.length, 'Columns must be unique');
const page = {
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().default(50),
};
export const inspectInput = z.strictObject({
  source: tableSource,
  columns: columns.optional(),
  ...page,
});
export const compareInput = z.strictObject({
  before: tableSource,
  after: tableSource,
  key_columns: columns,
  columns: columns.optional(),
  ...page,
});

const sourceIdentity = z.strictObject({ path, sha256: digest, bytes: z.number().int().nonnegative() });
const row = z.strictObject({
  record: z.number().int().positive(),
  line_end: z.number().int().positive(),
  values: z.record(z.string(), z.string()),
});
const change = z.strictObject({
  kind: z.enum(['added', 'removed', 'changed']),
  key: z.array(z.string()),
  column: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  before_record: z.number().int().positive().nullable(),
  after_record: z.number().int().positive().nullable(),
});
const coverage = z.strictObject({
  status: z.enum(['complete', 'paged']),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
});
const evidence = {
  evidence_id: z.string().regex(/^ev_[a-f0-9]{64}$/),
  provider: z.literal('delimited-game-table/1'),
  limitations: z.array(z.string()),
  runtime_behavior: z.literal('not_established'),
};
export const inspectOutput = z.strictObject({
  ...evidence,
  operation: z.literal('inspect_game_table'),
  confidence: z.literal('observed'),
  source: sourceIdentity,
  parameters: inspectInput,
  headers: z.array(z.string()),
  rows: z.array(row),
  coverage,
});
export const compareOutput = z.strictObject({
  ...evidence,
  operation: z.literal('compare_game_tables'),
  confidence: z.literal('derived'),
  sources: z.tuple([sourceIdentity, sourceIdentity]),
  parameters: compareInput,
  headers: z.strictObject({ before: z.array(z.string()), after: z.array(z.string()) }),
  columns_compared: z.array(z.string()),
  columns_added: z.array(z.string()),
  columns_removed: z.array(z.string()),
  changes: z.array(change),
  summary: z.strictObject({
    rows_added: z.number().int().nonnegative(),
    rows_removed: z.number().int().nonnegative(),
    rows_changed: z.number().int().nonnegative(),
    cells_changed: z.number().int().nonnegative(),
    rows_unchanged: z.number().int().nonnegative(),
  }),
  coverage,
});
export type TableSource = z.output<typeof tableSource>;
export type TableRow = z.output<typeof row>;
export type TableChange = z.output<typeof change>;
