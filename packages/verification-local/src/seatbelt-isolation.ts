import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  CanonicalJsonSha256DigestProvider,
  LocalCommandDiagnosticCode,
  LocalCommandTerminationKind,
  type Sha256Digest,
  type VerificationIsolationPort,
  type VerificationIsolationRequest,
} from '@codeclosure/runtime';

import { DarwinSeatbeltIsolationError, VerificationLocalFailureCode } from './errors.js';

export const DARWIN_SEATBELT_PROFILE_ID = 'codeclosure.darwin-seatbelt.local-command';
export const DARWIN_SEATBELT_PROFILE_VERSION = '1';
const environmentLauncherPath = '/usr/bin/env';

export interface DarwinSeatbeltIsolationOptions {
  readonly runRootBase: string;
  readonly credentialRoots?: readonly string[];
  readonly sandboxExecutablePath?: string;
  readonly platform?: NodeJS.Platform;
}

const profileDigestProvider = new CanonicalJsonSha256DigestProvider();

export function darwinSeatbeltProfileDigest(): Sha256Digest {
  return profileDigestProvider.digest({
    schemaVersion: 1,
    id: DARWIN_SEATBELT_PROFILE_ID,
    version: DARWIN_SEATBELT_PROFILE_VERSION,
    default: 'DENY',
    candidateAccess: 'READ_ONLY',
    runRootAccess: 'READ_WRITE',
    authorityAccess: 'NONE',
    credentialAccess: 'NONE',
    networkAccess: 'DISABLED',
    processLaunch: 'EXACT_EXECUTABLE_ONLY',
    environmentLauncher: environmentLauncherPath,
  });
}

function sameOrWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function exactDirectory(path: string, field: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || path !== path.normalize('NFC')) {
    throw new DarwinSeatbeltIsolationError(
      VerificationLocalFailureCode.RUN_ROOT_INVALID,
      `${field} must be an absolute normalized path without aliases`,
    );
  }
  if (!existsSync(path)) {
    mkdirSync(path, { mode: 0o700 });
  }
  chmodSync(path, 0o700);
  const stat = lstatSync(path);
  const real = realpathSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || real !== path) {
    throw new DarwinSeatbeltIsolationError(
      VerificationLocalFailureCode.RUN_ROOT_INVALID,
      `${field} must be one exact real directory`,
    );
  }
  return real;
}

