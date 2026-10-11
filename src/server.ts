import { McpServer } from '@modelcontextprotocol/server';
import { inspectInput, compareInput, inspectOutput, compareOutput } from './contracts.js';
import { inspectGameTable, compareGameTables } from './application.js';
import { diagnostic } from './errors.js';

export function createServer() {
  const server = new McpServer({ name: 'nostalgia', version: '0.2.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('inspect_game_table', {
    description: 'Inspect a caller-selected extracted game table (tab or comma delimited). Returns source hash, headers, exact string values, record locations, pagination, and limits of the observation. Does not extract archives or establish gameplay behavior.',
    inputSchema: inspectInput, outputSchema: inspectOutput, annotations,
  }, async (input, extra) => {
    try {
      const output = await inspectGameTable(input, extra.mcpReq.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('compare_game_tables', {
    description: 'Compare two extracted game tables by explicit unique key columns. Reports row and cell changes, added/removed columns, source hashes, and pagination. Comparison covers selected columns; differences are not proof of gameplay effects.',
    inputSchema: compareInput, outputSchema: compareOutput, annotations,
  }, async (input, extra) => {
    try {
      const output = await compareGameTables(input, extra.mcpReq.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  return server;
}
