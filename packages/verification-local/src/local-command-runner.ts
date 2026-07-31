import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  CanonicalJsonSha256DigestProvider,
  decodeCandidateWorkspaceLease,
  decodeLocalCommandVerificationRequest,
  decodeLocalCommandVerificationResult,
  localCommandEnvironmentRecord,
  type CandidateWorkspaceLeaseAuthorityPort,
  type LocalCommandVerificationPort,
  type LocalCommandVerificationRequest,
  type VerificationIsolationPort,
} from '@codeclosure/runtime';

import { LocalCommandRunnerError, VerificationLocalFailureCode } from './errors.js';

export const LOCAL_COMMAND_RUNNER_IDENTITY = 'codeclosure.local-command-runner';
export const LOCAL_COMMAND_RUNNER_VERSION = '1';

export interface LocalCommandVerificationRunnerOptions {
  readonly isolation: VerificationIsolationPort;
  readonly workspaceLeases: CandidateWorkspaceLeaseAuthorityPort;
  readonly runnerIdentity?: string;
  readonly runnerVersion?: string;
}

const digests = new CanonicalJsonSha256DigestProvider();

function sameOrWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function executableDigest(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function assertCurrentWorkspaceLease(
  request: LocalCommandVerificationRequest,
  workspaceLeases: CandidateWorkspaceLeaseAuthorityPort,
): void {
  let currentLease;
  try {
    currentLease = decodeCandidateWorkspaceLease(
      workspaceLeases.assertLeaseCurrent(request.workspaceLease),
    );
  } catch (error) {
    throw new LocalCommandRunnerError(
      VerificationLocalFailureCode.WORKSPACE_LEASE_STALE,
      'Local command workspace lease is no longer current',
      { cause: error },
    );
  }
  if (currentLease.leaseDigest !== request.workspaceLease.leaseDigest) {
    throw new LocalCommandRunnerError(
      VerificationLocalFailureCode.WORKSPACE_LEASE_STALE,
      'Local command workspace lease authority changed identity',
    );
  }
}

export function createLocalCommandVerificationRunner(
  options: LocalCommandVerificationRunnerOptions,
): LocalCommandVerificationPort {
  const runnerIdentity = options.runnerIdentity ?? LOCAL_COMMAND_RUNNER_IDENTITY;
  const runnerVersion = options.runnerVersion ?? LOCAL_COMMAND_RUNNER_VERSION;
  if (runnerIdentity.trim().length === 0 || runnerVersion.trim().length === 0) {
    throw new LocalCommandRunnerError(
      VerificationLocalFailureCode.REQUEST_INVALID,
      'Runner identity and version must not be blank',
    );
  }

  return Object.freeze({
    async run(rawRequest: LocalCommandVerificationRequest): Promise<unknown> {
      let request: LocalCommandVerificationRequest;
      try {
        request = decodeLocalCommandVerificationRequest(rawRequest, digests);
      } catch (error) {
        throw new LocalCommandRunnerError(
          VerificationLocalFailureCode.REQUEST_INVALID,
          'Local command request failed strict decoding',
          { cause: error },
        );
      }
      if (request.runnerIdentity !== runnerIdentity || request.runnerVersion !== runnerVersion) {
        throw new LocalCommandRunnerError(
          VerificationLocalFailureCode.REQUEST_INVALID,
          'Local command request targets another runner identity',
        );
      }
      assertCurrentWorkspaceLease(request, options.workspaceLeases);
      const executable = realpathSync(request.checkSpec.executablePath);
      const executableStat = lstatSync(executable);
      if (
        executable !== request.checkSpec.executablePath ||
        !executableStat.isFile() ||
        executableStat.isSymbolicLink() ||
        executableDigest(executable) !== request.checkSpec.executableDigest
      ) {
        throw new LocalCommandRunnerError(
          VerificationLocalFailureCode.EXECUTABLE_IDENTITY_MISMATCH,
          'Executable identity differs from the exact Check Specification',
        );
      }
      const candidateRoot = realpathSync(request.workspaceLease.root);
      const cwd = realpathSync(resolve(candidateRoot, request.checkSpec.cwd));
      if (candidateRoot !== request.workspaceLease.root || !sameOrWithin(cwd, candidateRoot)) {
        throw new LocalCommandRunnerError(
          VerificationLocalFailureCode.CWD_CONTAINMENT_FAILED,
          'Local command cwd escaped the read-only Candidate lease',
        );
      }
      const rawResult = await options.isolation.run({
        schemaVersion: 1,
        executablePath: executable,
        argv: request.checkSpec.argv,
        cwd,
        environment: localCommandEnvironmentRecord(request.environmentVariables),
        candidateRoot,
        forbiddenRoots: request.workspaceLease.forbiddenRoots,
        isolationProfileId: request.isolationProfileId,
        isolationProfileDigest: request.isolationProfileDigest,
        timeoutMilliseconds: request.checkSpec.timeoutMilliseconds,
        terminationGraceMilliseconds: request.checkSpec.terminationGraceMilliseconds,
        stdoutLimitBytes: request.checkSpec.stdoutLimitBytes,
        stderrLimitBytes: request.checkSpec.stderrLimitBytes,
        totalOutputLimitBytes: request.checkSpec.totalOutputLimitBytes,
        payloadRetentionLimitBytes: request.checkSpec.payloadRetentionLimitBytes,
      });
      assertCurrentWorkspaceLease(request, options.workspaceLeases);
      return decodeLocalCommandVerificationResult(request, rawResult, digests);
    },
  });
}
