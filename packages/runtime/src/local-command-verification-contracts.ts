import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  CandidateGenerationState,
  CheckSpecificationKind,
  EvidenceKind,
  EvidenceProducerType,
  LocalCommandDiagnosticCode,
  LocalCommandTerminationKind,
  attemptId,
  decodeCandidateGeneration,
  decodeCheckSpecification,
  decodeProtectedAssetReadLease,
  decodeVerificationObligation,
  goalId,
  goalRevision,
  policyBundleId,
  protectedAssetReadLeaseProjection,
  sha256Digest,
  workflowId,
  workflowVersion,
  type AttemptId,
  type CandidateGeneration,
  type GoalId,
  type GoalRevision,
  type LocalCommandCheckSpecification,
  type ProtectedAssetReadLease,
  type CheckSpecificationId,
  type PolicyBundleId,
  type Sha256Digest,
  type VerificationObligation,
  type WorkflowId,
  type WorkflowVersion,
} from '@codeclosure/domain';
import { z } from 'zod';

import {
  CandidateWorkspaceAccessMode,
  decodeCandidateWorkspaceLease,
  type CandidateWorkspaceLease,
} from './candidate-workspace-contracts.js';
import type { DigestProvider } from './ports.js';

export {
  LocalCommandDiagnosticCode,
  LocalCommandTerminationKind,
  sha256Digest,
} from '@codeclosure/domain';
export type { Sha256Digest } from '@codeclosure/domain';

export interface LocalCommandEnvironmentVariable {
  readonly name: string;
  readonly value: string;
}

export interface CreateLocalCommandCheckSpecificationInput {
  readonly id: CheckSpecificationId;
  readonly version: string;
  readonly producerIdentity: string;
  readonly operation: string;
  readonly runnerIdentity: string;
  readonly runnerVersion: string;
  readonly executablePath: string;
  readonly executableDigest: Sha256Digest;
  readonly declaredToolVersion: string;
  readonly argv: readonly string[];
  readonly workspaceLease: CandidateWorkspaceLease;
  readonly cwd: string;
  readonly environmentVariables: readonly LocalCommandEnvironmentVariable[];
  readonly isolationProfileId: string;
  readonly isolationProfileDigest: Sha256Digest;
  readonly timeoutMilliseconds: number;
  readonly terminationGraceMilliseconds: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  readonly totalOutputLimitBytes: number;
  readonly payloadRetentionLimitBytes: number;
  readonly acceptedExitCodes: readonly number[];
  readonly protectedAssetReadLease?: ProtectedAssetReadLease;
}

interface LocalCommandVerificationRequestBase {
  readonly schemaVersion: 2 | 3;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly attemptId: AttemptId;
  readonly generation: CandidateGeneration;
  readonly workspaceLease: CandidateWorkspaceLease;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly obligation: VerificationObligation;
  readonly runnerIdentity: string;
  readonly runnerVersion: string;
  readonly isolationProfileId: string;
  readonly isolationProfileDigest: Sha256Digest;
  readonly environmentVariables: readonly LocalCommandEnvironmentVariable[];
}

export interface LocalCommandVerificationRequestV2 extends LocalCommandVerificationRequestBase {
  readonly schemaVersion: 2;
  /** Strict decoding rejects schema-version-3 Checks on this compatibility request. */
  readonly checkSpec: LocalCommandCheckSpecification;
}

export interface ProtectedLocalCommandVerificationRequest extends LocalCommandVerificationRequestBase {
  readonly schemaVersion: 3;
  readonly checkSpec: Extract<LocalCommandCheckSpecification, { readonly schemaVersion: 3 }>;
  readonly protectedAssetReadLease: ProtectedAssetReadLease;
}

export type LocalCommandVerificationRequest =
  LocalCommandVerificationRequestV2 | ProtectedLocalCommandVerificationRequest;

