// The parent owns this private stdio channel. MCP requests never supply commands.
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeFileDigest } from '../../dist/nativeGameplayEnvironment.js';
import { StudyError } from '../../dist/errors.js';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'session_worker.py');
const failure = (code, message) => new StudyError(code, message);
export async function createBoothWorker({ python, diagnostics_directory }) {
  const [pythonHash, sourceHash] = await Promise.all([nativeFileDigest(python), nativeFileDigest(SOURCE)]);
  const child = spawn(python, ['-I', SOURCE], { shell: false, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], cwd: resolve(diagnostics_directory) });
  let sequence = 0, pending, exited = false, uncertain = false, closed = false;
  let buffer = Buffer.alloc(0), stderr = Buffer.alloc(0), exit, corrupt = false;
  child.once('exit', (code, signal) => { exited = true; exit = { code, signal }; });
  const exitPromise = new Promise(done => { child.once('close', (code, signal) => {
    exited = true; exit = { code, signal }; pending?.reject(failure('booth_worker_exited', 'Owned Booth worker exited during a request')); done(exit);
  }); child.once('error', error => { uncertain = true; exited = true; exit = { error: error.message }; pending?.reject(failure('booth_worker_failed', error.message)); done(exit); }); });
  child.stderr.on('data', chunk => { stderr = Buffer.concat([stderr, chunk]).subarray(0, 65536); });
  child.stdout.on('data', chunk => {
    if (corrupt) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 12 * 1024 ** 2) { corrupt = true; buffer = Buffer.alloc(0); uncertain = true; pending?.reject(failure('booth_worker_limit', 'Worker response exceeded its bound')); return; }
    while (buffer.includes(10)) {
      const end = buffer.indexOf(10), line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        if (!pending || value.seq !== pending.seq || typeof value.ok !== 'boolean' ||
            line.length > (pending.op === 'inspect' ? 12 * 1024 ** 2 : 65536)) throw new Error('Unexpected worker reply');
        const request = pending; pending = undefined;
        if (value.ok) request.resolve(value.result);
        else request.reject(failure(value.error?.code ?? 'booth_worker_refused', String(value.error?.message ?? 'Worker refused operation').slice(0, 4096)));
      } catch (error) { corrupt = true; buffer = Buffer.alloc(0); uncertain = true; pending?.reject(failure('booth_worker_protocol', error.message)); return; }
    }
  });
  if (await nativeFileDigest(python) !== pythonHash || await nativeFileDigest(SOURCE) !== sourceHash) {
    child.stdin.end(); throw failure('booth_worker_changed', 'Worker source or interpreter changed during startup');
  }
  return {
    identity: { pid: child.pid, python: { path: python, sha256: pythonHash }, source: { path: SOURCE, sha256: sourceHash } },
    async request(op, fields = {}, timeout = 30000) {
      if (exited || closed || uncertain || pending) throw failure('booth_worker_unavailable', 'Worker is closed, busy, or requires reconciliation');
      const seq = ++sequence, body = JSON.stringify({ ...fields, seq, op });
      if (Buffer.byteLength(body) > 4096) throw failure('booth_worker_limit', 'Worker request exceeded 4 KiB');
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          pending = { seq, op, resolve, reject };
          timer = setTimeout(() => { uncertain = true; reject(failure('booth_worker_uncertain', 'Worker deadline expired; retained owned worker for reconciliation')); }, timeout);
          child.stdin.write(body + '\n', error => { if (error) { uncertain = true; reject(failure('booth_worker_write_failed', error.message)); } });
        });
      } finally { clearTimeout(timer); }
    },
    async close() {
      if (closed) return { exited, uncertain, exit };
      closed = true; child.stdin.end();
      let timer;
      const deadline = new Promise(done => { timer = setTimeout(() => done({ exited: false }), 30000); });
      const outcome = await Promise.race([exitPromise.then(exit => ({ exited: true, exit })), deadline]).finally(() => clearTimeout(timer));
      return { ...outcome, uncertain, stderr: stderr.toString('utf8') };
    },
    status: () => ({ exited, uncertain, pending: pending?.op, exit, stderr: stderr.toString('utf8') })
  };
}
