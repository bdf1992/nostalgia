import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { lstat, mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep, extname } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as z from 'zod/v4';
import { verifyFileCheckpoint, restoreFileCheckpoint } from './fileCheckpoint.js';
import { diagnostic, StudyError } from './errors.js';

const absolute = z.string().max(4096).refine(isAbsolute, 'Provide an absolute local path');
const origin = z.string().max(2048).refine(value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password; } catch { return false; }
}, 'Provide an exact HTTP or HTTPS origin');
const networkSchema = z.strictObject({ mode: z.enum(['isolated', 'networked']).default('isolated'), allowed_origins: z.array(origin).max(100).default([]) }).refine(value => value.mode !== 'isolated' || value.allowed_origins.length === 0, 'Isolated mode cannot allow external origins');
export const startEnvironmentInput = z.strictObject({ checkpoint: absolute, destination: absolute,
  entrypoint: z.string().max(4096).default('index.html'), audience: z.enum(['agent', 'user', 'shared']).default('agent'),
  network: networkSchema.default({ mode: 'isolated', allowed_origins: [] }), lifetime_seconds: z.number().int().min(30).max(86400).default(3600) });
export const inspectEnvironmentInput = z.strictObject({ session_path: absolute });
const actionSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('key'), key: z.string().min(1).max(100) }),
  z.strictObject({ kind: z.literal('click'), x: z.number().min(0).max(1279), y: z.number().min(0).max(719) }),
  z.strictObject({ kind: z.literal('wait'), milliseconds: z.number().int().min(0).max(2000) })]);
