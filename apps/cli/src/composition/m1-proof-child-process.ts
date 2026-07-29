import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface M1ProofChildProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface RunningM1ProofChildProcess {
  readonly child: ChildProcessWithoutNullStreams;
  /** Resolves only after the process has exited and all stdio streams close. */
  readonly completion: Promise<M1ProofChildProcessExit>;
  stdout(): string;
  stderr(): string;
  outputError(): TypeError | undefined;
  spawnError(): Error | undefined;
}

export interface CompletedM1ProofChildProcess {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SpawnM1ProofChildProcessOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly maxOutputBytes: number;
}

export interface CompleteM1ProofChildProcessOptions {
  readonly operation: string;
  readonly timeoutMilliseconds: number;
  readonly cleanupTimeoutMilliseconds: number;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  message: string,
): Promise<Value> {
  const boundedMilliseconds = positiveSafeInteger(milliseconds, 'Process timeout');
  return new Promise<Value>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new TypeError(message)), boundedMilliseconds);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(
          error instanceof Error
            ? error
            : new TypeError(`${message}: operation rejected without an Error`, { cause: error }),
        );
      },
    );
  });
}

export function spawnM1ProofChildProcess(
  options: SpawnM1ProofChildProcessOptions,
): RunningM1ProofChildProcess {
  const maxOutputBytes = positiveSafeInteger(options.maxOutputBytes, 'Process output limit');
  const child = spawn(options.executable, [...options.args], {
    cwd: options.cwd,
    env: options.environment,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let stdout = '';
  let stderr = '';
  let retainedOutputBytes = 0;
  let outputError: TypeError | undefined;
  let spawnError: Error | undefined;
  child.once('error', (error) => {
    spawnError = error;
  });
  const completion = new Promise<M1ProofChildProcessExit>((resolve) => {
    child.once('close', (code, signal) => resolve(Object.freeze({ code, signal })));
  });

  const retainOutput = (stream: 'stdout' | 'stderr', chunk: string): void => {
    if (outputError !== undefined) {
      return;
    }
    const chunkBytes = Buffer.byteLength(chunk);
    if (retainedOutputBytes + chunkBytes > maxOutputBytes) {
      outputError = new TypeError(
        `M1 proof child process exceeded its ${String(maxOutputBytes)} byte output limit`,
      );
      child.kill('SIGKILL');
      return;
    }
    retainedOutputBytes += chunkBytes;
    if (stream === 'stdout') {
      stdout += chunk;
    } else {
      stderr += chunk;
    }
  };
  child.stdout.on('data', (chunk: string) => {
    retainOutput('stdout', chunk);
  });
  child.stderr.on('data', (chunk: string) => {
    retainOutput('stderr', chunk);
  });
  child.stdin.end();

  return Object.freeze({
    child,
    completion,
    stdout: () => stdout,
    stderr: () => stderr,
    outputError: () => outputError,
    spawnError: () => spawnError,
  });
}

export function waitForM1ProofChildProcessClose(
  running: RunningM1ProofChildProcess,
  milliseconds: number,
  message: string,
): Promise<M1ProofChildProcessExit> {
  return withTimeout(running.completion, milliseconds, message);
}

export async function stopM1ProofChildProcess(
  running: RunningM1ProofChildProcess | undefined,
  milliseconds: number,
  message: string,
): Promise<void> {
  if (running === undefined) {
    return;
  }
  if (running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill('SIGKILL');
  }
  await waitForM1ProofChildProcessClose(running, milliseconds, message);
}

export async function completeM1ProofChildProcess(
  running: RunningM1ProofChildProcess,
  options: CompleteM1ProofChildProcessOptions,
): Promise<CompletedM1ProofChildProcess> {
  try {
    const completed = await waitForM1ProofChildProcessClose(
      running,
      options.timeoutMilliseconds,
      `${options.operation} timed out`,
    );
    const spawnFailure = running.spawnError();
    if (spawnFailure !== undefined) {
      throw new TypeError(`${options.operation} could not be started`, { cause: spawnFailure });
    }
    const outputFailure = running.outputError();
    if (outputFailure !== undefined) {
      throw outputFailure;
    }
    return Object.freeze({
      status: completed.code,
      signal: completed.signal,
      stdout: running.stdout(),
      stderr: running.stderr(),
    });
  } catch (error) {
    try {
      await stopM1ProofChildProcess(
        running,
        options.cleanupTimeoutMilliseconds,
        `${options.operation} did not stop during cleanup`,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${options.operation} failed and could not be stopped`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
