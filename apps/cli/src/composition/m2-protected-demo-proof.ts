import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AppServerClientError,
  AppServerClientErrorCode,
} from '@codeclosure/codex-app-server-client';
import {
  EvidenceKind,
  EvidenceResultStatus,
  ExternalWorkerDispatchPolicy,
  createGoal,
  createWorkflow,
  externalExecutionId,
  executionProfileId,
  goalId,
  goalRevision,
  policyBundleId,
  isoTimestamp,
  sha256Digest,
  successCriterionId,
  workflowId,
  type ExecutionProfileDefinition,
  type ExternalExecutionRecord,
  type ExternalExecutionProfileDefinition,
  type PolicyBundleDefinition,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  ExternalWorkerFailureCode,
  M1_ACCEPTANCE_RULES,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  WorkflowDriveStopReason,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  createM1AcceptanceCheckerIdentity,
  createPolicyInstaller,
  externalExecutionAbandonReasonCode,
  externalWorkerFailureCode,
  goalAndWorkflowCreationPayloadProjection,
  type Clock,
  type ExternalFailureCodeView,
  type GoalAuditView,
  type GoalStatusView,
  type ExternalWorkerInvocationPort,
  type RuntimeCommandResult,
  type VerificationPort,
  type WorkflowDriveSummary,
  type WorkerPort,
  type WorkerRequest,
} from '@codeclosure/runtime';
import {
  createCandidateLeasedWorker,
  createM1DeterministicPhaseGuardEvaluator,
  createProtectedM2WorkflowDriver,
  type CandidateLeasedWorkerFactory,
  type RuntimeExecutionProfile,
  type WorkflowDriverCapability,
} from '@codeclosure/runtime/composition';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';
import { DeterministicIds, FakeWorker, FakeWorkerFixture } from '@codeclosure/testing';
import {
  DARWIN_SEATBELT_PROFILE_ID,
  LOCAL_COMMAND_RUNNER_IDENTITY,
  LOCAL_COMMAND_RUNNER_VERSION,
  createDarwinSeatbeltIsolation,
  createLocalCommandVerificationRunner,
  createProtectedAssetReadLeaseAuthority,
  darwinSeatbeltProtectedProfileDigest,
  inspectProtectedVerificationAsset,
  protectedVerificationAssetManifestDigest,
} from '@codeclosure/verification-local';
import {
  createLocalCandidateWorkspace,
  observeLocalCandidateSourceIdentity,
  type LocalCandidateSourceIdentity,
} from '@codeclosure/workspace-local';

import { createNormalizedProjectPathPort } from './project-paths.js';
import {
  createTrustedCodexInvocation,
  prepareTrustedCodexProfile,
  type M2CodexAdapterDiagnostic,
  type TrustedCodexProfileAuthority,
} from './m2-codex-worker-invocation.js';

export type M2ProtectedDemoMode = 'REPAIR_ACCEPTED' | 'REPAIR_FAILED_STOP';
export type M2ExternalDemoMode = 'ADAPTER_FAILURE' | 'LIVE' | 'LIVE_REPAIR_HANDOFF';
type M2ExternalFailureCode = ExternalFailureCodeView;

interface M2AcceptanceTrace {
  readonly schemaVersion: 1;
  readonly plan: Readonly<{
    id: string;
    digest: string;
    workflowVersionAtLock: number;
    policyBundleId: string;
    policyBundleDigest: string;
    executionProfileId: string;
    executionProfileDigest: string;
    criterionIds: readonly string[];
    acceptanceRuleIds: readonly string[];
    protectedAssetManifestDigest: string;
    protectedAssets: readonly Readonly<{
      logicalAssetId: string;
      registeredProtectedRootIdentity: string;
      exactRealpath: string;
      executionPath: string;
      fileMode: number;
      byteLength: number;
      contentDigest: string;
      protectionMode: string;
    }>[];
    semanticCheck: Readonly<{
      version: string;
      executablePath: string;
      executableDigest: string;
      isolationProfileId: string;
      isolationProfileDigest: string;
    }>;
  }>;
  readonly dispatches: readonly Readonly<{
    attemptId: string;
    workerSessionId: string;
    contextManifestId: string;
    contextManifestDigest: string;
    contextPackageDigest: string;
    candidateGenerationId?: string;
    candidateDigest?: string;
    planId?: string;
    planDigest?: string;
    repairContextDigest?: string;
    priorAttemptFeedbackDigest?: string;
    contextSources: readonly Readonly<{
      kind: string;
      sourceRef: string;
      sourceRevision: string;
      sourceDigest?: string;
      authorityClass: string;
      renderedDigest: string;
    }>[];
    repair?: Readonly<{
      acceptanceRepairDigest: string;
      acceptanceDecisionId: string;
      acceptanceDecisionDigest: string;
      inputManifestDigest: string;
      evidenceSetDigest: string;
      rejectedCandidateGenerationId: string;
      rejectedCandidateDigest: string;
      repairCandidateGenerationId: string;
      repairCandidateSequence: number;
      repairCandidateBaseDigest: string;
      parentChangeSetDigest: string;
      failedEvidence: readonly Readonly<{
        evidenceId: string;
        evidenceRecordDigest: string;
        evidenceEligibilityVersion: number;
        verificationObligationId: string;
        checkSpecificationId: string;
        checkSpecificationDigest: string;
      }>[];
      constraintsToPreserve: readonly Readonly<{
        kind: string;
        sourceRef: string;
        sourceDigest: string;
      }>[];
    }>;
    priorAttemptFeedback?: Readonly<{
      digest: string;
      itemKinds: readonly string[];
      sourceRefs: readonly string[];
      sourceDigests: readonly string[];
    }>;
  }>[];
  readonly verification: readonly Readonly<{
    candidateGenerationId: string;
    candidateDigest: string;
    attemptId: string;
    verificationObligationId: string;
    checkId: string;
    checkVersion: string;
    checkDigest: string;
    protectedAssetReadLeaseDigest: string;
    isolationProfileId: string;
    isolationProfileDigest: string;
    environmentDigest: string;
    evidenceId: string;
    evidenceDigest: string;
    result: 'FAIL' | 'PASS';
  }>[];
  readonly externalExecutions: readonly Readonly<{
    id: string;
    attemptId: string;
    workerSessionId: string;
    contextManifestId: string;
    contextManifestDigest: string;
    contextPackageDigest: string;
    state: string;
    backendSessionRef?: string;
    backendOperationRef?: string;
    controlledStateRootIdentity: string;
    binaryIdentityDigest: string;
    protocolSchemaDigest: string;
    executionConfigDigest: string;
    managedRequirementsDigest: string;
    instructionSourceManifestDigest: string;
    compactionCount: number;
    turnInterruptCount: number;
    intentDigest: string;
    recordDigest: string;
  }>[];
  readonly repair?: Readonly<{
    acceptanceDecisionId: string;
    acceptanceDecisionDigest: string;
    inputManifestDigest: string;
    rejectedCandidateGenerationId: string;
    rejectedCandidateDigest: string;
    repairCandidateGenerationId: string;
    repairCandidateSequence: number;
    repairCandidateBaseDigest: string;
    verificationCheckId: string;
    verificationObligationIds: readonly string[];
    evidenceSetDigest: string;
    repairDigest: string;
  }>;
  readonly acceptance?: Readonly<{
    decisionId: string;
    decisionDigest: string;
    outcome: string;
    dominantReasonCode: string;
    inputManifestDigest: string;
    evidenceSetDigest: string;
    candidateGenerationId: string;
    candidateDigest: string;
    closeout?: Readonly<{
      acceptanceDecisionId: string;
      acceptanceDecisionDigest: string;
      inputManifestDigest: string;
      candidateGenerationId: string;
      candidateDigest: string;
      evidenceSetDigest: string;
      closedAt: string;
    }>;
  }>;
}

