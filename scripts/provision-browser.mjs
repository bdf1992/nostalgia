import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The pinned project CLI installs its browser without garbage-collecting other
// projects' cached revisions. This setting applies only to this child process.
const cli = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: '1' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
