import { McpServer } from '@modelcontextprotocol/server';
import { inspectInput, compareInput, inspectOutput, compareOutput } from './contracts.js';
import { inspectGameTable, compareGameTables } from './application.js';
import { diagnostic } from './errors.js';
import { presentGameplayObservation } from './gameplayMcpPresentation.js';
import { inspectToolchain, toolchainInput, toolchainOutput } from './toolchain.js';
import { queryDesignContext, designContextInput, designContextOutput } from './designContext.js';
import { checkpointInput, verifyCheckpointInput, restoreInput, createCheckpointOutput,
  verifyCheckpointOutput, restoreCheckpointOutput, createFileCheckpoint,
  verifySelectedFileCheckpoint, restoreFileCheckpoint } from './fileCheckpoint.js';
import { startGameplayEnvironment, inspectGameplayEnvironment, actInGameplayEnvironment,
  stopGameplayEnvironment, startEnvironmentInput, startEnvironmentOutput,
  inspectEnvironmentInput, inspectEnvironmentOutput, actEnvironmentInput,
  actEnvironmentOutput, stopEnvironmentInput, stopEnvironmentOutput, focusOnGameplayEnvironment, focusEnvironmentInput, focusEnvironmentOutput } from './gameplayEnvironment.js';

export function createServer() {
  const server = new McpServer({ name: 'nostalgia', version: '0.2.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const copyAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  server.registerTool('focus_on_gameplay_environment', {
    description: 'Select the owned native gameplay target and return its actual frame. Booth selection stays on its hidden desktop; Sky activates the foreground window and may move the cursor. Browser explicit focus is currently unsupported.',
    inputSchema: focusEnvironmentInput, outputSchema: focusEnvironmentOutput, annotations: { ...copyAnnotations, openWorldHint: true },
  }, async input => {
    try { const output = await focusOnGameplayEnvironment(input); return presentGameplayObservation(output); }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] }; }
  });
  server.registerTool('start_gameplay_environment', {
    description: 'Start gameplay from a verified checkpoint in a fresh copied workspace. Browser uses a fresh context and declared network policy. Windows-native selects a private Sky or hidden Booth bridge and a fixed offline ME3 Elden Ring profile with separate save filename; shared assets remain referenced. Booth provides virtual gamepad input and viewer audio. Sky uses foreground input. The provider owner must remain alive; running is not a gameplay-quality verdict.',
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
    description: 'Observe a managed gameplay session by its private local session path. Returns bounded visible text and an actual frame from the browser, hidden Booth or foreground Sky, or retained stopped status. MCP sends frame bytes once as image content; structured metadata omits them. Oversized frames remain in retained session evidence with an explicit notice. The provider owner must remain alive; caller-supplied session metadata is not authenticated provenance or a gameplay-quality verdict.',
    inputSchema: inspectEnvironmentInput, outputSchema: inspectEnvironmentOutput,
    annotations: { ...copyAnnotations, openWorldHint: true },
  }, async (input) => {
    try {
      const output = await inspectGameplayEnvironment(input);
      return presentGameplayObservation(output);
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('act_in_gameplay_environment', {
    description: 'Send one bounded action and retain the actual resulting frame. Booth supports leased virtual gamepad state and waits on its owned hidden desktop. Sky supports foreground keys, frame-relative clicks and waits. Browser bounds remain 1280x720. Input success is not a gameplay-quality verdict.',
    inputSchema: actEnvironmentInput, outputSchema: actEnvironmentOutput,
    annotations: { ...copyAnnotations, openWorldHint: true },
  }, async (input) => {
    try {
      const output = await actInGameplayEnvironment(input);
      return presentGameplayObservation(output);
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(diagnostic(error)) }] };
    }
  });
  server.registerTool('stop_gameplay_environment', {
    description: 'Stop owned gameplay resources while retaining copies and receipts. Browser closes its own context and servers. Booth quiesces the exact owned game/controller, closes viewer capture, restores audio routing and closes its desktop. Sky sends Alt+F4 only to its exact observed owned window. Both verify shutdown and report incomplete cleanup. Never signals guessed PIDs or closes unrelated windows.',
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
