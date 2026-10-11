import { McpServer } from '@modelcontextprotocol/server';
import { inspectInput, compareInput, inspectOutput, compareOutput } from './contracts.js';
import { inspectGameTable, compareGameTables } from './application.js';
import { diagnostic } from './errors.js';
import { inspectToolchain, toolchainInput, toolchainOutput } from './toolchain.js';
import { queryDesignContext, designContextInput, designContextOutput } from './designContext.js';
import { checkpointInput, verifyCheckpointInput, restoreInput, createCheckpointOutput,
  verifyCheckpointOutput, restoreCheckpointOutput, createFileCheckpoint,
  verifySelectedFileCheckpoint, restoreFileCheckpoint } from './fileCheckpoint.js';
import { startGameplayEnvironment, inspectGameplayEnvironment, actInGameplayEnvironment,
  stopGameplayEnvironment, startEnvironmentInput, startEnvironmentOutput,
  inspectEnvironmentInput, inspectEnvironmentOutput, actEnvironmentInput,
  actEnvironmentOutput, stopEnvironmentInput, stopEnvironmentOutput } from './gameplayEnvironment.js';

export function createServer() {
  const server = new McpServer({ name: 'nostalgia', version: '0.2.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const copyAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  server.registerTool('start_gameplay_environment', {
    description: 'Start a managed browser gameplay environment from a verified file checkpoint in a fresh copied workspace and separate browser profile. Audience user/shared opens a visible window; agent runs headless. Declares HTTP/WebSocket allowed origins. Returns session and input/observation paths; running is not proof of gameplay quality. Browser provider only: native games require their own adapter. Creator process must remain alive.',
    inputSchema: startEnvironmentInput, outputSchema: startEnvironmentOutput,
    annotations: { ...copyAnnotations, openWorldHint: true },
  }, async (input, extra) => {
    try {
      const output = await startGameplayEnvironment(input, extra.mcpReq.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('inspect_gameplay_environment', {
    description: 'Observe a managed gameplay session by its private local session path. Returns bounded visible text and a rendered PNG frame for a running browser session, or retained stopped status. Requires the creator process to remain alive; does not authenticate caller-supplied session metadata or judge gameplay quality.',
    inputSchema: inspectEnvironmentInput, outputSchema: inspectEnvironmentOutput,
    annotations: { ...copyAnnotations, openWorldHint: true },
  }, async (input) => {
    try {
      const output = await inspectGameplayEnvironment(input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) },
        ...(output.screenshot_png_base64 ? [{ type: 'image' as const, data: output.screenshot_png_base64, mimeType: 'image/png' }] : [])], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('act_in_gameplay_environment', {
    description: 'Send a bounded keypress, viewport click, or wait to a managed browser gameplay session. Retains attempted actions and actual resulting text/frame. Coordinates refer to the 1280x720 viewport. No arbitrary evaluation, shell execution, or native-game controls. Input success does not establish a design or QA verdict.',
    inputSchema: actEnvironmentInput, outputSchema: actEnvironmentOutput,
    annotations: { ...copyAnnotations, openWorldHint: true },
  }, async (input) => {
    try {
      const output = await actInGameplayEnvironment(input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) },
        ...(output.observation.screenshot_png_base64 ? [{ type: 'image' as const, data: output.observation.screenshot_png_base64, mimeType: 'image/png' }] : [])], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('stop_gameplay_environment', {
    description: 'Close the browser and servers owned by a managed gameplay session, retaining its workspace and records. Does not signal guessed PIDs, delete game copies, roll back progress, or close unrelated sessions. Stop reports success after owned resources close.',
    inputSchema: stopEnvironmentInput, outputSchema: stopEnvironmentOutput,
    annotations: { ...copyAnnotations, destructiveHint: true, idempotentHint: true },
  }, async (input) => {
    try {
      const output = await stopGameplayEnvironment(input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('create_file_checkpoint', {
    description: 'Copy an explicit list of regular local files into an absent checkpoint directory and retain file paths, sizes and hashes. Never replaces sources or existing destinations. Rejects links and overlapping roots. Writes declared file copies only; does not capture process memory, filesystem metadata, runtime dependencies or establish baseline gameplay. Use while relevant writers are stopped and wait for successful completion.',
    inputSchema: checkpointInput, outputSchema: createCheckpointOutput, annotations: copyAnnotations,
  }, async (input, extra) => {
    try {
      const output = await createFileCheckpoint(input, extra.mcpReq.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('verify_file_checkpoint', {
    description: 'Verify a caller-selected local file checkpoint manifest, identity and exact payload hashes without changing it. Rejects corruption, extra or missing files and links. Supplied hashes establish internal consistency, not publisher authenticity, live-state restoration or gameplay equivalence.',
    inputSchema: verifyCheckpointInput, outputSchema: verifyCheckpointOutput, annotations,
  }, async (input, extra) => {
    try {
      const output = await verifySelectedFileCheckpoint(input, extra.mcpReq.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('restore_file_checkpoint', {
    description: 'Verify a declared-file checkpoint and copy its payload to a fresh absent directory. Existing destinations, original paths and the checkpoint are never replaced. Does not launch the target, redirect its save paths, restore process memory or establish a playable baseline. Wait for successful completion before using the copy.',
    inputSchema: restoreInput, outputSchema: restoreCheckpointOutput, annotations: copyAnnotations,
  }, async (input, extra) => {
    try {
      const output = await restoreFileCheckpoint(input, extra.mcpReq.signal);
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
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
