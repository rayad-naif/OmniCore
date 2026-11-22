// Thin wrapper around the docker CLI (execFile, never a shell).
import { execFile } from 'node:child_process';

export class CommandError extends Error {
  constructor(message, { code, stderr, stdout } = {}) {
    super(message);
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

export function run(cmd, args, { input, timeout = 15 * 60 * 1000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        maxBuffer: 64 * 1024 * 1024,
        timeout,
        env: env ? { ...process.env, ...env } : process.env,
      },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || stdout || err.message)
            .trim()
            .split('\n')
            .slice(-6)
            .join('\n');
          return reject(
            new CommandError(`${cmd} ${args[0]} failed: ${tail}`, {
              code: err.code,
              stderr: String(stderr),
              stdout: String(stdout),
            }),
          );
        }
        resolve(String(stdout));
      },
    );
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

export const docker = (args, opts) => run('docker', args, opts);

export async function exists(kind, name) {
  try {
    await docker([kind, 'inspect', name]);
    return true;
  } catch {
    return false;
  }
}

export async function containerState(name) {
  try {
    const out = await docker(['inspect', '-f', '{{.State.Status}}', name]);
    return out.trim();
  } catch {
    return 'missing';
  }
}
