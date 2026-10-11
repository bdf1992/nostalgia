import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { readNativeFile } from '../dist/nativeGameplayEnvironment.js';

export const BOOTH_HOST_USAGE = 'Usage: node scripts/native-booth-host.mjs --config <absolute-private-json> --destination <absolute-fresh-state>\nSend close on stdin, or SIGINT/SIGTERM, to close owned sessions and the host.\n';
export function parseHostArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!['--config', '--destination'].includes(key) || key in values || typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw new Error('Use each required option once with an absolute local path');
    values[key] = value;
  }
  if (Object.keys(values).length !== 2) throw new Error('Both --config and --destination are required');
  return { config: resolve(values['--config']), destination: resolve(values['--destination']) };
}
export async function readHostConfiguration(path) {
  const bytes = await readNativeFile(path, 65536);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')); }
  catch { throw new Error('Private host configuration is not valid UTF-8 JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Private host configuration must be a JSON object');
  return value;
}

/** The entry point delegates every launch and cleanup decision to the existing factory. */
export async function runNativeBoothHost(argv, deps = {}) {
  const args = parseHostArguments(argv), stdout = deps.stdout ?? process.stdout;
  if (args.help) { stdout.write(BOOTH_HOST_USAGE); return { help: true }; }
  const configuration = await readHostConfiguration(args.config);
  const owner = deps.process ?? process, stdin = deps.stdin ?? process.stdin, stderr = deps.stderr ?? process.stderr;
  const bridgeFactory = deps.bridgeFactory ?? (await import('./native-booth-bridge.mjs')).createNativeBoothBridge;
  const bridge = await bridgeFactory({ destination: args.destination, configuration, runtime: { platform: owner.platform, appdata: owner.env.APPDATA } });
  let pending, closed = false, publicationFailed = false;
  const reader = createInterface({ input: stdin, terminal: false });
  function report(error) { try { stderr.write(JSON.stringify({ error: { code: error.code ?? 'native_host_close_failed', message: String(error.message ?? error).slice(0, 2048) }, recovery: 'Host retained; retry close on stdin or send SIGINT/SIGTERM after resolving cleanup evidence' }) + '\n'); } catch { /* Diagnostic delivery must not prevent owned cleanup or its supported retry. */ } }
  function detach() { owner.off('SIGINT', signal); owner.off('SIGTERM', signal); reader.off('line', line); reader.off('close', eof); reader.close(); stdin.pause?.(); }
  function requestClose() {
    if (closed) return Promise.resolve({ status: 'closed' });
    if (pending) return pending;
    pending = Promise.resolve().then(() => bridge.close()).then(result => { if (result?.status !== 'closed') throw new Error('Factory did not confirm host closure'); closed = true; detach(); return result; }).catch(error => { report(error); return { status: 'cleanup-incomplete' }; }).finally(() => { pending = undefined; });
    return pending;
  }
  const signal = () => { void requestClose(); }, eof = () => { void requestClose(); };
  const line = value => { if (value.trim() === 'close') void requestClose(); else stderr.write('Only the close command is accepted on host stdin\n'); };
  function publicationError(error) { if (publicationFailed) return; publicationFailed = true; report(error); void requestClose(); }
  owner.on('SIGINT', signal); owner.on('SIGTERM', signal); reader.on('line', line); reader.on('close', eof);
  // Writable errors can arrive after write returns or after its callback. Keep
  // the listener until stream closure so a late EPIPE cannot bypass cleanup.
  stdout.on?.('error', publicationError);
  stdout.once?.('close', () => { stdout.off?.('error', publicationError); });
  try { stdout.write(JSON.stringify({ bridge_path: bridge.bridge_path }) + '\n', error => { if (error) publicationError(error); }); }
  catch (error) { publicationError(error); await requestClose(); }
  return { bridge_path: bridge.bridge_path, close: requestClose, status: () => ({ closed, closing: Boolean(pending) }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNativeBoothHost(process.argv.slice(2)).catch(error => { process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'native_host_start_failed', message: String(error.message ?? error).slice(0, 2048) } }) + '\n'); process.exitCode = 1; });
}