export interface M2ProtectedDemoProof {
  readonly acceptanceTrace: M2AcceptanceTrace;
  readonly audit: GoalAuditView;
  readonly evidence: readonly Readonly<{
    candidateGenerationId: string;
    candidateDigest: string;
    checkId: string;
    evidenceDigest: string;
    result: 'FAIL' | 'PASS';
  }>[];
  readonly finalDrive: NonNullable<
    Awaited<ReturnType<WorkflowDriverCapability['repairGoal']>>['drive']
  >;
  readonly finalStatus: GoalStatusView;
  readonly generationCount: number;
  readonly goalId: GoalStatusView['goalId'];
  readonly initialDrive: NonNullable<
    Awaited<ReturnType<WorkflowDriverCapability['startGoal']>>['drive']
  >;
  readonly intermediateStatus: GoalStatusView;
  readonly mode: M2ProtectedDemoMode;
  readonly planRef: NonNullable<GoalStatusView['protectedVerificationPlanRef']>;
  readonly reopenedStatus: GoalStatusView;
  readonly sourceIdentity: LocalCandidateSourceIdentity;
  readonly sourceUnchanged: true;
  readonly workerWritableTestPassed: true;
}

export interface M2AdapterFailureDemoProof {
  readonly acceptanceTrace: M2AcceptanceTrace;
  readonly audit: GoalAuditView;
  readonly finalDrive: NonNullable<
    Awaited<ReturnType<WorkflowDriverCapability['startGoal']>>['drive']
  >;
  readonly finalStatus: GoalStatusView;
  readonly goalId: GoalStatusView['goalId'];
  readonly planRef: NonNullable<GoalStatusView['protectedVerificationPlanRef']>;
  readonly reopenedStatus: GoalStatusView;
  readonly sourceIdentity: LocalCandidateSourceIdentity;
  readonly sourceUnchanged: true;
  readonly externalFailureCode: M2ExternalFailureCode;
}

export interface M2LiveDemoProof {
  readonly acceptanceTrace: M2AcceptanceTrace;
  readonly audit: GoalAuditView;
  readonly branch:
    | 'LIVE_FIRST_PASS_ACCEPTED'
    | 'LIVE_REPAIR_ACCEPTED'
    | 'LIVE_REPAIR_FAILED_STOP'
    | 'LIVE_REPAIR_HANDOFF_ACCEPTED'
    | 'LIVE_REPAIR_HANDOFF_FAILED_STOP';
  readonly evidence: readonly Readonly<{
    candidateGenerationId: string;
    candidateDigest: string;
    checkId: string;
    evidenceDigest: string;
    result: 'FAIL' | 'PASS';
  }>[];
  readonly externalExecutionCount: number;
  readonly finalDrive: NonNullable<
    Awaited<
      ReturnType<WorkflowDriverCapability['startGoal'] | WorkflowDriverCapability['repairGoal']>
    >['drive']
  >;
  readonly finalStatus: GoalStatusView;
  readonly generationCount: 1 | 2;
  readonly goalId: GoalStatusView['goalId'];
  readonly initialDrive: NonNullable<
    Awaited<ReturnType<WorkflowDriverCapability['startGoal']>>['drive']
  >;
  readonly planRef: NonNullable<GoalStatusView['protectedVerificationPlanRef']>;
  readonly reopenedStatus: GoalStatusView;
  readonly sourceIdentity: LocalCandidateSourceIdentity;
  readonly sourceUnchanged: true;
}

export interface M2ExternalDemoOptions {
  readonly authSource?: string;
  readonly model?: string;
}

interface M2ExternalDemoBlockedErrorOptions extends ErrorOptions {
  readonly externalDiagnostic?: M2CodexAdapterDiagnostic;
  readonly externalFailureCode?: M2ExternalFailureCode;
  readonly runtimeStop?: M2RuntimeStopDiagnostic;
}

interface M2RuntimeStopDiagnostic {
  readonly stage: 'INITIAL_DRIVE' | 'REPAIR_DRIVE';
  readonly commandStatus: RuntimeCommandResult['status'];
  readonly drive?: WorkflowDriveSummary;
  readonly externalExecution?: M2ExternalExecutionDiagnostic;
}

interface M2ExternalExecutionDiagnostic {
  readonly id: ExternalExecutionRecord['id'];
  readonly attemptId: ExternalExecutionRecord['attemptId'];
  readonly state: ExternalExecutionRecord['state'];
  readonly failureCode?: M2ExternalFailureCode;
}

export class M2ExternalDemoBlockedError extends Error {
  public readonly blockerCode:
    'BACKEND_UNAVAILABLE' | 'BINARY_UNAVAILABLE' | 'PROTOCOL_INCOMPATIBLE';
  public readonly externalDiagnostic?: M2CodexAdapterDiagnostic;
  public readonly externalFailureCode?: M2ExternalFailureCode;
  public readonly runtimeStop?: M2RuntimeStopDiagnostic;

  public constructor(
    blockerCode: M2ExternalDemoBlockedError['blockerCode'],
    message: string,
    options?: M2ExternalDemoBlockedErrorOptions,
  ) {
    super(message, options);
    this.name = 'M2ExternalDemoBlockedError';
    this.blockerCode = blockerCode;
    if (options?.externalDiagnostic !== undefined) {
      this.externalDiagnostic = options.externalDiagnostic;
    }
    if (options?.externalFailureCode !== undefined) {
      this.externalFailureCode = options.externalFailureCode;
    }
    if (options?.runtimeStop !== undefined) {
      this.runtimeStop = options.runtimeStop;
    }
  }
}

const createdAt = isoTimestamp('2026-08-01T00:00:00.000Z');
const expectedResultContent = 'complete\n';

function monotonicClock(): Clock {
  const epoch = Date.parse(createdAt);
  let offset = 1;
  return Object.freeze({
    now: () => isoTimestamp(new Date(epoch + offset++).toISOString()),
  });
}

function git(root: string, arguments_: readonly string[]): string {
  return execFileSync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initializeSource(sourceRoot: string): void {
  mkdirSync(join(sourceRoot, 'src'), { recursive: true });
  writeFileSync(join(sourceRoot, 'README.md'), '# CodeClosure M2 protected demo\n');
  writeFileSync(join(sourceRoot, 'src', 'result.txt'), 'source-pending\n');
  git(sourceRoot, ['init', '--quiet']);
  git(sourceRoot, ['config', 'user.name', 'CodeClosure Demo']);
  git(sourceRoot, ['config', 'user.email', 'codeclosure@example.invalid']);
  git(sourceRoot, ['add', '.']);
  git(sourceRoot, ['commit', '--quiet', '-m', 'fixture']);
}

function makeTreeWritable(root: string): void {
  if (!existsSync(root)) {
    return;
  }
  const pending = [root];
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || !existsSync(path)) {
      continue;
    }
    const stat = lstatSync(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      chmodSync(path, 0o700);
      for (const name of readdirSync(path)) {
        pending.push(join(path, name));
      }
    } else if (stat.isFile()) {
      chmodSync(path, 0o600);
    }
  }
}

