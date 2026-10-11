# Game-table study through CLI and MCP

Nostalgia currently implements two read-only operations: `inspect_game_table` and
`compare_game_tables`. Their CLI names use hyphens. They share input validation,
file reads, parsing, comparison, evidence, and errors across both interfaces.

These operations support studying caller-supplied extracted mechanics tables.
They do not locate game installations, extract MPQ/CASC archives, evaluate game
formulas, execute games, apply mods, or access process memory. This provider does
not claim Diablo II format conformance; the acceptance suite uses original
synthetic ARPG tables.

## Installation and execution

Use Node.js 24 or later, `npm ci`, then `npm run build`. The local stdio MCP launch
command is `node`, with absolute path to `dist/cli.js` followed by `mcp` as its
arguments. No registration is written automatically. See the
[official MCP server documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-server.md).

The server currently advertises exactly these two tools, including strict input
and output schemas and read-only annotations. It has no generation or mutation
tools. CLI failures return JSON diagnostics and exit nonzero; MCP tool failures
set `isError` and return diagnostics without a successful structured result.
The MCP SDK rejects invalid contracts before the handler; its validation
diagnostics differ from CLI request-validation diagnostics.

## Inspect a table

Put this request in `request.json`, replacing the example with an absolute path
to a table on your machine:

```json
{
  "source": {
    "path": "C:/Games/ARPG-study/skills.tsv",
    "delimiter": "tab",
    "encoding": "utf-8"
  },
  "columns": ["skill", "mana"],
  "offset": 0,
  "limit": 50
}
```

Run `node dist/cli.js inspect-game-table request.json`, or call MCP
`inspect_game_table` with that object. `columns` is optional; omitting it returns
all columns. `delimiter` is required: `tab` or `comma`. Encoding defaults to
`utf-8`; `windows-1252` is also supported. Quoting follows CSV rules. Empty lines
are skipped; empty field values and whitespace are preserved. Headers must be
nonempty and unique, and every data record must have the header's field count.
The header `__proto__` is rejected explicitly because the current output-schema
codec cannot preserve it as a record key; no success silently drops that column.
This provider uses [csv-parse](https://csv.js.org/parse/options/) for parsing.

Results retain exact string values without evaluating formulas or converting
numbers. Each returned row has a one-based data-record ordinal and the ending
physical line number, including multiline quoted fields. Source identity includes
the selected path, byte count, and SHA-256. Optional `expected_sha256` rejects
stale or unintended inputs. Detected changes during a read fail the operation.
The result is an observation of the read bytes, not a guarantee that a path still
contains those bytes later.

## Compare versions

```json
{
  "before": { "path": "C:/Games/ARPG-study/original.tsv", "delimiter": "tab" },
  "after": { "path": "C:/Games/ARPG-study/candidate.tsv", "delimiter": "tab" },
  "key_columns": ["skill"],
  "columns": ["mana", "cooldown"],
  "offset": 0,
  "limit": 50
}
```

Run `node dist/cli.js compare-game-tables comparison.json`, or call MCP
`compare_game_tables`. Key values must be nonempty and unique within each source.
Multiple key columns form a tuple; source row order is not identity. Explicit
comparison columns must exist in both sources. Omit `columns` to compare the
union of their headers, including added and removed columns. Missing cells are
`null`; empty strings remain empty strings.

The summary counts added, removed, changed, and unchanged rows within the selected
column comparison, plus changed cells in paired rows. Added/removed header names
remain visible even when selected columns exclude them. Thus `rows_unchanged`
does not assert equality of excluded columns or of runtime behavior.

## Coverage and limitations

Both operations scan and identify the full selected sources before producing a
page. Offset is zero-based and limit defaults to 50. Inspection pages data rows;
comparison pages changed cells. `coverage.total`, `returned`, and `next_offset`
make omitted results explicit; `status` is `paged` whenever the returned page
does not contain all results. Requesting an offset beyond the end returns an
empty page with no next offset. Pin expected source digests when paging mutable
files so pages cannot silently span different versions.

The provider retains decoded records in memory; pagination limits output, not
memory use. Comparison is exact string comparison. It does not infer units,
formula meanings, dependencies, balance, loaded configuration, or gameplay feel.
Every success explicitly reports `runtime_behavior: not_established`.

The evidence ID hashes the result, including its parsed parameters, excluding the
ID itself. Object properties are sorted lexically at every level before JSON
serialization; array order is preserved. It is a Nostalgia
observation ID, not a REA Evidence record; the two are not interchangeable.
Results are inline, without an implicit retained-evidence store.

## Verification

`npm test` builds the runtime and checks actual CLI/MCP parity, source digests,
record locations, quoted and encoded values, keyed differences, header changes,
pagination, malformed data, duplicate keys, missing sources, and cancellation
cleanup. Successful synthetic tests establish these operations only. They do not
establish game modification, a live-game connection, or ARPG quality.
