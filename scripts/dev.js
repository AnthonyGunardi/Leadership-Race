import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';

const isWindows = process.platform === 'win32';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnvPath = path.resolve(__dirname, '../backend/.env');

if (fs.existsSync(backendEnvPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(backendEnvPath);
  } catch {
    // Gracefully ignore load errors
  }
}

/**
 * Starts a workspace dev server and streams styled prefixed logs to stdout/stderr.
 *
 * @param {string} workspace - Workspace name ('backend' or 'frontend')
 * @param {'cyan' | 'magenta'} color - Color used for log prefix
 * @returns {import('node:child_process').ChildProcess} The spawned child process
 */
function startWorkspace(workspace, color) {
  const prefix = styleText(color, `[${workspace}]`);
  const command = `npm run dev --workspace ${workspace}`;
  const child = spawn(command, {
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  const forward = (stream, isError) => {
    if (!stream) return;
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => {
      const target = isError ? process.stderr : process.stdout;
      target.write(`${prefix} ${line}\n`);
    });
  };

  forward(child.stdout, false);
  forward(child.stderr, true);

  return child;
}

const backend = startWorkspace('backend', 'cyan');
const frontend = startWorkspace('frontend', 'magenta');

let isShuttingDown = false;

/**
 * Gracefully shuts down all spawned processes and exits.
 *
 * @param {number} exitCode - Process exit code
 */
function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const terminate = (child) => {
    if (!child || !child.pid) return;
    if (isWindows) {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // Process might already be closed
      }
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process might already be closed
      }
    }
  };

  terminate(backend);
  terminate(frontend);
  process.exit(exitCode);
}

backend.on('exit', (code, signal) => {
  if (!isShuttingDown && code !== 0 && code !== null) {
    process.stderr.write(`\n[backend] process exited with code ${code || signal}\n`);
    shutdown(code || 1);
  }
});

frontend.on('exit', (code, signal) => {
  if (!isShuttingDown && code !== 0 && code !== null) {
    process.stderr.write(`\n[frontend] process exited with code ${code || signal}\n`);
    shutdown(code || 1);
  }
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