export const actEnvironmentInput = z.strictObject({ session_path: absolute, action: actionSchema });
export const stopEnvironmentInput = inspectEnvironmentInput;
const identity = { session_path: absolute, session_id: z.string().uuid(), checkpoint_id: z.string().regex(/^cp_[a-f0-9]{64}$/) };
const runtimeSchema = z.strictObject({ provider: z.literal('playwright-chromium'), playwright_version: z.literal('1.64.0'), browser_version: z.string(), executable: absolute, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const startEnvironmentOutput = z.strictObject({ ...identity, gameplay_url: z.string().url(), audience: z.enum(['agent', 'user', 'shared']), network: networkSchema,
  working_directory: absolute, runtime: runtimeSchema, guarantees: z.array(z.string()), limitations: z.array(z.string()) });
export const inspectEnvironmentOutput = z.strictObject({ ...identity, status: z.enum(['running', 'stopped', 'failed']), url: z.string(), visible_text: z.string().max(16384), screenshot_png_base64: z.string().max(Math.ceil(8 * 1024 ** 2 / 3) * 4) });
export const actEnvironmentOutput = z.strictObject({ action: actionSchema, observation: inspectEnvironmentOutput });
export const stopEnvironmentOutput = z.strictObject({ ...identity, status: z.literal('stopped') });
const controlUrl = z.string().refine(value => { try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 0 && url.pathname === '/control' && !url.search && !url.hash && !url.username && !url.password; } catch { return false; } });
const receiptSchema = startEnvironmentOutput.extend({ control_url: controlUrl, token: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['running', 'stopped', 'failed']), expires_at: z.string().datetime() });
type Receipt = z.output<typeof receiptSchema>;
type Observation = z.output<typeof inspectEnvironmentOutput>;
type Action = z.output<typeof actionSchema>;
type Session = { receipt: Receipt; browser: Browser; context: BrowserContext; page: Page; host: Server; control: Server; timer?: NodeJS.Timeout; queue: Promise<unknown>; observation?: Observation; journal: unknown[]; destinationIdentity: { dev: number; ino: number }; metadata: Map<string, Stats>; stopping: boolean };
const sessions = new Map<string, Session>();
const pendingStarts = new Map<AbortController, Promise<unknown>>();
let closing = false;
function fail(code: string, message: string): never { throw new StudyError(code, message); }
function overlap(a: string, b: string) { const left = resolve(a).toLowerCase(), right = resolve(b).toLowerCase(); return left === right || left.startsWith(right + sep) || right.startsWith(left + sep); }
async function guard(path: string, directory = false) {
  const full = resolve(path), root = parse(full).root, parts = relative(root, full).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index <= parts.length; index++) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index < parts.length || directory ? !stat.isDirectory() : !stat.isFile())) fail('environment_path_refused', 'Selected path must have regular files and real directory ancestors');
    if (index === parts.length) return stat;
    current = join(current, parts[index]!);
  }
  throw new Error('Unreachable path guard');
}
async function readRegular(path: string, limit: number) {
  const before = await guard(path); if (before.size > limit) fail('environment_limit', 'Selected file exceeds the read limit');
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat(); if (stat.dev !== before.dev || stat.ino !== before.ino || !stat.isFile()) fail('environment_path_refused', 'Selected file identity changed');
    const chunks: Buffer[] = []; let count = 0;
    while (true) { const buffer = Buffer.alloc(65536), { bytesRead } = await handle.read(buffer); if (!bytesRead) break; count += bytesRead; if (count > limit) fail('environment_limit', 'Selected file exceeds the read limit'); chunks.push(buffer.subarray(0, bytesRead)); }
    const after = await guard(path); if (after.dev !== before.dev || after.ino !== before.ino || after.size !== count || after.mtimeMs !== before.mtimeMs) fail('environment_path_refused', 'Selected file changed during read');
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}
async function digestExecutable(path: string) {
  const before = await guard(path), handle = await open(path, 'r'), hash = createHash('sha256');
  try { const opened = await handle.stat(); if (opened.dev !== before.dev || opened.ino !== before.ino) fail('environment_path_refused', 'Browser executable changed'); while (true) { const buffer = Buffer.alloc(1024 * 1024), { bytesRead } = await handle.read(buffer); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); } const after = await guard(path); if (after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('environment_path_refused', 'Browser executable changed'); return hash.digest('hex'); } finally { await handle.close(); }
}
async function writeOwned(session: Session, filename: string, value: unknown, _exclusive = false) {
  const directory = dirname(session.receipt.session_path), current = await guard(directory, true);
  if (current.dev !== session.destinationIdentity.dev || current.ino !== session.destinationIdentity.ino) fail('environment_path_refused', 'Owned session directory identity changed');
  const path = join(directory, filename);
  const owned = session.metadata.get(filename);
  const handle = await open(path, owned ? constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) : 'wx', 0o600);
  try {
    const opened = await handle.stat(), named = await guard(path), parent = await guard(directory, true);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== named.dev || opened.ino !== named.ino ||
      parent.dev !== session.destinationIdentity.dev || parent.ino !== session.destinationIdentity.ino ||
      owned && (opened.dev !== owned.dev || opened.ino !== owned.ino)) fail('environment_path_refused', 'Owned metadata identity changed; refusing overwrite');
    // Open without truncation, verify ownership, then replace only our own file bytes.
    await handle.truncate(0); await handle.writeFile(JSON.stringify(value));
    session.metadata.set(filename, await handle.stat());
  } finally { await handle.close(); }
}
async function listen(server: Server) {
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolveListen(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback address'); return `http://127.0.0.1:${address.port}`;
}
async function closeServer(server: Server) { if (!server.listening) return; await new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeAllConnections(); }); }
function serialized<T>(session: Session, operation: () => Promise<T>): Promise<T> { const result = session.queue.then(operation); session.queue = result.catch(() => {}); return result; }
async function observe(session: Session) {
  if (session.receipt.status !== 'running') return { ...session.observation!, status: session.receipt.status };
  const screenshot = await session.page.screenshot({ type: 'png', timeout: 10000 });
  if (screenshot.length > 8 * 1024 ** 2) fail('environment_limit', 'Rendered screenshot exceeds 8 MiB');
  const observation: Observation = { session_path: session.receipt.session_path, session_id: session.receipt.session_id, checkpoint_id: session.receipt.checkpoint_id,
    status: 'running', url: session.page.url(), visible_text: new TextDecoder().decode(Buffer.from(await session.page.locator('body').innerText({ timeout: 10000 })).subarray(0, 16384), { stream: true }), screenshot_png_base64: screenshot.toString('base64') };
  session.observation = inspectEnvironmentOutput.parse(observation); await writeOwned(session, 'observation.json', observation); return observation;
}
async function stop(session: Session, status: 'stopped' | 'failed' = 'stopped', responding = false) {
  if (session.receipt.status !== 'running') return stopEnvironmentOutput.parse({ session_path: session.receipt.session_path, session_id: session.receipt.session_id, checkpoint_id: session.receipt.checkpoint_id, status: 'stopped' });
  session.stopping = true;
  clearTimeout(session.timer);
  await session.context.close(); await session.browser.close(); await closeServer(session.host);
  // Stop accepting new requests before replying on the currently authenticated connection.
  if (responding) { session.control.close(); session.control.closeIdleConnections(); } else await closeServer(session.control);
  if (session.browser.isConnected() || session.host.listening || session.control.listening) fail('environment_close_failed', 'Owned gameplay resources remain open');
  session.receipt.status = status;
  sessions.delete(session.receipt.session_id);
  await writeOwned(session, 'session.json', session.receipt);
  if (session.observation) await writeOwned(session, 'observation.json', { ...session.observation, status });
  return stopEnvironmentOutput.parse({ session_path: session.receipt.session_path, session_id: session.receipt.session_id, checkpoint_id: session.receipt.checkpoint_id, status: 'stopped' });
}
async function act(session: Session, action: Action) {
  if (session.receipt.status !== 'running') fail('environment_stopped', 'Gameplay session is no longer running');
  const record: Record<string, unknown> = { sequence: Number((session.journal.at(-1) as { sequence?: number })?.sequence ?? 0) + 1, attempted_at: new Date().toISOString(), action, status: 'attempted' };
  session.journal.push(record); session.journal = session.journal.slice(-1000); await writeOwned(session, 'actions.json', session.journal);
  try {
    let deadline: NodeJS.Timeout | undefined;
    const operation = async () => {
      if (action.kind === 'key') await session.page.keyboard.press(action.key);
      else if (action.kind === 'click') await session.page.mouse.click(action.x, action.y);
      else await session.page.waitForTimeout(action.milliseconds);
      return observe(session);
    };
    let observation: Observation;
    try { observation = await Promise.race([operation(), new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => { void session.page.close().catch(() => {}); reject(new StudyError('environment_action_timeout', 'Browser action exceeded 15 seconds')); }, 15000); })]); }
    finally { clearTimeout(deadline); }
    const { screenshot_png_base64, ...summary } = observation;
    record.status = 'observed'; record.observation = { ...summary, screenshot_sha256: createHash('sha256').update(Buffer.from(screenshot_png_base64, 'base64')).digest('hex') };
    await writeOwned(session, 'actions.json', session.journal);
    return { action, observation };
  } catch (error) { record.status = 'failed'; record.error = diagnostic(error); await writeOwned(session, 'actions.json', session.journal); throw error; }
}
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml' };
async function requestBody(req: IncomingMessage) { let count = 0; const chunks: Buffer[] = []; for await (const chunk of req) { const bytes = Buffer.from(chunk); count += bytes.length; if (count > 16384) fail('environment_limit', 'Control request exceeds 16 KiB'); chunks.push(bytes); } return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
function reply(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' }); res.end(JSON.stringify(value)); }
async function startOwnedGameplayEnvironment(raw: unknown, signal?: AbortSignal) {
  const input = startEnvironmentInput.parse(raw); signal?.throwIfAborted();
  const installed = createRequire(import.meta.url)('playwright/package.json') as { version?: string };
  if (installed.version !== '1.64.0') fail('environment_provider_mismatch', 'Gameplay provider requires pinned Playwright 1.64.0');
  const checkpoint = resolve(input.checkpoint), destination = resolve(input.destination);
  if (overlap(checkpoint, destination)) fail('environment_path_refused', 'Checkpoint and session directory may not overlap');
  const manifest = await verifyFileCheckpoint(checkpoint, signal);
  if (!/\.html?$/i.test(input.entrypoint) || !manifest.files.some(file => file.path === input.entrypoint)) fail('environment_entrypoint_refused', 'Entrypoint must be a captured HTML file');
  await guard(dirname(destination), true);
  try { await lstat(destination); fail('environment_destination_exists', 'Session destination must be absent'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const executable = chromium.executablePath(), sha256 = await digestExecutable(executable);
  signal?.throwIfAborted(); await mkdir(destination); const destinationIdentity = await guard(destination, true);
  let browser: Browser | undefined, context: BrowserContext | undefined, host: Server | undefined, control: Server | undefined, session: Session | undefined;
  try {
    const working = join(destination, 'game'); await restoreFileCheckpoint({ checkpoint, destination: working }, signal);
    const paths = new Set(manifest.files.map(file => file.path));
    host = createServer((req, res) => { void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      let path: string; try { const decoded = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0]!); if (decoded.split('/').some(part => part === '.' || part === '..')) { res.writeHead(403); res.end(); return; } path = decoded.slice(1); } catch { res.writeHead(400); res.end(); return; }
      if (!paths.has(path) || path.includes('\\')) { res.writeHead(404); res.end(); return; }
      const bytes = await readRegular(join(working, ...path.split('/')), 64 * 1024 ** 2);
      res.writeHead(200, { 'content-type': mime[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : bytes);
    })().catch(() => { if (!res.headersSent) res.writeHead(403); res.end(); }); });
    const gameplayOrigin = await listen(host), gameplayUrl = `${gameplayOrigin}/${input.entrypoint.split('/').map(encodeURIComponent).join('/')}`;
    control = createServer((req, res) => { void (async () => {
      if (!session || req.url !== '/control' || req.method !== 'POST' || req.headers.origin !== undefined) { reply(res, 403, { error: { code: 'environment_control_refused' } }); return; }
      const auth = req.headers.authorization ?? '', expected = `Bearer ${session.receipt.token}`;
      const suppliedBytes = Buffer.from(auth), expectedBytes = Buffer.from(expected);
      if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) { reply(res, 403, { error: { code: 'environment_control_refused' } }); return; }
      const body = z.discriminatedUnion('operation', [z.strictObject({ operation: z.literal('inspect') }), z.strictObject({ operation: z.literal('stop') }), z.strictObject({ operation: z.literal('act'), action: actionSchema })]).parse(await requestBody(req));
      const current = session;
      const result = await serialized(current, async () => body.operation === 'stop' ? stop(current, 'stopped', true) : body.operation === 'inspect' ? observe(current) : act(current, body.action));
      reply(res, 200, result);
    })().catch(error => reply(res, 400, diagnostic(error))); });
    control.requestTimeout = 10000; control.headersTimeout = 10000; const controlOrigin = await listen(control);
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless: input.audience === 'agent', executablePath: executable, timeout: 30000 });
    signal?.throwIfAborted();
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block', acceptDownloads: false });
    // Chromium additionally gates cross-origin loopback sockets. Routing still admits
    // only exact declared origins after this page-scoped browser permission.
    if (input.network.mode === 'networked') await context.grantPermissions(['local-network-access'], { origin: gameplayOrigin });
    const page = await context.newPage();
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    const allowed = (value: string) => { try { const url = new URL(value), mapped = url.protocol === 'ws:' ? `http://${url.host}` : url.protocol === 'wss:' ? `https://${url.host}` : url.origin; return mapped !== controlOrigin && (mapped === gameplayOrigin || input.network.mode === 'networked' && input.network.allowed_origins.includes(mapped)); } catch { return false; } };
    let navigationRefused = false;
    context.on('page', popup => { if (popup !== page) void popup.close().catch(() => {}); });
    page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url() !== gameplayUrl) { navigationRefused = true; void page.close().catch(() => {}); } });
    await context.route('**/*', async route => {
      const request = route.request();
      if (!allowed(request.url()) || request.isNavigationRequest() && (request.frame() !== page.mainFrame() || request.url() !== gameplayUrl)) { await route.abort('blockedbyclient'); return; }
      try {
        // Fetch no redirect hops: refuse an unlisted Location before the browser follows it.
        const response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
        const location = response.headers()['location'];
        if (location && !allowed(new URL(location, request.url()).href)) { await route.abort('blockedbyclient'); return; }
        await route.fulfill({ response });
      } catch { await route.abort('failed').catch(() => {}); }
    });
    await context.routeWebSocket('**/*', socket => { if (allowed(socket.url())) socket.connectToServer(); else socket.close(); });
    const receipt: Receipt = { session_path: join(destination, 'session.json'), session_id: randomUUID(), checkpoint_id: manifest.checkpoint_id,
      gameplay_url: gameplayUrl, audience: input.audience, network: input.network, working_directory: working,
      runtime: { provider: 'playwright-chromium', playwright_version: '1.64.0', browser_version: browser.version(), executable, sha256 },
      guarantees: ['Captured files copied to a fresh workspace', 'Fresh nonpersistent browser context', 'Declared HTTP and WebSocket origin policy', 'Only owned browser and server handles are closed'],
      limitations: ['Browser provider only; native games unsupported', 'No OS network sandbox; WebRTC, DNS and browser background traffic outside verified policy', 'No process-memory checkpoint or gameplay-quality verdict', 'Caller-supplied session metadata is not authenticated provenance', 'Action journal retains latest 1000 attempts'],
      control_url: `${controlOrigin}/control`, token: randomBytes(32).toString('hex'), status: 'running', expires_at: new Date(Date.now() + input.lifetime_seconds * 1000).toISOString() };
    session = { receipt, browser, context, page, host, control, queue: Promise.resolve(), journal: [], destinationIdentity, metadata: new Map(), stopping: false };
    await writeOwned(session, 'session.json', receipt, true); await writeOwned(session, 'actions.json', [], true);
    session.observation = { session_path: receipt.session_path, session_id: receipt.session_id, checkpoint_id: receipt.checkpoint_id, status: 'running', url: gameplayUrl, visible_text: '', screenshot_png_base64: '' };
    await writeOwned(session, 'observation.json', session.observation, true);
    const navigation = await page.goto(gameplayUrl, { waitUntil: 'load', timeout: 20000 });
    if (!navigation || navigation.status() !== 200) fail('environment_start_failed', 'Captured HTML entrypoint could not be served');
    signal?.throwIfAborted(); await observe(session);
    sessions.set(receipt.session_id, session);
    const current = session;
    const closedByPlayer = () => { if (!current.stopping && current.receipt.status === 'running') void serialized(current, () => stop(current, navigationRefused ? 'failed' : 'stopped')).catch(() => {}); };
    page.on('close', closedByPlayer); browser.on('disconnected', closedByPlayer);
    session.timer = setTimeout(() => { if (session) void serialized(session, () => stop(session!)).catch(() => {}); }, Math.max(0, Date.parse(receipt.expires_at) - Date.now()));
    const { control_url, token, status, expires_at, ...publicReceipt } = receipt;
    return startEnvironmentOutput.parse(publicReceipt);
  } catch (error) {
    if (session) { await stop(session, 'failed').catch(() => {}); }
    else {
      await context?.close().catch(() => {}); await browser?.close().catch(() => {}); if (host) await closeServer(host).catch(() => {}); if (control) await closeServer(control).catch(() => {});
      const current = await guard(destination, true);
      if (current.dev === destinationIdentity.dev && current.ino === destinationIdentity.ino) {
        const handle = await open(join(destination, 'failure.json'), 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ status: 'failed', owned_resources_closed: !browser?.isConnected() && !host?.listening && !control?.listening, error: diagnostic(error) })); } finally { await handle.close(); }
      }
    }
    if (error instanceof StudyError || error instanceof z.ZodError || signal?.aborted) throw error;
    fail('environment_start_failed', 'Owned browser environment failed to start');
  }
}
export function startGameplayEnvironment(raw: unknown, signal?: AbortSignal) {
  if (closing) return Promise.reject(new StudyError('environment_closing', 'Owned gameplay environments are shutting down'));
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const result = startOwnedGameplayEnvironment(raw, combined);
  pendingStarts.set(controller, result);
  void result.then(() => pendingStarts.delete(controller), () => pendingStarts.delete(controller));
  return result;
}
async function receiptAt(path: string) {
  const full = resolve(absolute.parse(path));
  let raw: unknown; try { raw = JSON.parse((await readRegular(full, 512 * 1024)).toString('utf8')); } catch (error) { if (error instanceof StudyError) throw error; fail('environment_session_invalid', 'Cannot read the selected session receipt'); }
  const parsed = receiptSchema.safeParse(raw); if (!parsed.success) fail('environment_session_invalid', 'Selected session receipt is invalid');
  const receipt = parsed.data;
  if (resolve(receipt.session_path) !== full || resolve(receipt.working_directory) !== join(dirname(full), 'game')) fail('environment_session_invalid', 'Session receipt paths do not match its selected directory');
  return receipt;
}
async function rpc(receipt: Receipt, operation: string, action?: Action) {
  const response = await fetch(receipt.control_url, { method: 'POST', headers: { authorization: `Bearer ${receipt.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ operation, ...(action ? { action } : {}) }), signal: AbortSignal.timeout(30000), redirect: 'error' });
  const reader = response.body?.getReader(); if (!reader) fail('environment_control_failed', 'Control response has no body');
  const chunks: Uint8Array[] = []; let count = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; count += next.value.length; if (count > 12 * 1024 ** 2) fail('environment_limit', 'Control response exceeds its limit'); chunks.push(next.value); } } finally { await reader.cancel(); }
  const output = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: { code: string; message?: string } };
  if (!response.ok) throw new StudyError(output.error?.code ?? 'environment_control_failed', output.error?.message ?? 'Gameplay control request failed');
  return output;
}
export async function inspectGameplayEnvironment(raw: unknown) {
  const input = inspectEnvironmentInput.parse(raw), receipt = await receiptAt(input.session_path);
  if (receipt.status !== 'running') { const observation = inspectEnvironmentOutput.parse(JSON.parse((await readRegular(join(dirname(receipt.session_path), 'observation.json'), 12 * 1024 ** 2)).toString('utf8'))); if (observation.session_id !== receipt.session_id || observation.checkpoint_id !== receipt.checkpoint_id) fail('environment_session_invalid', 'Retained observation identity differs'); return observation; }
  return inspectEnvironmentOutput.parse(await rpc(receipt, 'inspect'));
}
export async function actInGameplayEnvironment(raw: unknown) { const input = actEnvironmentInput.parse(raw), receipt = await receiptAt(input.session_path); if (receipt.status !== 'running') fail('environment_stopped', 'Gameplay session is no longer running'); return actEnvironmentOutput.parse(await rpc(receipt, 'act', input.action)); }
export async function stopGameplayEnvironment(raw: unknown) { const input = stopEnvironmentInput.parse(raw), receipt = await receiptAt(input.session_path); if (receipt.status !== 'running') return stopEnvironmentOutput.parse({ session_path: receipt.session_path, session_id: receipt.session_id, checkpoint_id: receipt.checkpoint_id, status: 'stopped' }); return stopEnvironmentOutput.parse(await rpc(receipt, 'stop')); }
export async function closeAllGameplayEnvironments() {
  closing = true;
  try {
    const pending = [...pendingStarts]; for (const [controller] of pending) controller.abort();
    await Promise.allSettled(pending.map(([, promise]) => promise));
    const results = await Promise.allSettled([...sessions.values()].map(session => serialized(session, () => stop(session))));
    const failure = results.find(result => result.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason;
  } finally { closing = false; }
}
