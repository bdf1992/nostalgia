import { randomUUID } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFileCheckpoint } from '../dist/fileCheckpoint.js';
import { startGameplayEnvironment, closeAllGameplayEnvironments } from '../dist/gameplayEnvironment.js';

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await closeAllGameplayEnvironments(); process.exit(0); }
  catch (error) { console.error(error.message); process.exit(1); }
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length > 1 || args.length === 1 && args[0] !== '--user') throw new Error('Use play-fixture.mjs [--user]');
const state = join(root, 'state');
// Admit the existing parent before creating any retained fixture run.
let current = parse(root).root;
for (const part of ['', ...relative(current, root).split(sep).filter(Boolean)]) {
  if (part) current = join(current, part);
  const identity = await lstat(current);
  if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error('Fixture run requires real directory ancestors');
}
try { await mkdir(state); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const stateIdentity = await lstat(state);
if (!stateIdentity.isDirectory() || stateIdentity.isSymbolicLink()) throw new Error('Fixture state must be a real directory');
const run = join(state, `gameplay-${randomUUID()}`);
await mkdir(run);
const checkpoint = join(run, 'baseline');
await createFileCheckpoint({ files: [{ source: join(root, 'evals/gameplay-fixture/index.html'), path: 'index.html' }], destination: checkpoint });
const environment = await startGameplayEnvironment({ checkpoint, destination: join(run, 'session'), audience: args.includes('--user') ? 'user' : 'agent' });
console.log(JSON.stringify(environment));
// The owned browser and loopback hosts keep this launcher alive until stopped.
