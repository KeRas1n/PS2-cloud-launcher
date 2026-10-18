import { spawn } from 'node:child_process';
export interface RunOptions {
  cwd?: string;
  timeout?: number;
  onLine?: (line: string) => void;
  maxOutput?: number;
  privateOutput?: boolean;
  privateError?: string;
}
export function run(binary: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      pending = '';
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
      reject(new Error('Operation timed out. Check your connection and try again.'));
    }, options.timeout ?? 120_000);
    const limit = options.maxOutput ?? 32 * 1024 * 1024;
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > limit) {
        failed = true;
        child.kill();
        reject(new Error('Command output exceeds the safety limit.'));
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-8192);
      pending += data.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) options.onLine?.(line);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start ${binary}: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (pending) options.onLine?.(pending);
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            options.privateOutput
              ? (options.privateError ??
                  'Cloud sign-in failed or was cancelled. Check your account and try again.')
              : `${binary.split(/[\\/]/).pop()} exited with code ${code}: ${stderr.replace(/(access_token|refresh_token|client_secret)[^,\n]*/gi, '$1: [redacted]').slice(-1800)}`,
          ),
        );
    });
  });
}
