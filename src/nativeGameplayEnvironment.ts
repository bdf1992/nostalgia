import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import * as z from 'zod/v4';
import { StudyError } from './errors.js';
import { checkpointInput } from './fileCheckpoint.js';

const absolute = z.string().min(1).max(4096).refine(isAbsolute, 'Provide an absolute local path');
export const nativeStartInput = z.strictObject({ provider: z.literal('windows-native'), bridge_path: absolute,
  backend: z.enum(['sky', 'booth']).optional(),
  checkpoint: absolute, destination: absolute, audience: z.enum(['agent', 'user', 'shared']).default('shared'),
  lifetime_seconds: z.number().int().min(30).max(86400).default(3600), me3_executable: absolute.refine(value => /(?:^|[\\/])me3\.exe$/i.test(value), 'Select me3.exe'),
  game_executable: absolute.refine(value => /(?:^|[\\/])eldenring\.exe$/i.test(value), 'Select eldenring.exe'),
  savefile: z.string().min(5).max(128).regex(/^[A-Za-z0-9_-]+\.sl2$/i).refine(value => !/^(?:ER0000|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\.sl2$/i.test(value), 'Use a separate portable alternate save filename'),
  mode: z.literal('application-offline'), save_seed: z.strictObject({ checkpoint: absolute,
    path: checkpointInput.shape.files.element.shape.path.refine(value => /\.sl2$/i.test(value), 'Select a captured SL2 save member') }).optional() });
export const nativeInspectInput = z.strictObject({ session_path: absolute });
export const nativeActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('gamepad'), connected: z.boolean(), buttons: z.number().int().min(0).max(65535).refine(value => (value & ~0xF3FF) === 0, 'Reserved gamepad buttons are unavailable'),
    left_trigger: z.number().int().min(0).max(255), right_trigger: z.number().int().min(0).max(255),
    left_x: z.number().int().min(-32768).max(32767), left_y: z.number().int().min(-32768).max(32767),
    right_x: z.number().int().min(-32768).max(32767), right_y: z.number().int().min(-32768).max(32767), lease_ms: z.number().int().min(0).max(2000)
  }).refine(value => value.connected ? value.lease_ms >= 1 : value.lease_ms === 0 && value.buttons === 0 && value.left_trigger === 0 && value.right_trigger === 0 && value.left_x === 0 && value.left_y === 0 && value.right_x === 0 && value.right_y === 0, 'Connected input requires a lease; disconnected input must be neutral with lease zero'),
  z.strictObject({ kind: z.literal('key'), key: z.string().min(1).max(100).refine(value => !value.split('+').some(part => /^(?:meta|windows|win|cmd|command|super|os)$/i.test(part.trim())), 'Windows and Meta shortcuts are unavailable') }),
  z.strictObject({ kind: z.literal('click'), x: z.number().min(0).max(32767), y: z.number().min(0).max(32767) }),
  z.strictObject({ kind: z.literal('wait'), milliseconds: z.number().int().min(0).max(2000) })]);