function seatbeltString(value: string): string {
  if (value.includes('\u0000') || /[\r\n]/u.test(value)) {
    throw new DarwinSeatbeltIsolationError(
      VerificationLocalFailureCode.REQUEST_INVALID,
      'Seatbelt path contains a control character',
    );
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function seatbeltProfile(
  request: VerificationIsolationRequest,
  runRoot: string,
  forbiddenRoots: readonly string[],
): string {
  const clauses = [
    '(version 1)',
    '(deny default)',
    '(allow signal (target self))',
    `(allow process-exec (literal ${seatbeltString(request.executablePath)}))`,
    `(allow process-exec (literal ${seatbeltString(environmentLauncherPath)}))`,
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow file-read*)',
    ...forbiddenRoots.map((root) => `(deny file-read* (subpath ${seatbeltString(root)}))`),
    `(allow file-write* (subpath ${seatbeltString(runRoot)}))`,
  ];
  return clauses.join('\n');
}

function assertSeatbeltOperational(sandboxExecutablePath: string, runRootBase: string): void {
  const probeRoot = realpathSync(mkdtempSync(join(runRootBase, 'seatbelt-probe-')));
  const candidateRoot = join(probeRoot, 'candidate');
  const outputRoot = join(probeRoot, 'output');
  mkdirSync(candidateRoot, { mode: 0o700 });
  mkdirSync(outputRoot, { mode: 0o700 });
  try {
    const executablePath = realpathSync('/usr/bin/true');
    const environmentLauncher = realpathSync(environmentLauncherPath);
    const profile = seatbeltProfile(
      {
        schemaVersion: 1,
        executablePath,
        argv: Object.freeze([]),
        cwd: candidateRoot,
        environment: Object.freeze({}),
        candidateRoot,
        forbiddenRoots: Object.freeze([]),
        isolationProfileId: DARWIN_SEATBELT_PROFILE_ID,
        isolationProfileDigest: darwinSeatbeltProfileDigest(),
        timeoutMilliseconds: 2_000,
        terminationGraceMilliseconds: 100,
        stdoutLimitBytes: 1,
        stderrLimitBytes: 1,
        totalOutputLimitBytes: 2,
        payloadRetentionLimitBytes: 2,
      },
      outputRoot,
      Object.freeze([]),
    );
    const probe = spawnSync(
      sandboxExecutablePath,
      ['-p', profile, environmentLauncher, '-i', executablePath],
      {
        cwd: candidateRoot,
        env: {},
        shell: false,
        stdio: 'ignore',
        timeout: 2_000,
      },
    );
    if (probe.error !== undefined || probe.signal !== null || probe.status !== 0) {
      throw new DarwinSeatbeltIsolationError(
        VerificationLocalFailureCode.ISOLATION_UNAVAILABLE,
        'The selected Seatbelt profile cannot be enforced in this process environment',
      );
    }
  } finally {
    rmSync(probeRoot, { force: true, recursive: true });
  }
}

interface CapturedStream {
  observed: number;
  readonly chunks: Buffer[];
  retained: number;
}

function retainedBytes(stream: CapturedStream): Uint8Array {
  return new Uint8Array(Buffer.concat(stream.chunks, stream.retained));
}

export function createDarwinSeatbeltIsolation(
  options: DarwinSeatbeltIsolationOptions,
): VerificationIsolationPort {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    throw new DarwinSeatbeltIsolationError(
      VerificationLocalFailureCode.UNSUPPORTED_PLATFORM,
      'The selected verification isolation profile requires Darwin',
    );
  }
  const sandboxExecutablePath = options.sandboxExecutablePath ?? '/usr/bin/sandbox-exec';
  if (
    !existsSync(sandboxExecutablePath) ||
    realpathSync(sandboxExecutablePath) !== sandboxExecutablePath
  ) {
    throw new DarwinSeatbeltIsolationError(
      VerificationLocalFailureCode.ISOLATION_UNAVAILABLE,
      'The exact sandbox-exec executable is unavailable',
    );
  }
  const runRootBase = exactDirectory(options.runRootBase, 'Verification run-root base');
  const credentialRoots = Object.freeze(
    (options.credentialRoots ?? []).map((path) => realpathSync(path)).sort(),
  );
  if (new Set(credentialRoots).size !== credentialRoots.length) {
    throw new DarwinSeatbeltIsolationError(
      VerificationLocalFailureCode.REQUEST_INVALID,
      'Configured credential roots must be unique',
    );
  }
  assertSeatbeltOperational(sandboxExecutablePath, runRootBase);

  return Object.freeze({
    async run(rawRequest: VerificationIsolationRequest): Promise<unknown> {
      const request = rawRequest;
      if (
        request.isolationProfileId !== DARWIN_SEATBELT_PROFILE_ID ||
        request.isolationProfileDigest !== darwinSeatbeltProfileDigest()
      ) {
        throw new DarwinSeatbeltIsolationError(
          VerificationLocalFailureCode.ISOLATION_PROFILE_MISMATCH,
          'Verification request does not bind the selected Seatbelt profile',
        );
      }
      const candidateRoot = realpathSync(request.candidateRoot);
      const cwd = realpathSync(request.cwd);
      if (!sameOrWithin(cwd, candidateRoot) || sameOrWithin(runRootBase, candidateRoot)) {
        throw new DarwinSeatbeltIsolationError(
          VerificationLocalFailureCode.CWD_CONTAINMENT_FAILED,
          'Verification cwd or run root is not contained by the selected authority',
        );
      }
      const forbiddenRoots = Object.freeze(
        [
          ...new Set([
            ...request.forbiddenRoots.map((path) => realpathSync(path)),
            ...credentialRoots,
          ]),
        ].sort(),
      );
      for (const realForbidden of forbiddenRoots) {
        if (
          sameOrWithin(candidateRoot, realForbidden) ||
          sameOrWithin(runRootBase, realForbidden)
        ) {
          throw new DarwinSeatbeltIsolationError(
            VerificationLocalFailureCode.REQUEST_INVALID,
            'An allowed verification root overlaps a forbidden root',
          );
        }
      }

      const runRoot = realpathSync(mkdtempSync(join(runRootBase, 'verification-')));
      if (!sameOrWithin(runRoot, runRootBase) || runRoot === runRootBase) {
        throw new DarwinSeatbeltIsolationError(
          VerificationLocalFailureCode.RUN_ROOT_INVALID,
          'Verification run root escaped its exact owned base',
        );
      }
      const stdout: CapturedStream = { observed: 0, chunks: [], retained: 0 };
      const stderr: CapturedStream = { observed: 0, chunks: [], retained: 0 };
      let retainedTotal = 0;
      const outcome = {
        outputExceeded: false,
        timedOut: false,
        childSignal: null as NodeJS.Signals | null,
        childExitCode: null as number | null,
        spawnFailed: false,
      };
      let terminationTimer: NodeJS.Timeout | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;

      try {
        const profile = seatbeltProfile(request, runRoot, forbiddenRoots);
        const environmentAssignments = Object.entries(request.environment).map(
          ([name, value]) => `${name}=${value}`,
        );
        const child = spawn(
          sandboxExecutablePath,
          [
            '-p',
            profile,
            environmentLauncherPath,
            '-i',
            ...environmentAssignments,
            request.executablePath,
            ...request.argv,
          ],
          {
            cwd,
            env: {},
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const terminate = (): void => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            terminationTimer ??= setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
              }
            }, request.terminationGraceMilliseconds);
          }
        };
        const capture = (stream: CapturedStream, chunk: Buffer, streamLimit: number): void => {
          stream.observed += chunk.byteLength;
          const streamCapacity = Math.max(0, streamLimit - stream.retained);
          const totalCapacity = Math.max(0, request.totalOutputLimitBytes - retainedTotal);
          const retentionCapacity = Math.max(0, request.payloadRetentionLimitBytes - retainedTotal);
          const retainedLength = Math.min(
            chunk.byteLength,
            streamCapacity,
            totalCapacity,
            retentionCapacity,
          );
          if (retainedLength > 0) {
            stream.chunks.push(Buffer.from(chunk.subarray(0, retainedLength)));
            stream.retained += retainedLength;
            retainedTotal += retainedLength;
          }
          if (retainedLength < chunk.byteLength) {
            outcome.outputExceeded = true;
            terminate();
          }
        };
        child.stdout.on('data', (chunk: Buffer) => {
          capture(stdout, chunk, request.stdoutLimitBytes);
        });
        child.stderr.on('data', (chunk: Buffer) => {
          capture(stderr, chunk, request.stderrLimitBytes);
        });
        timeoutTimer = setTimeout(() => {
          outcome.timedOut = true;
          terminate();
        }, request.timeoutMilliseconds);

        await new Promise<void>((resolvePromise) => {
          let settled = false;
          const settle = (): void => {
            if (!settled) {
              settled = true;
              resolvePromise();
            }
          };
          child.once('error', () => {
            outcome.spawnFailed = true;
            settle();
          });
          child.once('close', (code, signal) => {
            outcome.childExitCode = code;
            outcome.childSignal = signal;
            settle();
          });
        });
      } finally {
        if (timeoutTimer !== undefined) {
          clearTimeout(timeoutTimer);
        }
        if (terminationTimer !== undefined) {
          clearTimeout(terminationTimer);
        }
        rmSync(runRoot, { force: true, recursive: true });
      }

      const stdoutBytes = retainedBytes(stdout);
      const stderrBytes = retainedBytes(stderr);
      if (outcome.spawnFailed) {
        return Object.freeze({
          schemaVersion: 1,
          kind: 'LOCAL_COMMAND_OBSERVATION_V1',
          terminationKind: LocalCommandTerminationKind.SPAWN_FAILED,
          stdoutBytes,
          stdoutObservedByteCount: stdout.observed,
          stdoutTruncated: stdout.observed > stdout.retained,
          stderrBytes,
          stderrObservedByteCount: stderr.observed,
          stderrTruncated: stderr.observed > stderr.retained,
          diagnosticCode: LocalCommandDiagnosticCode.PROCESS_SPAWN_FAILED,
        });
      }
      if (outcome.timedOut) {
        return Object.freeze({
          schemaVersion: 1,
          kind: 'LOCAL_COMMAND_OBSERVATION_V1',
          terminationKind: LocalCommandTerminationKind.TIMED_OUT,
          stdoutBytes,
          stdoutObservedByteCount: stdout.observed,
          stdoutTruncated: stdout.observed > stdout.retained,
          stderrBytes,
          stderrObservedByteCount: stderr.observed,
          stderrTruncated: stderr.observed > stderr.retained,
          diagnosticCode: outcome.outputExceeded
            ? LocalCommandDiagnosticCode.OUTPUT_LIMIT_EXCEEDED
            : LocalCommandDiagnosticCode.PROCESS_TIMED_OUT,
        });
      }
      if (outcome.childExitCode !== null) {
        return Object.freeze({
          schemaVersion: 1,
          kind: 'LOCAL_COMMAND_OBSERVATION_V1',
          terminationKind: LocalCommandTerminationKind.EXITED,
          exitCode: outcome.childExitCode,
          stdoutBytes,
          stdoutObservedByteCount: stdout.observed,
          stdoutTruncated: stdout.observed > stdout.retained,
          stderrBytes,
          stderrObservedByteCount: stderr.observed,
          stderrTruncated: stderr.observed > stderr.retained,
          diagnosticCode: outcome.outputExceeded
            ? LocalCommandDiagnosticCode.OUTPUT_LIMIT_EXCEEDED
            : LocalCommandDiagnosticCode.NONE,
        });
      }
      return Object.freeze({
        schemaVersion: 1,
        kind: 'LOCAL_COMMAND_OBSERVATION_V1',
        terminationKind: LocalCommandTerminationKind.SIGNALED,
        signal: outcome.childSignal ?? 'UNKNOWN',
        stdoutBytes,
        stdoutObservedByteCount: stdout.observed,
        stdoutTruncated: stdout.observed > stdout.retained,
        stderrBytes,
        stderrObservedByteCount: stderr.observed,
        stderrTruncated: stderr.observed > stderr.retained,
        diagnosticCode: outcome.outputExceeded
          ? LocalCommandDiagnosticCode.OUTPUT_LIMIT_EXCEEDED
          : LocalCommandDiagnosticCode.PROCESS_SIGNALED,
      });
    },
  });
}