function executableDigest(path: string): ReturnType<typeof sha256Digest> {
  return sha256Digest(`sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
}

function policyDefinition(): PolicyBundleDefinition {
  const digests = new CanonicalJsonSha256DigestProvider();
  return Object.freeze({
    id: policyBundleId('policy_m2-protected-cli-demo'),
    schemaVersion: 1,
    version: 'm2-protected-cli-demo-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['candidate-lease-only']),
    contextRules: Object.freeze(['current-authority-only']),
    checkSpecifications: Object.freeze([
      'm1-candidate-freeze',
      'm2-protected-local-command-verification',
    ]),
    applicabilityRules: Object.freeze(['exact-generation-check-and-policy']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([createM1AcceptanceCheckerIdentity(digests)]),
  });
}

function profileDefinition(
  externalExecution?: ExternalExecutionProfileDefinition,
): ExecutionProfileDefinition {
  const base = {
    id: executionProfileId('profile_m2-protected-cli-demo'),
    version: 'm2-protected-cli-demo-v1',
    workerAdapter:
      externalExecution === undefined ? 'controlled-candidate-worker' : 'codex-app-server-worker',
    workerAdapterVersion: '1',
    candidateSource: 'controlled-copy-candidate-workspace',
    candidateSourceVersion: '1',
    verificationRunner: LOCAL_COMMAND_RUNNER_IDENTITY,
    verificationRunnerVersion: LOCAL_COMMAND_RUNNER_VERSION,
    driverVersion:
      externalExecution === undefined ? 'm2-workflow-driver-v1' : 'm2-workflow-driver-v2',
  };
  return externalExecution === undefined
    ? Object.freeze({ ...base, schemaVersion: 1 })
    : Object.freeze({ ...base, schemaVersion: 2, externalExecution });
}

function requireStatus(
  application: ReturnType<typeof createCodeClosureApplication>,
  identifier: GoalStatusView['goalId'],
): GoalStatusView {
  const result = application.getGoalStatus(identifier);
  if (result.status !== 'FOUND') {
    throw new TypeError('M2 demo Goal status is unavailable');
  }
  return result.view;
}

function requireAudit(
  application: ReturnType<typeof createCodeClosureApplication>,
  identifier: GoalStatusView['goalId'],
): GoalAuditView {
  const result = application.getGoalAudit(identifier);
  if (result.status !== 'FOUND') {
    throw new TypeError('M2 demo Goal audit is unavailable');
  }
  return result.view;
}

export function runM2ProtectedDemoProof(mode: M2ProtectedDemoMode): Promise<M2ProtectedDemoProof>;
export function runM2ProtectedDemoProof(
  mode: 'ADAPTER_FAILURE',
  options?: M2ExternalDemoOptions,
): Promise<M2AdapterFailureDemoProof>;
export function runM2ProtectedDemoProof(
  mode: 'LIVE' | 'LIVE_REPAIR_HANDOFF',
  options: M2ExternalDemoOptions,
): Promise<M2LiveDemoProof>;
export async function runM2ProtectedDemoProof(
  mode: M2ProtectedDemoMode | M2ExternalDemoMode,
  options: M2ExternalDemoOptions = {},
): Promise<M2ProtectedDemoProof | M2AdapterFailureDemoProof | M2LiveDemoProof> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m2-cli-demo-')));
  const sourceRoot = join(root, 'source');
  const workspaceRoot = join(root, 'workspaces');
  const authorityRoot = join(root, 'authority');
  const credentialRoot = join(root, 'credentials');
  const protectedRoot = join(root, 'protected-verification');
  const runRoot = join(root, 'verification-runs');
  const codexRoots = Object.freeze({
    codexHome: join(root, 'codex-home'),
    processHome: join(root, 'codex-process-home'),
    stateRoot: join(root, 'codex-state'),
    temporaryDirectory: join(root, 'codex-tmp'),
  });
  let externalDiagnostic: M2CodexAdapterDiagnostic | undefined;
  let store: ReturnType<typeof openSqliteControlStore> | undefined;
  try {
    for (const path of [
      sourceRoot,
      workspaceRoot,
      authorityRoot,
      credentialRoot,
      protectedRoot,
      runRoot,
    ]) {
      mkdirSync(path, { mode: 0o700 });
    }
    initializeSource(sourceRoot);
    const sourceIdentityBefore = observeLocalCandidateSourceIdentity(sourceRoot);
    const assertSourceIdentityUnchanged = (): LocalCandidateSourceIdentity => {
      const observed = observeLocalCandidateSourceIdentity(sourceRoot);
      if (JSON.stringify(observed) !== JSON.stringify(sourceIdentityBefore)) {
        throw new TypeError('M2 protected demo changed its source tree or Git metadata');
      }
      return sourceIdentityBefore;
    };
    writeFileSync(join(credentialRoot, 'token'), 'fixture-only-secret\n', { mode: 0o600 });
    const expectedPath = join(protectedRoot, 'expected-result.txt');
    writeFileSync(expectedPath, expectedResultContent, { mode: 0o400 });

    const codexProfile: TrustedCodexProfileAuthority | undefined =
      mode === 'ADAPTER_FAILURE' || mode === 'LIVE' || mode === 'LIVE_REPAIR_HANDOFF'
        ? await prepareTrustedCodexProfile({
            ...(options.authSource === undefined ? {} : { authSource: options.authSource }),
            expectedInputMode: mode === 'ADAPTER_FAILURE' ? 'CONFIG_DIGEST_MISMATCH' : 'CURRENT',
            model: options.model ?? 'gpt-5.6-sol',
            probeWorkspace: sourceRoot,
            projectRoots: Object.freeze([workspaceRoot]),
            roots: codexRoots,
            ...(mode === 'LIVE_REPAIR_HANDOFF'
              ? {
                  workerDispatchPolicy: ExternalWorkerDispatchPolicy.ACCEPTANCE_REPAIR_ONLY,
                }
              : {}),
          })
        : undefined;

    const filename = join(authorityRoot, 'state.sqlite');
    store = openSqliteControlStore({ filename });
    const namespace = `m2-protected-cli-${mode.toLowerCase().replaceAll('_', '-')}`;
    const ids = new DeterministicIds(namespace);
    const clock = monotonicClock();
    const digests = new CanonicalJsonSha256DigestProvider();
    const goal = createGoal({
      id: goalId(`goal_${namespace}`),
      revision: goalRevision(1),
      objective: `Set src/result.txt in the isolated Candidate to exact UTF-8 content ${JSON.stringify(expectedResultContent)}`,
      successCriteria: Object.freeze([
        Object.freeze({
          id: successCriterionId('criterion_m2-protected-cli-complete'),
          description: `src/result.txt contains exactly UTF-8 content ${JSON.stringify(expectedResultContent)} and no other bytes`,
          required: true,
        }),
      ]),
      scope: Object.freeze({ projectPath: realpathSync(sourceRoot), allowedPaths: ['src'] }),
      nonGoals: Object.freeze(['Do not edit source', 'Do not replace protected verification']),
      createdAt,
    });
    const workflow = createWorkflow({
      id: workflowId(`workflow_${namespace}`),
      goalId: goal.id,
      goalRevision: goal.revision,
      createdAt,
    });
    const policy = createPolicyInstaller({ store, clock, ids, digests }).installPolicyBundle(
      policyDefinition(),
    );
    if (policy.status === 'POLICY_CONFLICT') {
      throw new TypeError(policy.message);
    }
    if (codexProfile !== undefined) {
      const capability = store.installExternalBackendCapabilityRecord({
        record: codexProfile.capabilityRecord,
        auditEventId: ids.nextAuditEventId(),
        payloadDigest: codexProfile.capabilityRecord.recordDigest,
      });
      if (capability.status !== 'INSTALLED' && capability.status !== 'EXISTING') {
        throw new TypeError('M2 Codex capability authority could not be installed');
      }
    }
    const profile = createExecutionProfileInstaller({
      store,
      clock,
      ids,
      digests,
    }).installExecutionProfile(profileDefinition(codexProfile?.externalExecution));
    if (profile.status === 'PROFILE_CONFLICT') {
      throw new TypeError(profile.message);
    }
    const creation = store.createGoalWithWorkflow({
      commandId: ids.nextCommandId(),
      inputDigest: digests.digest({ schemaVersion: 1, type: 'M2_PROTECTED_CLI_CREATE', goal }),
      goal,
      workflow,
      auditEventId: ids.nextAuditEventId(),
      workflowAuditEventId: ids.nextAuditEventId(),
      payloadDigest: digests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow)),
    });
    if (creation.status !== 'APPLIED') {
      throw new TypeError('M2 demo Goal creation was not applied');
    }

    const forbiddenRoots = Object.freeze(
      [
        authorityRoot,
        credentialRoot,
        protectedRoot,
        sourceRoot,
        ...(codexProfile === undefined
          ? []
          : [
              codexProfile.roots.codexHome,
              codexProfile.roots.processHome,
              codexProfile.roots.stateRoot,
              codexProfile.roots.temporaryDirectory,
            ]),
      ]
        .map((path) => realpathSync(path))
        .sort(),
    );
    const workspace = createLocalCandidateWorkspace({
      authorityRoots: Object.freeze(
        [
          authorityRoot,
          credentialRoot,
          protectedRoot,
          ...(codexProfile === undefined
            ? []
            : [
                codexProfile.roots.codexHome,
                codexProfile.roots.processHome,
                codexProfile.roots.stateRoot,
                codexProfile.roots.temporaryDirectory,
              ]),
        ]
          .map((path) => realpathSync(path))
          .sort(),
      ),
      ownerId: namespace,
      workspaceRoot,
    });
    const generationRoots = new Map<number, string>();
    const workerRequests: WorkerRequest[] = [];
    const implementationWorker: CandidateLeasedWorkerFactory = Object.freeze({
      create: ({ lease }: Parameters<CandidateLeasedWorkerFactory['create']>[0]) => {
        generationRoots.set(lease.generationSequence, lease.root);
        const delegate = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
        const controlled: WorkerPort = Object.freeze({
          async *run(
            request: Parameters<WorkerPort['run']>[0],
            signal: AbortSignal,
          ): AsyncIterable<unknown> {
            workerRequests.push(request);
            const succeeds = lease.generationSequence > 1 && mode === 'REPAIR_ACCEPTED';
            writeFileSync(
              join(lease.root, 'src', 'result.txt'),
              succeeds ? expectedResultContent : 'incomplete\n',
            );
            writeFileSync(
              join(lease.root, 'src', 'worker-test.mjs'),
              'process.exit(0); // supplementary Worker-writable test\n',
            );
            yield* delegate.run(request, signal);
          },
        });
        return controlled;
      },
    });
    const worker = createCandidateLeasedWorker({
      authority: store,
      workspace,
      clock,
      forbiddenRoots,
      nonCandidateWorker: new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      implementationWorker,
    });
    const bootstrapVerification: VerificationPort = Object.freeze({
      run: () => {
        throw new TypeError('Protected M2 demo must not use M1 fake verification');
      },
    });
    const executablePath = realpathSync('/usr/bin/cmp');
    const protectedAsset = inspectProtectedVerificationAsset({
      logicalAssetId: 'm2.cli.expected-result',
      registeredProtectedRootIdentity: realpathSync(protectedRoot),
      executionPath: realpathSync(expectedPath),
    });
    const semanticCheck = Object.freeze({
      version: 'm2.cli.protected.1',
      producerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
      operation: 'local-command.execute',
      runnerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
      runnerVersion: LOCAL_COMMAND_RUNNER_VERSION,
      executablePath,
      executableDigest: executableDigest(executablePath),
      declaredToolVersion: 'darwin-cmp',
      argv: Object.freeze(['-s', protectedAsset.executionPath, 'src/result.txt']),
      cwd: '.',
      environmentVariables: Object.freeze([]),
      isolationProfileId: DARWIN_SEATBELT_PROFILE_ID,
      isolationProfileDigest: darwinSeatbeltProtectedProfileDigest(),
      timeoutMilliseconds: 2_000,
      terminationGraceMilliseconds: 100,
      stdoutLimitBytes: 4_096,
      stderrLimitBytes: 4_096,
      totalOutputLimitBytes: 8_192,
      payloadRetentionLimitBytes: 8_192,
      acceptedExitCodes: Object.freeze([0]),
    });
    const protectedAssets = createProtectedAssetReadLeaseAuthority({
      protectedRoots: Object.freeze([realpathSync(protectedRoot)]),
    });
    const runtimeProfileBase = {
      profileId: profile.value.profile.id,
      profileDigest: profile.value.profile.digest,
      driverVersion: profile.value.profile.driverVersion,
      worker,
      candidateSource: workspace,
      verification: bootstrapVerification,
      localCommandVerification: Object.freeze({
        workspace,
        runner: createLocalCommandVerificationRunner({
          workspaceLeases: workspace,
          protectedAssets,
          isolation: createDarwinSeatbeltIsolation({
            runRootBase: runRoot,
            credentialRoots: [credentialRoot],
          }),
        }),
        profile: Object.freeze({ forbiddenRoots, check: semanticCheck }),
      }),
      protectedVerification: Object.freeze({
        identities: ids,
        proposal: Object.freeze({
          acceptanceCriticalCriterionIds: Object.freeze(
            goal.successCriteria
              .filter(({ required }) => required)
              .map(({ id }) => id)
              .sort(),
          ),
          acceptanceRuleIds: Object.freeze([...policy.value.bundle.acceptanceRules].sort()),
          semanticCheckTemplate: Object.freeze({
            schemaVersion: 1 as const,
            checkVersion: semanticCheck.version,
            producerIdentity: semanticCheck.producerIdentity,
            operation: semanticCheck.operation,
            runnerIdentity: semanticCheck.runnerIdentity,
            runnerVersion: semanticCheck.runnerVersion,
            executablePath: semanticCheck.executablePath,
            executableDigest: semanticCheck.executableDigest,
            declaredToolVersion: semanticCheck.declaredToolVersion,
            argv: semanticCheck.argv,
            cwd: semanticCheck.cwd,
            environmentVariables: semanticCheck.environmentVariables,
            isolationProfileId: semanticCheck.isolationProfileId,
            isolationProfileDigest: semanticCheck.isolationProfileDigest,
            timeoutMilliseconds: semanticCheck.timeoutMilliseconds,
            terminationGraceMilliseconds: semanticCheck.terminationGraceMilliseconds,
            stdoutLimitBytes: semanticCheck.stdoutLimitBytes,
            stderrLimitBytes: semanticCheck.stderrLimitBytes,
            totalOutputLimitBytes: semanticCheck.totalOutputLimitBytes,
            payloadRetentionLimitBytes: semanticCheck.payloadRetentionLimitBytes,
            acceptedExitCodes: semanticCheck.acceptedExitCodes,
          }),
          protectedAssets: Object.freeze([protectedAsset]),
          protectedAssetManifestDigest: protectedVerificationAssetManifestDigest([protectedAsset]),
          protectedAssetReadLeasePolicy: 'EXACT_READ_ONLY_SINGLE_INVOCATION' as const,
          derivationRule: 'BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1' as const,
          authoritySource: 'TRUSTED_RUNTIME_COMPOSITION' as const,
        }),
        assets: protectedAssets,
      }),
    };
    const trustedExternalWorker =
      codexProfile === undefined
        ? undefined
        : createTrustedCodexInvocation({
            authority: store,
            clock,
            forbiddenRoots,
            profile: codexProfile,
            workspace,
            onCandidateLease: (lease) => {
              generationRoots.set(lease.generationSequence, lease.root);
            },
            onAdapterDiagnostic: (event) => {
              externalDiagnostic ??= event;
            },
          });
    const observedExternalWorker: ExternalWorkerInvocationPort | undefined =
      trustedExternalWorker === undefined
        ? undefined
        : Object.freeze({
            prepare: (input: Parameters<ExternalWorkerInvocationPort['prepare']>[0]) => {
              workerRequests.push(input.request);
              return trustedExternalWorker.prepare(input);
            },
          });
    let runtimeProfile: RuntimeExecutionProfile;
    if (codexProfile === undefined) {
      runtimeProfile = Object.freeze({ schemaVersion: 1, ...runtimeProfileBase });
    } else {
      if (observedExternalWorker === undefined) {
        throw new TypeError('M2 external profile has no observed Worker invocation');
      }
      runtimeProfile = Object.freeze({
        schemaVersion: 2,
        ...runtimeProfileBase,
        externalWorker: observedExternalWorker,
      });
    }
    const compiler = new MinimalContextCompiler({
      compilerVersion: 'm2-protected-cli-context-v1',
      maxPackageBytes: 64 * 1024,
      canonicalizer: new Rfc8785Canonicalizer(),
      digests,
    });
    const driver = createProtectedM2WorkflowDriver({
      store,
      clock,
      ids,
      digests,
      contextFactory: Object.freeze({
        compile: (input: Parameters<MinimalContextCompiler['compile']>[0]) =>
          compiler.compile(input),
      }),
      policyBundleId: policy.value.bundle.id,
      policyBundleDigest: policy.value.bundle.digest,
      phaseGuards: createM1DeterministicPhaseGuardEvaluator(),
      recovery: Object.freeze({
        resumeGoal: () => {
          throw new TypeError('M2 protected demo has no in-process recovery request');
        },
      }),
      startProfile: runtimeProfile,
      profiles: Object.freeze({ resolve: () => runtimeProfile }),
    });
    const application = createCodeClosureApplication({
      store,
      clock,
      creationIds: ids,
      digests,
      projectPaths: createNormalizedProjectPathPort(),
      execution: driver,
    });
    const externalExecutionAuthorizationIds = (): readonly ExternalExecutionRecord['id'][] => {
      if (store === undefined) {
        return Object.freeze([]);
      }
      return Object.freeze(
        requireAudit(application, goal.id)
          .events.filter(
            (event) =>
              event.aggregateType === 'EXTERNAL_EXECUTION' &&
              event.eventType === 'EXTERNAL_EXECUTION_AUTHORIZED',
          )
          .map((event) => externalExecutionId(event.aggregateId)),
      );
    };
    const latestExternalExecution = (): ExternalExecutionRecord | undefined => {
      if (store === undefined) {
        return undefined;
      }
      const authorizationId = externalExecutionAuthorizationIds().at(-1);
      if (authorizationId !== undefined) {
        return store.getExternalExecution(authorizationId);
      }
      const attempt = store.getWorkflowDriverAuthority(goal.id)?.latestPhaseAttempt;
      return attempt === undefined || attempt === null
        ? undefined
        : store.getExternalExecutionForAttempt(attempt.id);
    };
    const externalExecutionAuthorizedAfter = (
      priorIds: ReadonlySet<ExternalExecutionRecord['id']>,
    ): ExternalExecutionRecord | undefined => {
      if (store === undefined) {
        return undefined;
      }
      const newIds = externalExecutionAuthorizationIds().filter(
        (identifier) => !priorIds.has(identifier),
      );
      if (newIds.length > 1) {
        throw new TypeError('M2 live repair created more than one external execution');
      }
      const identifier = newIds[0];
      return identifier === undefined ? undefined : store.getExternalExecution(identifier);
    };
    const externalFailureCode = (
      execution: ExternalExecutionRecord | undefined,
    ): M2ExternalFailureCode | undefined => {
      if (execution?.failureCode === undefined) {
        return undefined;
      }
      return execution.state === 'ABANDONED'
        ? externalExecutionAbandonReasonCode(execution.failureCode)
        : externalWorkerFailureCode(execution.failureCode);
    };
    const externalExecutionDiagnostic = (
      execution: ExternalExecutionRecord,
    ): M2ExternalExecutionDiagnostic => {
      const failureCode = externalFailureCode(execution);
      return Object.freeze({
        id: execution.id,
        attemptId: execution.attemptId,
        state: execution.state,
        ...(failureCode === undefined ? {} : { failureCode }),
      });
    };
    const buildAcceptanceTrace = (
      rawVerificationRecords: readonly ReturnType<
        ReturnType<typeof openSqliteControlStore>['listEvidenceForGeneration']
      >[number]['record'][],
    ): M2AcceptanceTrace => {
      if (store === undefined) {
        throw new TypeError('M2 acceptance trace requires an open authoritative Store');
      }
      const plan = store.getAcceptanceCriticalVerificationPlan(workflow.id);
      if (plan === undefined) {
        throw new TypeError('M2 acceptance trace has no protected Verification Plan');
      }
      const verification = Object.freeze(
        rawVerificationRecords.map((record) => {
          if (
            record.kind !== EvidenceKind.LOCAL_COMMAND_TEST_RESULT ||
            record.schemaVersion !== 3
          ) {
            throw new TypeError('M2 acceptance trace contains non-protected verification Evidence');
          }
          return Object.freeze({
            candidateGenerationId: record.candidateGenerationId,
            candidateDigest: record.candidateDigest,
            attemptId: record.attemptId,
            verificationObligationId: record.verificationObligationId,
            checkId: record.checkSpec.id,
            checkVersion: record.checkSpec.version,
            checkDigest: digests.digest(record.checkSpec),
            protectedAssetReadLeaseDigest: record.protectedAssetReadLeaseDigest,
            isolationProfileId: record.checkSpec.isolationProfileId,
            isolationProfileDigest: record.checkSpec.isolationProfileDigest,
            environmentDigest: record.environmentIdentity.digest,
            evidenceId: record.id,
            evidenceDigest: record.recordDigest,
            result:
              record.resultStatus === EvidenceResultStatus.PASS
                ? ('PASS' as const)
                : ('FAIL' as const),
          });
        }),
      );
      const dispatches = Object.freeze(
        workerRequests.map((request) => {
          const manifest = store?.getContextManifest(request.contextManifestId);
          if (manifest === undefined) {
            throw new TypeError(
              `M2 acceptance trace cannot resolve Context ${request.contextManifestId}`,
            );
          }
          const repair = request.contextPackage.repairContext;
          const feedback = request.contextPackage.priorAttemptFeedback;
          return Object.freeze({
            attemptId: request.attemptId,
            workerSessionId: request.workerSessionId,
            contextManifestId: request.contextManifestId,
            contextManifestDigest: request.contextManifestDigest,
            contextPackageDigest: request.packageDigest,
            ...(request.contextPackage.candidateGenerationId === undefined
              ? {}
              : { candidateGenerationId: request.contextPackage.candidateGenerationId }),
            ...(request.contextPackage.candidateDigest === undefined
              ? {}
              : { candidateDigest: request.contextPackage.candidateDigest }),
            ...(request.contextPackage.acceptanceCriticalVerificationPlanId === undefined
              ? {}
              : { planId: request.contextPackage.acceptanceCriticalVerificationPlanId }),
            ...(request.contextPackage.acceptanceCriticalVerificationPlanDigest === undefined
              ? {}
              : { planDigest: request.contextPackage.acceptanceCriticalVerificationPlanDigest }),
            ...(manifest.repairContextDigest === undefined
              ? {}
              : { repairContextDigest: manifest.repairContextDigest }),
            ...(manifest.priorAttemptFeedbackDigest === undefined
              ? {}
              : { priorAttemptFeedbackDigest: manifest.priorAttemptFeedbackDigest }),
            contextSources: Object.freeze(
              manifest.entries.map((entry) =>
                Object.freeze({
                  kind: entry.kind,
                  sourceRef: entry.sourceRef,
                  sourceRevision: entry.sourceRevision,
                  ...(entry.sourceDigest === undefined ? {} : { sourceDigest: entry.sourceDigest }),
                  authorityClass: entry.authorityClass,
                  renderedDigest: entry.renderedDigest,
                }),
              ),
            ),
            ...(repair === undefined
              ? {}
              : {
                  repair: Object.freeze({
                    acceptanceRepairDigest: repair.acceptanceRepairDigest,
                    acceptanceDecisionId: repair.acceptanceDecisionId,
                    acceptanceDecisionDigest: repair.acceptanceDecisionDigest,
                    inputManifestDigest: repair.inputManifestDigest,
                    evidenceSetDigest: repair.evidenceSetDigest,
                    rejectedCandidateGenerationId: repair.rejectedCandidateGenerationId,
                    rejectedCandidateDigest: repair.rejectedCandidateDigest,
                    repairCandidateGenerationId: repair.repairCandidateGenerationId,
                    repairCandidateSequence: repair.repairCandidateSequence,
                    repairCandidateBaseDigest: repair.repairCandidateBaseDigest,
                    parentChangeSetDigest: repair.parentChangeSetDigest,
                    failedEvidence: Object.freeze(
                      repair.failedEvidence.map((evidence) =>
                        Object.freeze({
                          evidenceId: evidence.evidenceId,
                          evidenceRecordDigest: evidence.evidenceRecordDigest,
                          evidenceEligibilityVersion: evidence.evidenceEligibilityVersion,
                          verificationObligationId: evidence.verificationObligationId,
                          checkSpecificationId: evidence.checkSpecificationId,
                          checkSpecificationDigest: evidence.checkSpecificationDigest,
                        }),
                      ),
                    ),
                    constraintsToPreserve: Object.freeze(
                      repair.constraintsToPreserve.map((constraint) =>
                        Object.freeze({
                          kind: constraint.kind,
                          sourceRef: constraint.sourceRef,
                          sourceDigest: constraint.sourceDigest,
                        }),
                      ),
                    ),
                  }),
                }),
            ...(feedback === undefined
              ? {}
              : {
                  priorAttemptFeedback: Object.freeze({
                    digest: feedback.feedbackDigest,
                    itemKinds: Object.freeze(feedback.items.map(({ kind }) => kind)),
                    sourceRefs: Object.freeze(
                      feedback.items.flatMap(({ sourceRefs }) => sourceRefs),
                    ),
                    sourceDigests: Object.freeze(
                      feedback.items.flatMap(({ sourceDigests }) => sourceDigests),
                    ),
                  }),
                }),
          });
        }),
      );
      const externalExecutions = Object.freeze(
        externalExecutionAuthorizationIds().map((identifier) => {
          const execution = store?.getExternalExecution(identifier);
          if (execution === undefined) {
            throw new TypeError(`M2 acceptance trace cannot resolve execution ${identifier}`);
          }
          return Object.freeze({
            id: execution.id,
            attemptId: execution.attemptId,
            workerSessionId: execution.workerSessionId,
            contextManifestId: execution.contextManifestId,
            contextManifestDigest: execution.contextManifestDigest,
            contextPackageDigest: execution.contextPackageDigest,
            state: execution.state,
            ...(execution.backendSessionRef === undefined
              ? {}
              : { backendSessionRef: execution.backendSessionRef }),
            ...(execution.backendOperationRef === undefined
              ? {}
              : { backendOperationRef: execution.backendOperationRef }),
            controlledStateRootIdentity: execution.controlledStateRootIdentity,
            binaryIdentityDigest: execution.binaryIdentityDigest,
            protocolSchemaDigest: execution.binaryProtocolSchemaDigest,
            executionConfigDigest: execution.executionConfigDigest,
            managedRequirementsDigest: execution.managedRequirementsDigest,
            instructionSourceManifestDigest: execution.instructionSourceManifestDigest,
            compactionCount: execution.compactionCount,
            turnInterruptCount: execution.turnInterruptCount,
            intentDigest: execution.intentDigest,
            recordDigest: execution.recordDigest,
          });
        }),
      );
      const firstFailed = verification.find(({ result }) => result === 'FAIL');
      const repair =
        firstFailed === undefined
          ? undefined
          : store.getAcceptanceRepairForRejectedGeneration(firstFailed.candidateGenerationId);
      const authority = store.getWorkflowDriverAuthority(goal.id);
      const acceptance = authority?.acceptanceAuthority;
      const closeout = store.getCloseoutForWorkflow(workflow.id);
      return Object.freeze({
        schemaVersion: 1,
        plan: Object.freeze({
          id: plan.id,
          digest: plan.planDigest,
          workflowVersionAtLock: plan.workflowVersionAtLock,
          policyBundleId: plan.policyBundleId,
          policyBundleDigest: plan.policyBundleDigest,
          executionProfileId: plan.executionProfileId,
          executionProfileDigest: plan.executionProfileDigest,
          criterionIds: plan.acceptanceCriticalCriterionIds,
          acceptanceRuleIds: plan.acceptanceRuleIds,
          protectedAssetManifestDigest: plan.protectedAssetManifestDigest,
          protectedAssets: Object.freeze(
            plan.protectedAssets.map((asset) =>
              Object.freeze({
                logicalAssetId: asset.logicalAssetId,
                registeredProtectedRootIdentity: asset.registeredProtectedRootIdentity,
                exactRealpath: asset.exactRealpath,
                executionPath: asset.executionPath,
                fileMode: asset.fileMode,
                byteLength: asset.byteLength,
                contentDigest: asset.contentDigest,
                protectionMode: asset.protectionMode,
              }),
            ),
          ),
          semanticCheck: Object.freeze({
            version: plan.semanticCheckTemplate.checkVersion,
            executablePath: plan.semanticCheckTemplate.executablePath,
            executableDigest: plan.semanticCheckTemplate.executableDigest,
            isolationProfileId: plan.semanticCheckTemplate.isolationProfileId,
            isolationProfileDigest: plan.semanticCheckTemplate.isolationProfileDigest,
          }),
        }),
        dispatches,
        verification,
        externalExecutions,
        ...(repair === undefined
          ? {}
          : {
              repair: Object.freeze({
                acceptanceDecisionId: repair.acceptanceDecisionId,
                acceptanceDecisionDigest: repair.acceptanceDecisionDigest,
                inputManifestDigest: repair.inputManifestDigest,
                rejectedCandidateGenerationId: repair.rejectedCandidateGenerationId,
                rejectedCandidateDigest: repair.rejectedCandidateDigest,
                repairCandidateGenerationId: repair.repairCandidateGenerationId,
                repairCandidateSequence: repair.repairCandidateSequence,
                repairCandidateBaseDigest: repair.repairCandidateBaseDigest,
                verificationCheckId: repair.verificationCheckId,
                verificationObligationIds: repair.verificationObligationIds,
                evidenceSetDigest: repair.evidenceSetDigest,
                repairDigest: repair.repairDigest,
              }),
            }),
        ...(acceptance === undefined
          ? {}
          : {
              acceptance: Object.freeze({
                decisionId: acceptance.decision.id,
                decisionDigest: acceptance.decision.decisionDigest,
                outcome: acceptance.decision.outcome,
                dominantReasonCode: acceptance.decision.dominantReasonCode,
                inputManifestDigest: acceptance.manifest.manifestDigest,
                evidenceSetDigest: acceptance.manifest.evidenceSetDigest,
                candidateGenerationId: acceptance.manifest.candidateGenerationId,
                candidateDigest: acceptance.manifest.candidateDigest,
                ...(closeout === undefined
                  ? {}
                  : {
                      closeout: Object.freeze({
                        acceptanceDecisionId: closeout.acceptanceDecisionId,
                        acceptanceDecisionDigest: closeout.acceptanceDecisionDigest,
                        inputManifestDigest: closeout.inputManifestDigest,
                        candidateGenerationId: closeout.candidateGenerationId,
                        candidateDigest: closeout.candidateDigest,
                        evidenceSetDigest: closeout.evidenceSetDigest,
                        closedAt: closeout.closedAt,
                      }),
                    }),
              }),
            }),
      });
    };
    const strictReopenStatus = (expected: GoalStatusView): GoalStatusView => {
      store?.close();
      store = undefined;
      const reopened = openSqliteControlStore({ filename });
      try {
        const reopenedApplication = createCodeClosureApplication({
          store: reopened,
          clock,
          creationIds: ids,
          digests,
          projectPaths: createNormalizedProjectPathPort(),
          execution: driver,
        });
        const reopenedStatus = requireStatus(reopenedApplication, goal.id);
        if (JSON.stringify(reopenedStatus) !== JSON.stringify(expected)) {
          throw new TypeError('M2 protected demo public status changed across strict reopen');
        }
        return reopenedStatus;
      } finally {
        reopened.close();
      }
    };

    const initial = await driver.startGoal({
      commandId: ids.nextCommandId(),
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: workflow.version,
    });
    if (mode === 'ADAPTER_FAILURE') {
      const execution = latestExternalExecution();
      const failureCode = externalFailureCode(execution);
      if (
        initial.command.status !== 'APPLIED' ||
        initial.drive?.stopReason !== WorkflowDriveStopReason.FAILED ||
        initial.drive.detailCode !== 'WORKER_STREAM_NO_TERMINAL_EVENT' ||
        failureCode !== ExternalWorkerFailureCode.EFFECTIVE_INPUT_MISMATCH
      ) {
        throw new TypeError(
          `M2 adapter failure demo stopped at ${initial.command.status}/${initial.drive?.stopReason ?? 'NO_DRIVE'}/${initial.drive?.detailCode ?? 'NO_DETAIL'}`,
        );
      }
      const finalStatus = requireStatus(application, goal.id);
      const planRef = finalStatus.protectedVerificationPlanRef;
      if (planRef === undefined) {
        throw new TypeError('M2 adapter failure demo did not retain its protected Plan');
      }
      const sourceIdentity = assertSourceIdentityUnchanged();
      const audit = requireAudit(application, goal.id);
      const acceptanceTrace = buildAcceptanceTrace([]);
      const reopenedStatus = strictReopenStatus(finalStatus);
      return Object.freeze({
        acceptanceTrace,
        audit,
        finalDrive: initial.drive,
        finalStatus,
        goalId: goal.id,
        planRef,
        reopenedStatus,
        sourceIdentity,
        sourceUnchanged: true,
        externalFailureCode: failureCode,
      });
    }
    if (
      mode === 'LIVE' &&
      initial.command.status === 'APPLIED' &&
      initial.drive?.stopReason === WorkflowDriveStopReason.CLOSED
    ) {
      const finalStatus = requireStatus(application, goal.id);
      const authority = store.getWorkflowDriverAuthority(goal.id);
      const generation = authority?.candidateAuthority?.generation;
      const evidence =
        generation === undefined
          ? undefined
          : store
              .listEvidenceForGeneration(generation.id)
              .find(({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT);
      const planRef = finalStatus.protectedVerificationPlanRef;
      if (
        generation?.sequence !== 1 ||
        evidence?.record.resultStatus !== EvidenceResultStatus.PASS ||
        planRef === undefined
      ) {
        throw new TypeError('M2 live first-pass branch lacks exact passing authority');
      }
      const audit = requireAudit(application, goal.id);
      const externalExecutionCount = audit.events.filter(
        ({ eventType }) => eventType === 'EXTERNAL_EXECUTION_AUTHORIZED',
      ).length;
      if (externalExecutionCount !== 1) {
        throw new TypeError('M2 live first-pass branch has an unexpected external call count');
      }
      const acceptanceTrace = buildAcceptanceTrace([evidence.record]);
      const reopenedStatus = strictReopenStatus(finalStatus);
      return Object.freeze({
        acceptanceTrace,
        audit,
        branch: 'LIVE_FIRST_PASS_ACCEPTED',
        evidence: Object.freeze([
          Object.freeze({
            candidateGenerationId: evidence.record.candidateGenerationId,
            candidateDigest: evidence.record.candidateDigest,
            checkId: evidence.record.checkSpec.id,
            evidenceDigest: evidence.record.recordDigest,
            result: 'PASS',
          }),
        ]),
        externalExecutionCount,
        finalDrive: initial.drive,
        finalStatus,
        generationCount: 1,
        goalId: goal.id,
        initialDrive: initial.drive,
        planRef,
        reopenedStatus,
        sourceIdentity: assertSourceIdentityUnchanged(),
        sourceUnchanged: true,
      });
    }
    if (
      initial.command.status !== 'APPLIED' ||
      initial.drive?.stopReason !== WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED
    ) {
      if (mode === 'LIVE' || mode === 'LIVE_REPAIR_HANDOFF') {
        const execution = latestExternalExecution();
        const failureCode = externalFailureCode(execution);
        throw new M2ExternalDemoBlockedError(
          'BACKEND_UNAVAILABLE',
          `The live Codex branch stopped at ${initial.drive?.stopReason ?? 'NO_DRIVE'}`,
          {
            ...(externalDiagnostic === undefined ? {} : { externalDiagnostic }),
            ...(failureCode === undefined ? {} : { externalFailureCode: failureCode }),
            runtimeStop: Object.freeze({
              stage: 'INITIAL_DRIVE',
              commandStatus: initial.command.status,
              ...(initial.drive === undefined ? {} : { drive: initial.drive }),
              ...(execution === undefined
                ? {}
                : { externalExecution: externalExecutionDiagnostic(execution) }),
            }),
          },
        );
      }
      throw new TypeError('M2 protected demo did not reach its governed initial rejection');
    }
    const intermediateStatus = requireStatus(application, goal.id);
    const rejected = store.getWorkflowDriverAuthority(goal.id);
    if (rejected?.acceptanceAuthority?.decision.outcome !== 'REJECT_REPAIRABLE') {
      throw new TypeError('M2 protected demo has no current repair authority');
    }
    const generationOne = rejected.candidateAuthority?.generation;
    const generationOneRoot = generationRoots.get(1);
    if (generationOne === undefined || generationOneRoot === undefined) {
      throw new TypeError('M2 protected demo generation 1 is unavailable');
    }
    if (mode !== 'LIVE') {
      execFileSync(process.execPath, [join(generationOneRoot, 'src', 'worker-test.mjs')], {
        cwd: generationOneRoot,
        stdio: 'ignore',
      });
    }
    const firstEvidence = store
      .listEvidenceForGeneration(generationOne.id)
      .find(({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT);
    if (firstEvidence?.record.resultStatus !== EvidenceResultStatus.FAIL) {
      throw new TypeError('Protected Oracle did not reject the incorrect implementation');
    }
    const rejection = rejected.acceptanceAuthority;
    const externalExecutionIdsBeforeRepair = new Set(externalExecutionAuthorizationIds());
    const repaired = await driver.repairGoal({
      commandId: ids.nextCommandId(),
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: rejected.workflow.version,
      acceptanceDecisionId: rejection.decision.id,
      acceptanceDecisionDigest: rejection.decision.decisionDigest,
      inputManifestDigest: rejection.manifest.manifestDigest,
      candidateDigest: rejection.manifest.candidateDigest,
      reason: 'bounded CLI demo repair in one child Candidate generation',
    });
    const liveRepair = mode === 'LIVE' || mode === 'LIVE_REPAIR_HANDOFF';
    const repairReachedVerificationOutcome =
      repaired.drive?.stopReason === WorkflowDriveStopReason.CLOSED ||
      repaired.drive?.stopReason === WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED;
    if (
      liveRepair &&
      repaired.command.status === 'APPLIED' &&
      repaired.drive !== undefined &&
      !repairReachedVerificationOutcome
    ) {
      const execution = externalExecutionAuthorizedAfter(externalExecutionIdsBeforeRepair);
      const failureCode = externalFailureCode(execution);
      throw new M2ExternalDemoBlockedError(
        'BACKEND_UNAVAILABLE',
        'The bounded live Codex repair did not reach independent verification.',
        {
          ...(externalDiagnostic === undefined ? {} : { externalDiagnostic }),
          ...(failureCode === undefined ? {} : { externalFailureCode: failureCode }),
          runtimeStop: Object.freeze({
            stage: 'REPAIR_DRIVE',
            commandStatus: repaired.command.status,
            drive: repaired.drive,
            ...(execution === undefined
              ? {}
              : { externalExecution: externalExecutionDiagnostic(execution) }),
          }),
        },
      );
    }
    const expectedStop =
      mode === 'REPAIR_ACCEPTED'
        ? WorkflowDriveStopReason.CLOSED
        : WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED;
    if (
      repaired.command.status !== 'APPLIED' ||
      repaired.drive === undefined ||
      (liveRepair ? !repairReachedVerificationOutcome : repaired.drive.stopReason !== expectedStop)
    ) {
      throw new TypeError(
        `M2 protected demo repair branch stopped at ${repaired.command.status}/${repaired.drive?.stopReason ?? 'NO_DRIVE'}/${repaired.drive?.detailCode ?? 'NO_DETAIL'}`,
      );
    }
    const finalStatus = requireStatus(application, goal.id);
    const finalAuthority = store.getWorkflowDriverAuthority(goal.id);
    const finalCandidateAuthority = finalAuthority?.candidateAuthority;
    if (finalCandidateAuthority?.generation.sequence !== 2) {
      throw new TypeError('M2 protected demo did not retain exactly the repair generation');
    }
    const finalGeneration = finalCandidateAuthority.generation;
    const secondEvidence = store
      .listEvidenceForGeneration(finalGeneration.id)
      .find(({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT);
    const repairAccepted = repaired.drive.stopReason === WorkflowDriveStopReason.CLOSED;
    const expectedEvidenceResult = repairAccepted
      ? EvidenceResultStatus.PASS
      : EvidenceResultStatus.FAIL;
    if (secondEvidence?.record.resultStatus !== expectedEvidenceResult) {
      throw new TypeError('M2 protected demo repair Evidence does not match the selected branch');
    }
    if (store.nextCandidateGenerationSequence(finalCandidateAuthority.candidate.id) !== 3) {
      throw new TypeError(
        'M2 protected demo created a hidden generation beyond the bounded repair',
      );
    }
    const sourceIdentity = assertSourceIdentityUnchanged();
    const planRef = finalStatus.protectedVerificationPlanRef;
    if (
      planRef === undefined ||
      planRef.digest !== intermediateStatus.protectedVerificationPlanRef?.digest
    ) {
      throw new TypeError('M2 protected demo changed its immutable Verification Plan');
    }
    const audit = requireAudit(application, goal.id);
    const evidence = Object.freeze([
      Object.freeze({
        candidateGenerationId: firstEvidence.record.candidateGenerationId,
        candidateDigest: firstEvidence.record.candidateDigest,
        checkId: firstEvidence.record.checkSpec.id,
        evidenceDigest: firstEvidence.record.recordDigest,
        result: 'FAIL' as const,
      }),
      Object.freeze({
        candidateGenerationId: secondEvidence.record.candidateGenerationId,
        candidateDigest: secondEvidence.record.candidateDigest,
        checkId: secondEvidence.record.checkSpec.id,
        evidenceDigest: secondEvidence.record.recordDigest,
        result:
          secondEvidence.record.resultStatus === EvidenceResultStatus.PASS
            ? ('PASS' as const)
            : ('FAIL' as const),
      }),
    ]);
    const acceptanceTrace = buildAcceptanceTrace([firstEvidence.record, secondEvidence.record]);
    const reopenedStatus = strictReopenStatus(finalStatus);
    if (mode === 'LIVE' || mode === 'LIVE_REPAIR_HANDOFF') {
      const externalExecutionCount = audit.events.filter(
        ({ eventType }) => eventType === 'EXTERNAL_EXECUTION_AUTHORIZED',
      ).length;
      const expectedExternalExecutionCount = mode === 'LIVE' ? 2 : 1;
      if (externalExecutionCount !== expectedExternalExecutionCount) {
        throw new TypeError('M2 live repair branch has an unexpected external call count');
      }
      return Object.freeze({
        acceptanceTrace,
        audit,
        branch:
          mode === 'LIVE'
            ? repairAccepted
              ? 'LIVE_REPAIR_ACCEPTED'
              : 'LIVE_REPAIR_FAILED_STOP'
            : repairAccepted
              ? 'LIVE_REPAIR_HANDOFF_ACCEPTED'
              : 'LIVE_REPAIR_HANDOFF_FAILED_STOP',
        evidence,
        externalExecutionCount,
        finalDrive: repaired.drive,
        finalStatus,
        generationCount: 2,
        goalId: goal.id,
        initialDrive: initial.drive,
        planRef,
        reopenedStatus,
        sourceIdentity,
        sourceUnchanged: true,
      });
    }
    return Object.freeze({
      acceptanceTrace,
      audit,
      evidence,
      finalDrive: repaired.drive,
      finalStatus,
      generationCount: 2,
      goalId: goal.id,
      initialDrive: initial.drive,
      intermediateStatus,
      mode,
      planRef,
      reopenedStatus,
      sourceIdentity,
      sourceUnchanged: true,
      workerWritableTestPassed: true,
    });
  } catch (error) {
    if (error instanceof AppServerClientError) {
      const protocolCodes: ReadonlySet<AppServerClientError['code']> = new Set([
        AppServerClientErrorCode.MALFORMED_RESPONSE,
        AppServerClientErrorCode.PROTOCOL_CORRELATION,
        AppServerClientErrorCode.PROTOCOL_LIMIT,
        AppServerClientErrorCode.PROTOCOL_MALFORMED,
        AppServerClientErrorCode.UNSUPPORTED_METHOD,
        AppServerClientErrorCode.UNSUPPORTED_SERVER_REQUEST,
      ]);
      throw new M2ExternalDemoBlockedError(
        error.code === AppServerClientErrorCode.VERSION_MISMATCH
          ? 'BINARY_UNAVAILABLE'
          : protocolCodes.has(error.code)
            ? 'PROTOCOL_INCOMPATIBLE'
            : 'BACKEND_UNAVAILABLE',
        'The bounded live Codex preflight is unavailable.',
        { cause: error },
      );
    }
    throw error;
  } finally {
    store?.close();
    makeTreeWritable(root);
    rmSync(root, { force: true, recursive: true });
  }
}
