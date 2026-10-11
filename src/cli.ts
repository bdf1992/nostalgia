#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { inspectGameTable, compareGameTables } from './application.js';
import { diagnostic, StudyError } from './errors.js';
import { createServer } from './server.js';
import { inspectToolchain } from './toolchain.js';
import { queryDesignContext } from './designContext.js';

const operations = {
  'inspect-game-table': inspectGameTable,
  'compare-game-tables': compareGameTables,
  'inspect-toolchain': inspectToolchain,
  'query-design-context': queryDesignContext,
};

const [command, requestPath, ...rest] = process.argv.slice(2);
if (command === 'mcp' && !requestPath && rest.length === 0) {
  void serveStdio(createServer);
} else if (command === '--help' && !requestPath) {
  console.log(`Usage: node dist/cli.js ${Object.keys(operations).join('|')} <request.json>\n       node dist/cli.js mcp`);
} else {
  try {
    if (!requestPath || rest.length || !Object.hasOwn(operations, command ?? '')) {
      throw new StudyError('invalid_command', `Use ${Object.keys(operations).join(', ')} with one request JSON file, or mcp`);
    }
    let input: unknown;
    try { input = JSON.parse(await readFile(requestPath, 'utf8')); }
    catch (error) { throw new StudyError('invalid_request_file', 'Cannot read the request as JSON', { path: requestPath, reason: error instanceof Error ? error.message : String(error) }); }
    const output = await operations[command as keyof typeof operations](input);
    console.log(JSON.stringify(output));
  } catch (error) {
    console.log(JSON.stringify(diagnostic(error)));
    process.exitCode = 1;
  }
}