export interface LocalCommandVerificationResult {
  readonly schemaVersion: 1;
  readonly kind: 'LOCAL_COMMAND_OBSERVATION_V1';
  readonly terminationKind: LocalCommandTerminationKind;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly stdoutBytes: Uint8Array;
  readonly stdoutObservedByteCount: number;
  readonly stdoutTruncated: boolean;
  readonly stderrBytes: Uint8Array;
  readonly stderrObservedByteCount: number;
  readonly stderrTruncated: boolean;
  readonly diagnosticCode: LocalCommandDiagnosticCode;
}

export interface LocalCommandVerificationPort {
  /** Adapter boundary input is untrusted and MUST be strictly decoded by the runner. */
  run(request: unknown): Promise<unknown>;
}

interface VerificationIsolationRequestBase {
  readonly schemaVersion: 1 | 2;
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly candidateRoot: string;
  readonly forbiddenRoots: readonly string[];
  readonly isolationProfileId: string;
  readonly isolationProfileDigest: Sha256Digest;
  readonly timeoutMilliseconds: number;
  readonly terminationGraceMilliseconds: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  readonly totalOutputLimitBytes: number;
  readonly payloadRetentionLimitBytes: number;
}

export interface VerificationIsolationRequestV1 extends VerificationIsolationRequestBase {
  readonly schemaVersion: 1;
}

export interface ProtectedVerificationIsolationRequest extends VerificationIsolationRequestBase {
  readonly schemaVersion: 2;
  readonly protectedAssetReadLease: ProtectedAssetReadLease;
}

export type VerificationIsolationRequest =
  VerificationIsolationRequestV1 | ProtectedVerificationIsolationRequest;

export interface VerificationIsolationPort {
  run(request: VerificationIsolationRequest): Promise<unknown>;
}

const environmentVariableSchema = z
  .object({
    name: z
      .string()
      .max(256)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
    value: z
      .string()
      .max(65_536)
      .refine(
        (value) => !value.includes('\u0000') && Buffer.byteLength(value, 'utf8') <= 65_536,
        'Environment value is not a bounded process value',
      ),
  })
  .strict();

const localCommandRequestBaseShape = {
  goalId: z.string(),
  goalRevision: z.number().int().positive(),
  workflowId: z.string(),
  workflowVersion: z.number().int().positive(),
  attemptId: z.string(),
  generation: z.unknown(),
  workspaceLease: z.unknown(),
  policyBundleId: z.string(),
  policyBundleDigest: z.string(),
  obligation: z.unknown(),
  checkSpec: z.unknown(),
  runnerIdentity: z.string().min(1),
  runnerVersion: z.string().min(1),
  isolationProfileId: z.string().min(1),
  isolationProfileDigest: z.string(),
  environmentVariables: z.array(environmentVariableSchema).max(1_024),
} as const;

const localCommandRequestV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...localCommandRequestBaseShape,
  })
  .strict();

const localCommandRequestV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    ...localCommandRequestBaseShape,
    protectedAssetReadLease: z.unknown(),
  })
  .strict();

const localCommandRequestSchema = z.discriminatedUnion('schemaVersion', [
  localCommandRequestV2Schema,
  localCommandRequestV3Schema,
]);

function sameOrWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function environmentProjection(variables: readonly LocalCommandEnvironmentVariable[]): unknown {
  return {
    schemaVersion: 1,
    inheritance: 'NONE',
    variables,
  };
}

export function localCommandEnvironmentDigest(
  variables: readonly LocalCommandEnvironmentVariable[],
  digests: DigestProvider,
): Sha256Digest {
  return sha256Digest(digests.digest(environmentProjection(variables)));
}

function protectedAssetReadLeaseDigest(
  lease: ProtectedAssetReadLease,
  digests: DigestProvider,
): Sha256Digest {
  return sha256Digest(digests.digest(protectedAssetReadLeaseProjection(lease)));
}

