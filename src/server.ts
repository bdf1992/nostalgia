import { McpServer } from '@modelcontextprotocol/server';
import { inspectInput, compareInput, inspectOutput, compareOutput } from './contracts.js';
import { inspectGameTable, compareGameTables } from './application.js';
import { diagnostic } from './errors.js';
import { inspectToolchain, toolchainInput, toolchainOutput } from './toolchain.js';
import { queryDesignContext, designContextInput, designContextOutput } from './designContext.js';

export function createServer() {
  const server = new McpServer({ name: 'nostalgia', version: '0.2.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('query_design_context', {
    description: 'Retrieve named systems and connected design context from a caller-selected local REA-SON v1 checkpoint. Preserves revisions, questions, evidence labels, study criteria, and checks. Bounded literal matching and relationship traversal; does not answer the design question, authenticate supplied evidence, mutate the graph, or establish gameplay behavior.',
    inputSchema: designContextInput, outputSchema: designContextOutput, annotations,
  }, async (input, extra) => {
    try {
      const output = await queryDesignContext(input, extra.mcpReq.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('inspect_toolchain', {
    description: 'Hash the ten selected provider artifacts against a caller-supplied local provisioning manifest. Reports missing or changed files without executing providers. Recorded smoke checks do not establish current runtime health or game support.',
    inputSchema: toolchainInput, outputSchema: toolchainOutput, annotations,
  }, async (input, extra) => {
    try {
      const output = await inspectToolchain(input, extra.mcpReq.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
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