export const nativeActInput = z.strictObject({ session_path: absolute, action: nativeActionSchema });
const identity = { session_path: absolute, session_id: z.string().uuid(), checkpoint_id: z.string().regex(/^cp_[a-f0-9]{64}$/) };
const artifact = z.strictObject({ path: absolute, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const nativeWindowSchema = z.strictObject({ app: z.string().min(1).max(8192), id: z.number().int().nonnegative(), title: z.string().max(4096).optional() });
export const nativeScreenshotSchema = z.strictObject({ id: z.string().min(1).max(1024), url: z.string().max(12 * 1024 ** 2),
  width: z.number().int().positive().max(32768).optional(), height: z.number().int().positive().max(32768).optional(),
  originX: z.number().optional(), originY: z.number().optional(), zIndex: z.number() });
export const nativeStartOutput = z.strictObject({ ...identity, provider: z.literal('windows-native'), gameplay_url: z.string(),
  audience: z.enum(['agent', 'user', 'shared']), working_directory: absolute, savefile: z.string(),
  runtime: z.strictObject({ provider: z.enum(['windows-native-sky', 'windows-native-booth-protoinput']), me3: artifact, game: artifact, profile: artifact, mode: z.literal('application-offline') }),
  save_seed: z.strictObject({ checkpoint_id: z.string().regex(/^cp_[a-f0-9]{64}$/), member: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), created_save_path: absolute }).optional(),
  coverage: z.literal('declared-files-copied-shared-game-assets-referenced'), input_behavior: z.enum(['foreground-input-may-move-cursor', 'owned-hidden-desktop-virtual-input']),
  guarantees: z.array(z.string()), limitations: z.array(z.string()) }).refine(value => (value.runtime.provider === 'windows-native-sky') === (value.input_behavior === 'foreground-input-may-move-cursor'), 'Runtime provider and input behavior must agree');
export const nativeInspectOutput = z.strictObject({ ...identity, provider: z.literal('windows-native'), status: z.enum(['running', 'stopped', 'failed']),
  url: z.string(), visible_text: z.string().max(16384), screenshot_image_base64: z.string().max(12 * 1024 ** 2), screenshot_mime_type: z.enum(['image/png', 'image/jpeg']), screenshot_png_base64: z.string().max(12 * 1024 ** 2).optional(),
  window: nativeWindowSchema, screenshots: z.array(nativeScreenshotSchema).min(1).max(8), input_behavior: z.enum(['foreground-input-may-move-cursor', 'owned-hidden-desktop-virtual-input']) });
export const nativeActOutput = z.strictObject({ action: nativeActionSchema, observation: nativeInspectOutput });
export const nativeStopOutput = z.strictObject({ ...identity, provider: z.literal('windows-native'), status: z.literal('stopped') });
export const nativeFocusOutput = z.strictObject({ focused: z.literal(true), observation: nativeInspectOutput });
const endpoint = z.string().max(2048).refine(value => { try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 0 && url.pathname === '/control' && !url.search && !url.hash && !url.username && !url.password; } catch { return false; } }, 'Provide the private loopback control endpoint');
export const nativeBridgeReceiptSchema = z.strictObject({ version: z.literal(1), provider: z.enum(['windows-native-sky-bridge', 'windows-native-booth-bridge']), bridge_id: z.string().uuid(), bridge_path: absolute,
  url: endpoint, token: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['running', 'closed']) });