export function createLocalCommandCheckSpecification(
  input: CreateLocalCommandCheckSpecificationInput & {
    readonly protectedAssetReadLease?: undefined;
  },
  digests: DigestProvider,
): Extract<LocalCommandCheckSpecification, { readonly schemaVersion: 2 }>;
export function createLocalCommandCheckSpecification(
  input: CreateLocalCommandCheckSpecificationInput & {
    readonly protectedAssetReadLease: ProtectedAssetReadLease;
  },
  digests: DigestProvider,
): Extract<LocalCommandCheckSpecification, { readonly schemaVersion: 3 }>;
export function createLocalCommandCheckSpecification(
  input: CreateLocalCommandCheckSpecificationInput,
  digests: DigestProvider,
): LocalCommandCheckSpecification;
export function createLocalCommandCheckSpecification(
  input: CreateLocalCommandCheckSpecificationInput,
  digests: DigestProvider,
): LocalCommandCheckSpecification {
  const lease = decodeCandidateWorkspaceLease(input.workspaceLease);
  if (lease.accessMode !== CandidateWorkspaceAccessMode.READ_ONLY) {
    throw new TypeError('Local command Check requires a read-only Candidate workspace lease');
  }
  const protectedLease =
    input.protectedAssetReadLease === undefined
      ? undefined
      : decodeProtectedAssetReadLease(input.protectedAssetReadLease);
  if (
    protectedLease !== undefined &&
    (protectedLease.checkSpecificationId !== input.id ||
      protectedLease.checkSpecificationVersion !== input.version ||
      protectedLease.goalId !== lease.goalId ||
      protectedLease.goalRevision !== lease.goalRevision ||
      protectedLease.workflowId !== lease.workflowId ||
      protectedLease.candidateGenerationId !== lease.candidateGenerationId ||
      protectedLease.candidateDigest !== lease.candidateDigest ||
      protectedLease.isolationProfileId !== input.isolationProfileId ||
      protectedLease.isolationProfileDigest !== input.isolationProfileDigest ||
      protectedAssetReadLeaseDigest(protectedLease, digests) !== protectedLease.leaseDigest)
  ) {
    throw new TypeError('Protected asset lease does not bind the concrete Check authority');
  }
  const decoded = decodeCheckSpecification({
    schemaVersion: protectedLease === undefined ? 2 : 3,
    id: input.id,
    version: input.version,
    kind: CheckSpecificationKind.LOCAL_COMMAND,
    producerType: EvidenceProducerType.VERIFICATION_RUNNER,
    producerIdentity: input.producerIdentity,
    operation: input.operation,
    cwdIdentity: lease.workspaceRootIdentity,
    inputRefs: [lease.candidateGenerationId],
    environmentPolicy: 'LOCAL_COMMAND_EXPLICIT_V1',
    timeoutMilliseconds: input.timeoutMilliseconds,
    outputLimitBytes: input.totalOutputLimitBytes,
    expectedObservationSchema: 'LOCAL_COMMAND_OBSERVATION_V1',
    cleanupPolicy: 'LOCAL_COMMAND_RUN_ROOT_V1',
    runnerIdentity: input.runnerIdentity,
    runnerVersion: input.runnerVersion,
    executablePath: input.executablePath,
    executableDigest: input.executableDigest,
    declaredToolVersion: input.declaredToolVersion,
    argv: input.argv,
    candidateGenerationId: lease.candidateGenerationId,
    candidateDigest: lease.candidateDigest,
    workspaceLeaseId: lease.id,
    workspaceLeaseDigest: lease.leaseDigest,
    cwd: input.cwd,
    environmentInheritance: 'NONE',
    allowedEnvironmentVariables: input.environmentVariables.map(({ name }) => name),
    environmentDigest: localCommandEnvironmentDigest(input.environmentVariables, digests),
    isolationProfileId: input.isolationProfileId,
    isolationProfileDigest: input.isolationProfileDigest,
    candidateAccess: 'READ_ONLY',
    authorityAccess: 'NONE',
    credentialAccess: 'NONE',
    networkAccess: 'DISABLED',
    terminationGraceMilliseconds: input.terminationGraceMilliseconds,
    stdoutLimitBytes: input.stdoutLimitBytes,
    stderrLimitBytes: input.stderrLimitBytes,
    totalOutputLimitBytes: input.totalOutputLimitBytes,
    payloadRetentionLimitBytes: input.payloadRetentionLimitBytes,
    acceptedExitCodes: input.acceptedExitCodes,
    ...(protectedLease === undefined
      ? {}
      : {
          acceptanceCriticalVerificationPlanId: protectedLease.acceptanceCriticalVerificationPlanId,
          acceptanceCriticalVerificationPlanDigest:
            protectedLease.acceptanceCriticalVerificationPlanDigest,
          protectedAssetManifestDigest: protectedLease.protectedAssetManifestDigest,
          protectedAssetReadLeaseDigest: protectedLease.leaseDigest,
        }),
  });
  if (decoded.kind !== CheckSpecificationKind.LOCAL_COMMAND) {
    throw new TypeError('Local command Check changed kind during construction');
  }
  return decoded;
}

