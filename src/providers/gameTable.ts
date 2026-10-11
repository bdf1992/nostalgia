import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { StudyError } from '../errors.js';
import type { TableRow, TableSource } from '../contracts.js';

export interface GameTable {
  source: { path: string; sha256: string; bytes: number };
  headers: string[];
  rows: TableRow[];
}

// This provider owns file reads and format parsing. It assigns no game semantics.
export async function readGameTable(source: TableSource, signal?: AbortSignal): Promise<GameTable> {
  const handle = await open(source.path, constants.O_RDONLY | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => {
    throw new StudyError('source_unavailable', 'Cannot open the selected table', { path: source.path, reason: error.code });
  });
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new StudyError('unsupported_source', 'A table source must be a regular file', { path: source.path });
    const hash = createHash('sha256');
    const decoder = new TextDecoder(source.encoding, { fatal: true });
    let bytes = 0;
    let headers: string[] = [];
    const rows: TableRow[] = [];
    const decode = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          hash.update(chunk);
          bytes += chunk.length;
          callback(null, decoder.decode(chunk, { stream: true }));
        } catch (error) { callback(error as Error); }
      },
      flush(callback) {
        try { callback(null, decoder.decode()); }
        catch (error) { callback(error as Error); }
      },
    });
    const parser = parse({
      delimiter: source.delimiter === 'tab' ? '\t' : ',',
      bom: true,
      skip_empty_lines: true,
      info: true,
      columns(names: string[]) {
        if (names.some(name => name.length === 0 || name === '__proto__') || new Set(names).size !== names.length) {
          throw new StudyError('invalid_headers', 'Table headers must be nonempty, unique, and cannot use the unsupported __proto__ name', { headers: names });
        }
        headers = names;
        return names;
      },
    });
    await pipeline(handle.createReadStream({ autoClose: false }), decode, parser, async records => {
      for await (const item of records) {
        rows.push({ record: rows.length + 1, line_end: item.info.lines, values: item.record });
      }
    }, { signal });
    const after = await handle.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(bytes) !== after.size) {
      throw new StudyError('source_changed', 'The table changed during inspection; retry with a stable source', { path: source.path });
    }
    if (headers.length === 0) throw new StudyError('invalid_headers', 'The table has no header record', { path: source.path });
    const sha256 = hash.digest('hex');
    if (source.expected_sha256 && sha256 !== source.expected_sha256) {
      throw new StudyError('source_digest_mismatch', 'The table does not match the expected source', { path: source.path, expected_sha256: source.expected_sha256, observed_sha256: sha256 });
    }
    return { source: { path: source.path, sha256, bytes }, headers, rows };
  } catch (error) {
    if (error instanceof StudyError) throw error;
    if (signal?.aborted) throw new StudyError('cancelled', 'Table inspection was cancelled', { path: source.path });
    throw new StudyError('table_read_failed', 'The selected table could not be decoded or parsed', { path: source.path, reason: error instanceof Error ? error.message : String(error) });
  } finally {
    await handle.close();
  }
}