export const nativeSessionReceiptSchema = nativeStartOutput.safeExtend({ bridge_path: absolute, status: z.enum(['starting', 'running', 'stopped', 'failed']), expires_at: z.string().datetime() });
export async function admitNativePath(path: string, directory = false) {
  const full = resolve(path), root = parse(full).root, parts = relative(root, full).split(sep).filter(Boolean); let current = root;
  for (let index = 0; index <= parts.length; index++) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index < parts.length || directory ? !stat.isDirectory() : !stat.isFile())) throw new StudyError('native_path_refused', 'Native paths require real directories and regular files without aliases');
    if (index === parts.length) return stat;
    current = join(current, parts[index]!);
  }
  throw new Error('Unreachable native path guard');
}
export async function readNativeFile(path: string, limit: number) {
  const stat = await admitNativePath(path); if (stat.size > limit) throw new StudyError('native_limit', 'Native metadata exceeds its bound');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat(); if (opened.ino !== stat.ino || opened.dev !== stat.dev) throw new StudyError('native_path_refused', 'Native file changed during admission');
    const chunks: Buffer[] = []; let count = 0;
    while (true) { const buffer = Buffer.alloc(65536), { bytesRead } = await handle.read(buffer); if (!bytesRead) break; count += bytesRead; if (count > limit) throw new StudyError('native_limit', 'Native metadata exceeds its bound'); chunks.push(buffer.subarray(0, bytesRead)); }
    const after = await admitNativePath(path); if (after.ino !== stat.ino || after.dev !== stat.dev || after.size !== count || after.mtimeMs !== stat.mtimeMs) throw new StudyError('native_path_refused', 'Native file changed during read');
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}
export async function nativeFileDigest(path: string) {
  const before = await admitNativePath(path), handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat(); if (opened.dev !== before.dev || opened.ino !== before.ino) throw new StudyError('native_path_refused', 'Artifact changed during admission');
    const hash = createHash('sha256'); let count = 0;
    while (true) { const buffer = Buffer.alloc(1024 * 1024), { bytesRead } = await handle.read(buffer); if (!bytesRead) break; count += bytesRead; if (count > 1024 ** 3) throw new StudyError('native_limit', 'Native artifact exceeds 1 GiB'); hash.update(buffer.subarray(0, bytesRead)); }
    const after = await admitNativePath(path); if (after.dev !== before.dev || after.ino !== before.ino || after.size !== count || after.mtimeMs !== before.mtimeMs) throw new StudyError('native_path_refused', 'Artifact changed during hashing');
    return hash.digest('hex');
  } finally { await handle.close(); }
}
export async function isNativeSession(path: string) { const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readNativeFile(path, 512 * 1024))) as { provider?: unknown }; return raw.provider === 'windows-native'; }
async function bridgeAt(path: string) {
  const receipt = nativeBridgeReceiptSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readNativeFile(path, 65536))));
  if (resolve(receipt.bridge_path) !== resolve(path) || receipt.status !== 'running') throw new StudyError('native_bridge_invalid', 'Private bridge receipt is closed or its path differs');
  return receipt;
}
async function sessionAt(path: string) {
  const receipt = nativeSessionReceiptSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readNativeFile(path, 512 * 1024))));
  if (resolve(receipt.session_path) !== resolve(path) || resolve(receipt.working_directory) !== join(dirname(resolve(path)), 'game')) throw new StudyError('native_session_invalid', 'Native session receipt paths differ from its selected directory');
  return receipt;
}
function verifyIdentity(output: { session_path: string; session_id: string; checkpoint_id: string; input_behavior?: string }, receipt: { session_path: string; session_id: string; checkpoint_id: string; input_behavior?: string }) {
  if (resolve(output.session_path) !== resolve(receipt.session_path) || output.session_id !== receipt.session_id || output.checkpoint_id !== receipt.checkpoint_id) throw new StudyError('native_session_invalid', 'Returned native identity differs from selected session');
  if (output.input_behavior !== undefined && output.input_behavior !== receipt.input_behavior) throw new StudyError('native_backend_mismatch', 'Returned native input behavior differs from selected session');
}
function bridgeProvider(runtime: string) { return runtime === 'windows-native-booth-protoinput' ? 'windows-native-booth-bridge' : 'windows-native-sky-bridge'; }
async function nativeRpc(bridgePath: string, request: unknown, signal?: AbortSignal, expectedProvider = 'windows-native-sky-bridge') {
  const bridge = await bridgeAt(bridgePath), body = JSON.stringify(request); if (Buffer.byteLength(body) > 16384) throw new StudyError('native_limit', 'Native control request exceeds 16 KiB');
  if (bridge.provider !== expectedProvider) throw new StudyError('native_backend_mismatch', 'Selected bridge does not provide the requested native backend');
  const startup = expectedProvider === 'windows-native-booth-bridge' && typeof request === 'object' && request !== null && 'operation' in request && request.operation === 'start';
  const deadline = AbortSignal.timeout(startup ? 300000 : 120000);
  const response = await fetch(bridge.url, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body,
    redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  const reader = response.body?.getReader(); if (!reader) throw new StudyError('native_control_failed', 'Native control response has no body');
  let count = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const next = await reader.read(); if (next.done) break; count += next.value.length; if (count > 24 * 1024 ** 2) throw new StudyError('native_limit', 'Native response exceeds 24 MiB'); chunks.push(next.value); } } finally { await reader.cancel(); }
  const output = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as { error?: { code?: string; message?: string } };
  if (!response.ok) throw new StudyError(output.error?.code ?? 'native_control_failed', output.error?.message ?? 'Native control request failed');
  return output;
}
export async function startNativeGameplayEnvironment(raw: unknown, signal?: AbortSignal) {
  const input = nativeStartInput.parse(raw), expectedRuntime = input.backend === 'booth' ? 'windows-native-booth-protoinput' : 'windows-native-sky';
  const output = nativeStartOutput.parse(await nativeRpc(input.bridge_path, { operation: 'start', input }, signal, bridgeProvider(expectedRuntime)));
  if (output.runtime.provider !== expectedRuntime) throw new StudyError('native_backend_mismatch', 'Returned native runtime differs from requested backend');
  if (resolve(output.session_path) !== join(resolve(input.destination), 'session.json') || resolve(output.working_directory) !== join(resolve(input.destination), 'game') ||
    resolve(output.runtime.game.path) !== resolve(input.game_executable) || resolve(output.runtime.me3.path) !== resolve(input.me3_executable) ||
    resolve(output.runtime.profile.path) !== join(resolve(input.destination), 'baseline.me3') || output.savefile !== input.savefile || output.audience !== input.audience ||
    Boolean(output.save_seed) !== Boolean(input.save_seed) || output.save_seed && output.save_seed.member !== input.save_seed?.path)
    throw new StudyError('native_session_invalid', 'Returned native launch identity differs from selected request');
  return output;
}
export async function inspectNativeGameplayEnvironment(raw: unknown) {
  const input = nativeInspectInput.parse(raw), receipt = await sessionAt(input.session_path);
  const output = nativeInspectOutput.parse(receipt.status === 'stopped' || receipt.status === 'failed'
    ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readNativeFile(join(dirname(receipt.session_path), 'observation.json'), 24 * 1024 ** 2)))
    : await nativeRpc(receipt.bridge_path, { operation: 'inspect', session_path: input.session_path }, undefined, bridgeProvider(receipt.runtime.provider)));
  verifyIdentity(output, receipt); return output;
}
export async function actInNativeGameplayEnvironment(raw: unknown) { const input = nativeActInput.parse(raw), receipt = await sessionAt(input.session_path); if (receipt.status !== 'running') throw new StudyError('native_session_stopped', 'Native session is not running'); const output = nativeActOutput.parse(await nativeRpc(receipt.bridge_path, { operation: 'act', ...input }, undefined, bridgeProvider(receipt.runtime.provider))); verifyIdentity(output.observation, receipt); if (JSON.stringify(output.action) !== JSON.stringify(input.action)) throw new StudyError('native_session_invalid', 'Returned native action differs'); return output; }
export async function focusOnNativeGameplayEnvironment(raw: unknown) { const input = nativeInspectInput.parse(raw), receipt = await sessionAt(input.session_path); if (receipt.status !== 'running') throw new StudyError('native_session_stopped', 'Native session is not running'); const output = nativeFocusOutput.parse(await nativeRpc(receipt.bridge_path, { operation: 'focus', ...input }, undefined, bridgeProvider(receipt.runtime.provider))); verifyIdentity(output.observation, receipt); return output; }
export async function stopNativeGameplayEnvironment(raw: unknown) { const input = nativeInspectInput.parse(raw), receipt = await sessionAt(input.session_path); if (receipt.status === 'stopped') return nativeStopOutput.parse({ provider: 'windows-native', session_path: receipt.session_path, session_id: receipt.session_id, checkpoint_id: receipt.checkpoint_id, status: 'stopped' }); const output = nativeStopOutput.parse(await nativeRpc(receipt.bridge_path, { operation: 'stop', ...input }, undefined, bridgeProvider(receipt.runtime.provider))); verifyIdentity(output, receipt); return output; }