export function decodeLocalCommandVerificationRequest(
  value: unknown,
  digests: DigestProvider,
): LocalCommandVerificationRequest {
  const parsed = localCommandRequestSchema.parse(value);
  const generation = decodeCandidateGeneration(parsed.generation);
  const workspaceLease = decodeCandidateWorkspaceLease(parsed.workspaceLease);
  const obligation = decodeVerificationObligation(parsed.obligation);
  const decodedCheckSpec = decodeCheckSpecification(parsed.checkSpec);
  if (decodedCheckSpec.kind !== CheckSpecificationKind.LOCAL_COMMAND) {
    throw new TypeError('Local command request requires a LOCAL_COMMAND Check Specification');
  }
  const environmentVariables = Object.freeze(
    parsed.environmentVariables.map((entry) => Object.freeze({ ...entry })),
  );
  if (
    (parsed.schemaVersion === 2 && decodedCheckSpec.schemaVersion !== 2) ||
    (parsed.schemaVersion === 3 && decodedCheckSpec.schemaVersion !== 3)
  ) {
    throw new TypeError('Local command request schema does not match its Check Specification');
  }
  const protectedLease =
    parsed.schemaVersion === 3
      ? decodeProtectedAssetReadLease(parsed.protectedAssetReadLease)
      : undefined;
  const commonRequest = {
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    attemptId: attemptId(parsed.attemptId),
    generation,
    workspaceLease,
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    obligation,
    checkSpec: decodedCheckSpec,
    runnerIdentity: parsed.runnerIdentity,
    runnerVersion: parsed.runnerVersion,
    isolationProfileId: parsed.isolationProfileId,
    isolationProfileDigest: sha256Digest(parsed.isolationProfileDigest),
    environmentVariables,
  } as const;
  const request: LocalCommandVerificationRequest =
    parsed.schemaVersion === 3 &&
    decodedCheckSpec.schemaVersion === 3 &&
    protectedLease !== undefined
      ? Object.freeze({
          ...commonRequest,
          schemaVersion: 3 as const,
          checkSpec: decodedCheckSpec,
          protectedAssetReadLease: protectedLease,
        })
      : parsed.schemaVersion === 2 && decodedCheckSpec.schemaVersion === 2
        ? Object.freeze({
            ...commonRequest,
            schemaVersion: 2 as const,
            checkSpec: decodedCheckSpec,
          })
        : (() => {
            throw new TypeError('Local command request is not a supported authority version');
          })();
  const variableNames = environmentVariables.map(({ name }) => name);
  const environmentByteLength = environmentVariables.reduce(
    (total, { name, value }) =>
      total + Buffer.byteLength(name, 'utf8') + 1 + Buffer.byteLength(value, 'utf8') + 1,
    0,
  );
  const cwd = resolve(workspaceLease.root, decodedCheckSpec.cwd);
  if (
    generation.state !== CandidateGenerationState.FROZEN ||
    workspaceLease.accessMode !== CandidateWorkspaceAccessMode.READ_ONLY ||
    workspaceLease.goalId !== request.goalId ||
    workspaceLease.goalRevision !== request.goalRevision ||
    workspaceLease.workflowId !== request.workflowId ||
    workspaceLease.candidateGenerationId !== generation.id ||
    workspaceLease.candidateGenerationVersion !== generation.version ||
    workspaceLease.candidateDigest !== generation.frozenDigest ||
    obligation.goalId !== request.goalId ||
    obligation.goalRevision !== request.goalRevision ||
    obligation.candidateGenerationId !== generation.id ||
    obligation.requiredEvidenceKind !== EvidenceKind.LOCAL_COMMAND_TEST_RESULT ||
    obligation.checkSpecRef !== `${decodedCheckSpec.id}@${decodedCheckSpec.version}` ||
    decodedCheckSpec.candidateGenerationId !== generation.id ||
    decodedCheckSpec.candidateDigest !== generation.frozenDigest ||
    decodedCheckSpec.workspaceLeaseId !== workspaceLease.id ||
    decodedCheckSpec.workspaceLeaseDigest !== workspaceLease.leaseDigest ||
    decodedCheckSpec.cwdIdentity !== workspaceLease.workspaceRootIdentity ||
    decodedCheckSpec.runnerIdentity !== request.runnerIdentity ||
    decodedCheckSpec.runnerVersion !== request.runnerVersion ||
    decodedCheckSpec.isolationProfileId !== request.isolationProfileId ||
    decodedCheckSpec.isolationProfileDigest !== request.isolationProfileDigest ||
    JSON.stringify(variableNames) !==
      JSON.stringify(decodedCheckSpec.allowedEnvironmentVariables) ||
    environmentByteLength > 65_536 ||
    !sameOrWithin(cwd, workspaceLease.root)
  ) {
    throw new TypeError('Local command request contains cross-authority bindings');
  }
  if (
    localCommandEnvironmentDigest(environmentVariables, digests) !==
    decodedCheckSpec.environmentDigest
  ) {
    throw new TypeError('Local command environment values do not match the Check Specification');
  }
  if (
    request.schemaVersion === 3 &&
    (protectedAssetReadLeaseDigest(request.protectedAssetReadLease, digests) !==
      request.protectedAssetReadLease.leaseDigest ||
      request.protectedAssetReadLease.goalId !== request.goalId ||
      request.protectedAssetReadLease.goalRevision !== request.goalRevision ||
      request.protectedAssetReadLease.workflowId !== request.workflowId ||
      request.protectedAssetReadLease.candidateGenerationId !== request.generation.id ||
      request.protectedAssetReadLease.candidateDigest !== request.generation.frozenDigest ||
      request.protectedAssetReadLease.checkSpecificationId !== request.checkSpec.id ||
      request.protectedAssetReadLease.checkSpecificationVersion !== request.checkSpec.version ||
      request.protectedAssetReadLease.isolationProfileId !== request.isolationProfileId ||
      request.protectedAssetReadLease.isolationProfileDigest !== request.isolationProfileDigest ||
      request.protectedAssetReadLease.acceptanceCriticalVerificationPlanId !==
        request.checkSpec.acceptanceCriticalVerificationPlanId ||
      request.protectedAssetReadLease.acceptanceCriticalVerificationPlanDigest !==
        request.checkSpec.acceptanceCriticalVerificationPlanDigest ||
      request.protectedAssetReadLease.protectedAssetManifestDigest !==
        request.checkSpec.protectedAssetManifestDigest ||
      request.protectedAssetReadLease.leaseDigest !==
        request.checkSpec.protectedAssetReadLeaseDigest)
  ) {
    throw new TypeError('Protected local command request contains cross-authority bindings');
  }
  return request;
}

const localCommandResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('LOCAL_COMMAND_OBSERVATION_V1'),
    terminationKind: z.enum(Object.values(LocalCommandTerminationKind)),
    exitCode: z.number().int().min(0).max(255).optional(),
    signal: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => !value.includes('\u0000'))
      .optional(),
    stdoutBytes: z.instanceof(Uint8Array),
    stdoutObservedByteCount: z.number().int().nonnegative(),
    stdoutTruncated: z.boolean(),
    stderrBytes: z.instanceof(Uint8Array),
    stderrObservedByteCount: z.number().int().nonnegative(),
    stderrTruncated: z.boolean(),
    diagnosticCode: z.enum(Object.values(LocalCommandDiagnosticCode)),
  })
  .strict();

export function decodeLocalCommandVerificationResult(
  requestValue: unknown,
  value: unknown,
  digests: DigestProvider,
): LocalCommandVerificationResult {
  const request = decodeLocalCommandVerificationRequest(requestValue, digests);
  const parsed = localCommandResultSchema.parse(value);
  const stdoutBytes = new Uint8Array(parsed.stdoutBytes);
  const stderrBytes = new Uint8Array(parsed.stderrBytes);
  const retainedTotal = stdoutBytes.byteLength + stderrBytes.byteLength;
  if (
    stdoutBytes.byteLength > request.checkSpec.stdoutLimitBytes ||
    stderrBytes.byteLength > request.checkSpec.stderrLimitBytes ||
    retainedTotal > request.checkSpec.totalOutputLimitBytes ||
    retainedTotal > request.checkSpec.payloadRetentionLimitBytes ||
    stdoutBytes.byteLength > parsed.stdoutObservedByteCount ||
    stderrBytes.byteLength > parsed.stderrObservedByteCount ||
    parsed.stdoutTruncated !== stdoutBytes.byteLength < parsed.stdoutObservedByteCount ||
    parsed.stderrTruncated !== stderrBytes.byteLength < parsed.stderrObservedByteCount
  ) {
    throw new TypeError('Local command result exceeds or contradicts its output bounds');
  }
  const outputLimitExceeded = parsed.stdoutTruncated || parsed.stderrTruncated;
  const hasExitCode = parsed.exitCode !== undefined;
  const hasSignal = parsed.signal !== undefined;
  if (
    (outputLimitExceeded &&
      parsed.diagnosticCode !== LocalCommandDiagnosticCode.OUTPUT_LIMIT_EXCEEDED) ||
    (!outputLimitExceeded &&
      parsed.terminationKind === LocalCommandTerminationKind.EXITED &&
      (!hasExitCode || hasSignal || parsed.diagnosticCode !== LocalCommandDiagnosticCode.NONE)) ||
    (parsed.terminationKind === LocalCommandTerminationKind.SIGNALED &&
      (hasExitCode ||
        !hasSignal ||
        (!outputLimitExceeded &&
          parsed.diagnosticCode !== LocalCommandDiagnosticCode.PROCESS_SIGNALED))) ||
    (parsed.terminationKind === LocalCommandTerminationKind.TIMED_OUT &&
      (hasExitCode ||
        hasSignal ||
        (!outputLimitExceeded &&
          parsed.diagnosticCode !== LocalCommandDiagnosticCode.PROCESS_TIMED_OUT))) ||
    (parsed.terminationKind === LocalCommandTerminationKind.SPAWN_FAILED &&
      (hasExitCode ||
        hasSignal ||
        parsed.diagnosticCode !== LocalCommandDiagnosticCode.PROCESS_SPAWN_FAILED))
  ) {
    throw new TypeError('Local command result termination fields are inconsistent');
  }
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    kind: parsed.kind,
    terminationKind: parsed.terminationKind,
    ...(parsed.exitCode === undefined ? {} : { exitCode: parsed.exitCode }),
    ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
    stdoutBytes,
    stdoutObservedByteCount: parsed.stdoutObservedByteCount,
    stdoutTruncated: parsed.stdoutTruncated,
    stderrBytes,
    stderrObservedByteCount: parsed.stderrObservedByteCount,
    stderrTruncated: parsed.stderrTruncated,
    diagnosticCode: parsed.diagnosticCode,
  });
}

export function localCommandEnvironmentRecord(
  variables: readonly LocalCommandEnvironmentVariable[],
): Readonly<Record<string, string>> {
  const entries = variables.map(({ name, value }) => [name, value] as const);
  return Object.freeze(Object.fromEntries(entries));
}
