import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  createCodexExternalProcessReconciler,
  type CodexAdapterObservationV2,
} from '@codeclosure/adapter-codex';
import {
  ProtectedAssetReadLeasePolicy,
  WorkflowPhase,
  attemptId,
  sha256Digest,
  workerEventId,
  type Goal,
  type GoalId,
  type CommandId,
  type PolicyBundleId,
  type Sha256Digest,
  type WorkflowId,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M251IntakePackageCompiler,
  M251TrustedIntentProjectionCompiler,
  M251_VERIFICATION_RUNNER_ID,
  M251_VERIFICATION_RUNNER_VERSION,
  M25IntentAdmissionEngine,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  createCodeClosureApplication,
  createM25AdmissionPolicy,
  createM251ProductionAdmissionPolicyDefinition,
  reconcileProjectReadSnapshots,
  type CodeClosureApplication,
  type IntakeStartCompositionPort,
  type M25IntakeStartupRecoverySummary,
  type StartupRecoverySummary,
  type Clock,
  type AcceptanceAuthorityView,
  type GoalStatusAuthoritySnapshot,
  type IntakeAuthorityView,
  type ProcessedCommandView,
  type DrivenGoalCommandResult,
  type VerificationPort,
  type WorkerPort,
} from '@codeclosure/runtime';
import {
  CryptographicIdentityGenerator,
  SystemUtcClock,
  createM1DeterministicPhaseGuardEvaluator,
  createProtectedM2WorkflowDriver,
  createRecoveryCoordinator,
} from '@codeclosure/runtime/composition';
import {
  DARWIN_SEATBELT_PROFILE_ID,
  createDarwinSeatbeltIsolation,
  createLocalCommandVerificationRunner,
  createProtectedAssetReadLeaseAuthority,
  darwinSeatbeltProtectedProfileDigest,
  inspectProtectedVerificationAsset,
  protectedVerificationAssetManifestDigest,
} from '@codeclosure/verification-local';
import {
  createLocalCandidateWorkspace,
  createLocalProjectReadWorkspace,
  observeLocalCandidateSourceIdentity,
} from '@codeclosure/workspace-local';

import type { IntakeCliApplication } from '../commands/intake.js';
import { ProtectedPathKind } from './data-home.js';
import { M1LocalRecoveryInspector } from './recovery-inspector.js';
import { createNormalizedProjectPathPort } from './project-paths.js';
import { openCliSqliteAuthority, type OpenCliSqliteAuthorityOptions } from './sqlite-authority.js';
import {
  createM251RuntimeProfileRegistry,
  installM251ExecutionAuthority,
  type InstalledM251ExecutionAuthority,
  type M251PhaseExecutionAuthorityInput,
} from './m251-execution-authority.js';
import {
  createM251TrustedCodexInvocation,
  type M251TrustedCodexProfileAuthority,
} from './m251-codex-worker-invocation.js';
import type {
  PreparedIntakeExecutionRootDescriptor,
  ProductionIntakeAssistantResource,
} from './intake-assistant-invocation.js';

export const M251_PAYMENT_DEMO_EXPECTED_RESULT =
  'duplicate callback is ignored, one charge is retained for one order, and different orders remain independent';
export const M251_PAYMENT_DEMO_PROTECTED_CHECK_ID = 'check_m2-5-1-payment-idempotency';
export const M251_PAYMENT_DEMO_PROTECTED_CHECK_VERSION =
  'codeclosure-m2-5-1-payment-idempotency-v1';

const M251_PROTECTED_NODE_MODULE_LAUNCHER = [
  "import { readFileSync } from 'node:fs';",
  'const protectedModule = readFileSync(process.argv[1]);',
  "await import(`data:text/javascript;base64,${protectedModule.toString('base64')}`);",
].join('\n');

export interface M251ProductionProjectContract {
  readonly projectFamily: string;
  readonly gitCommit: string;
  readonly gitTree: string;
  readonly sourceTreeDigest: string;
  readonly sourceGitMetadataDigest: string;
  readonly allowedPaths: readonly string[];
  readonly expectedResult: string;
}

export const M251_PAYMENT_DEMO_PROJECT_CONTRACT: M251ProductionProjectContract = Object.freeze({
  projectFamily: 'CodeClosureM25Demo',
  gitCommit: '1ad4bbb383d8ef38e29400b2625810ffa9dfb953',
  gitTree: '1e28086507ea644175065aaf6f4a8e2acce05036',
  sourceTreeDigest: 'sha256:1e2478b7bb3034cc2750b1c0f9a168b6905cb9e81a44d0a861365a570179441b',
  sourceGitMetadataDigest:
    'sha256:d2ea0289e4b42f96247e4e958be85524baa8a058a84773b6687a80fd3d6b0701',
  allowedPaths: Object.freeze(['src/payment.js']),
  expectedResult: M251_PAYMENT_DEMO_EXPECTED_RESULT,
});

export interface M251TrustedProductionRoots {
  readonly authorityHome: string;
  readonly candidateWorkspace: string;
  readonly credentialRoot: string;
  readonly projectReadWorkspace: string;
  readonly protectedAssetRoot: string;
  readonly verificationRunRoot: string;
}

export interface M251ExternalWorkerFactoryInput {
  readonly authority: Parameters<typeof createM251TrustedCodexInvocation>[0]['authority'];
  readonly clock: Parameters<typeof createM251TrustedCodexInvocation>[0]['clock'];
  readonly expectedExternalProfile: Parameters<
    typeof createM251TrustedCodexInvocation
  >[0]['expectedExternalProfile'];
  readonly forbiddenRoots: readonly string[];
  readonly onAdapterObservation?: (observation: CodexAdapterObservationV2) => void;
  readonly workspace: Parameters<typeof createM251TrustedCodexInvocation>[0]['workspace'];
}

export interface M251ProductionActivation {
  readonly kind: 'REAL_CODEX' | 'EXPLICIT_PROTOCOL_FIXTURE';
  readonly capabilityRecord: M251TrustedCodexProfileAuthority['capabilityRecord'];
  readonly operationRoots: readonly string[];
  readonly phaseAuthorities: readonly M251PhaseExecutionAuthorityInput[];
  readonly sharedProfile: M251TrustedCodexProfileAuthority['sharedProfile'];
  createExternalWorker(
    input: M251ExternalWorkerFactoryInput,
  ): ReturnType<typeof createM251TrustedCodexInvocation>;
}

export function createM251RealCodexProductionActivation(
  profile: M251TrustedCodexProfileAuthority,
): M251ProductionActivation {
  return Object.freeze({
    kind: 'REAL_CODEX',
    capabilityRecord: profile.capabilityRecord,
    operationRoots: Object.freeze(Object.values(profile.roots).toSorted()),
    phaseAuthorities: profile.phaseAuthorities,
    sharedProfile: profile.sharedProfile,
    createExternalWorker: (input: M251ExternalWorkerFactoryInput) =>
      createM251TrustedCodexInvocation({ ...input, profile }),
  });
}

export interface CreateM251TrustedProductionCompositionOptions extends Omit<
  OpenCliSqliteAuthorityOptions,
  'dataHomePath' | 'protectedPaths' | 'allowedProjectPaths'
> {
  readonly activation: M251ProductionActivation;
  readonly intakeAssistant: ProductionIntakeAssistantResource;
  readonly observationSink?: M251TrustedProductionObservationSink;
  readonly candidateSourceFixture?: Parameters<
    typeof createM251RuntimeProfileRegistry
  >[1]['candidateSource'];
  readonly ids?: M251TrustedProductionIdentityGenerator;
  readonly clock?: Clock;
  readonly projectContract?: M251ProductionProjectContract;
  readonly projectPath: string;
  readonly protectedCheckPath: string;
  readonly roots: M251TrustedProductionRoots;
}

export type M251TrustedProductionIdentityGenerator = Parameters<
  typeof createCodeClosureApplication
>[0]['creationIds'] &
  ConstructorParameters<typeof M25IntakeCoordinator>[0]['ids'] &
  Parameters<typeof createRecoveryCoordinator>[0]['ids'] &
  Parameters<typeof createProtectedM2WorkflowDriver>[0]['ids'] &
  Parameters<typeof reconcileProjectReadSnapshots>[0]['identities'] &
  Parameters<typeof createM251RuntimeProfileRegistry>[1]['protectedVerification']['identities'];

export interface M251TrustedProductionObservationSink {
  onAdapterObservation?(observation: CodexAdapterObservationV2): void;
  onOrdinaryStartResult?(result: DrivenGoalCommandResult): void;
}

export interface M251TrustedProductionPhaseAuthority {
  readonly adapterObservation: CodexAdapterObservationV2;
  readonly attempt: NonNullable<ReturnType<CodeClosureApplicationStoreReader['getAttempt']>>;
  readonly contextManifest: NonNullable<
    ReturnType<CodeClosureApplicationStoreReader['getContextManifest']>
  >;
  readonly externalRecord: NonNullable<
    ReturnType<CodeClosureApplicationStoreReader['getExternalExecutionForAttempt']>
  >;
  readonly projectReadAuthority?: NonNullable<
    ReturnType<CodeClosureApplicationStoreReader['getProjectSourceReadAuthority']>
  >;
  readonly workerEventReceipt: NonNullable<
    ReturnType<CodeClosureApplicationStoreReader['getWorkerEventReceipt']>
  >;
}

interface CodeClosureApplicationStoreReader {
  getAttempt: ReturnType<typeof openCliSqliteAuthority>['getAttempt'];
  getContextManifest: ReturnType<typeof openCliSqliteAuthority>['getContextManifest'];
  getExternalExecutionForAttempt: ReturnType<
    typeof openCliSqliteAuthority
  >['getExternalExecutionForAttempt'];
  getProjectSourceReadAuthority: ReturnType<
    typeof openCliSqliteAuthority
  >['getProjectSourceReadAuthority'];
  getWorkerEventReceipt: ReturnType<typeof openCliSqliteAuthority>['getWorkerEventReceipt'];
}

export interface M251TrustedProductionInspection {
  getAcceptanceAuthority(
    workflowId: Parameters<
      ReturnType<typeof openCliSqliteAuthority>['getAcceptanceAuthorityForWorkflow']
    >[0],
    policyBundleId: Parameters<
      ReturnType<typeof openCliSqliteAuthority>['getAcceptanceAuthorityForWorkflow']
    >[1],
  ): AcceptanceAuthorityView | undefined;
  getGoalAuthority(goalId: GoalId): GoalStatusAuthoritySnapshot | undefined;
  getIntakeAuthority(intakeRunId: string): IntakeAuthorityView | undefined;
  getInstalledAuthority(): Readonly<Pick<InstalledM251ExecutionAuthority, 'policy' | 'profile'>>;
  getProcessedCommand(
    commandId: Parameters<ReturnType<typeof openCliSqliteAuthority>['getProcessedCommand']>[0],
  ): ProcessedCommandView | undefined;
  readPhaseAuthority(observation: CodexAdapterObservationV2): M251TrustedProductionPhaseAuthority;
}

export interface M251TrustedProductionComposition {
  readonly application: CodeClosureApplication;
  readonly intakeApplication: IntakeCliApplication;
  readonly intakeRecovery: M25IntakeStartupRecoverySummary;
  readonly inspection: M251TrustedProductionInspection;
  readonly startupRecovery: StartupRecoverySummary;
  readonly profile: Readonly<{ id: string; version: string; digest: string }>;
  close(): void;
}

function sameOrWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function pathsOverlap(left: string, right: string): boolean {
  return sameOrWithin(left, right) || sameOrWithin(right, left);
}

function assertExactNormalizedAbsolutePath(path: string, field: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || path !== path.normalize('NFC')) {
    throw new TypeError(`${field} must be an exact normalized absolute path`);
  }
}

function assertSeparated(paths: readonly string[], message: string): void {
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      const leftPath = paths[left];
      const rightPath = paths[right];
      if (leftPath === undefined || rightPath === undefined || pathsOverlap(leftPath, rightPath)) {
        throw new TypeError(message);
      }
    }
  }
}

function exactExistingRealDirectory(path: string, field: string): string {
  assertExactNormalizedAbsolutePath(path, field);
  const stat = lstatSync(path);
  const real = realpathSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || real !== path) {
    throw new TypeError(`${field} must be one exact existing real directory`);
  }
  return real;
}

function exactRealDirectory(path: string, field: string): string {
  assertExactNormalizedAbsolutePath(path, field);
  mkdirSync(path, { mode: 0o700, recursive: true });
  const stat = lstatSync(path);
  const real = realpathSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || real !== path) {
    throw new TypeError(`${field} must be one exact real directory`);
  }
  return real;
}

function validatePreparedIntakeExecutionRoot(
  descriptor: PreparedIntakeExecutionRootDescriptor,
): PreparedIntakeExecutionRootDescriptor {
  const root = exactExistingRealDirectory(descriptor.root, 'M2.5.1 Intake execution root');
  const members = Object.freeze({
    codexHome: exactExistingRealDirectory(descriptor.codexHome, 'M2.5.1 Intake Codex home'),
    operationCwd: exactExistingRealDirectory(
      descriptor.operationCwd,
      'M2.5.1 Intake operation cwd',
    ),
    processHome: exactExistingRealDirectory(descriptor.processHome, 'M2.5.1 Intake process home'),
    processTemporaryDirectory: exactExistingRealDirectory(
      descriptor.processTemporaryDirectory,
      'M2.5.1 Intake process temporary directory',
    ),
  });
  const memberPaths = Object.freeze(Object.values(members));
  if (memberPaths.some((path) => path === root || !sameOrWithin(path, root))) {
    throw new TypeError('M2.5.1 Intake execution-root members must be exact descendants');
  }
  assertSeparated(memberPaths, 'M2.5.1 Intake execution-root members must be pairwise separated');
  return Object.freeze({
    root,
    ...members,
  });
}

function validateRoots(
  roots: M251TrustedProductionRoots,
  projectPath: string,
): M251TrustedProductionRoots {
  const declaredRoots = [
    roots.authorityHome,
    roots.candidateWorkspace,
    roots.credentialRoot,
    roots.projectReadWorkspace,
    roots.protectedAssetRoot,
    roots.verificationRunRoot,
  ];
  assertExactNormalizedAbsolutePath(projectPath, 'M2.5.1 source project');
  declaredRoots.forEach((path, index) =>
    assertExactNormalizedAbsolutePath(path, `M2.5.1 declared root ${String(index + 1)}`),
  );
  assertSeparated(
    [projectPath, ...declaredRoots],
    'M2.5.1 trusted production roots must be pairwise separated',
  );
  const source = exactExistingRealDirectory(projectPath, 'M2.5.1 source project');
  const prepared = Object.freeze({
    authorityHome: exactRealDirectory(roots.authorityHome, 'M2.5.1 authority home'),
    candidateWorkspace: exactRealDirectory(roots.candidateWorkspace, 'M2.5.1 Candidate workspace'),
    credentialRoot: exactRealDirectory(roots.credentialRoot, 'M2.5.1 credential root'),
    projectReadWorkspace: exactRealDirectory(
      roots.projectReadWorkspace,
      'M2.5.1 ProjectRead workspace',
    ),
    protectedAssetRoot: exactRealDirectory(roots.protectedAssetRoot, 'M2.5.1 protected-asset root'),
    verificationRunRoot: exactRealDirectory(
      roots.verificationRunRoot,
      'M2.5.1 verification-run root',
    ),
  });
  assertSeparated(
    [
      source,
      prepared.authorityHome,
      prepared.candidateWorkspace,
      prepared.credentialRoot,
      prepared.projectReadWorkspace,
      prepared.protectedAssetRoot,
      prepared.verificationRunRoot,
    ],
    'M2.5.1 trusted production roots must be pairwise separated',
  );
  return prepared;
}

function runGit(projectPath: string, arguments_: readonly string[]): string {
  return execFileSync('git', arguments_, {
    cwd: projectPath,
    encoding: 'utf8',
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    },
  }).trim();
}

function verifyProjectContract(projectPath: string, contract: M251ProductionProjectContract): void {
  const observed = observeLocalCandidateSourceIdentity(projectPath);
  if (
    runGit(projectPath, ['rev-parse', 'HEAD']) !== contract.gitCommit ||
    runGit(projectPath, ['rev-parse', 'HEAD^{tree}']) !== contract.gitTree ||
    observed.sourceTreeDigest !== contract.sourceTreeDigest ||
    observed.sourceGitMetadataDigest !== contract.sourceGitMetadataDigest ||
    runGit(projectPath, ['status', '--porcelain=v2']).length !== 0
  ) {
    throw new TypeError('M2.5.1 source project does not match the exact bounded contract');
  }
}

function fileDigest(path: string): Sha256Digest {
  return sha256Digest(`sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
}

function noLocalWorkerFallback(): WorkerPort {
  return Object.freeze({
    run(): AsyncIterable<never> {
      throw new TypeError('M2.5.1 formal Profile has no local Worker fallback');
    },
  });
}

function noLegacyVerificationFallback(): VerificationPort {
  return Object.freeze({
    run: () => {
      throw new TypeError('M2.5.1 formal Profile requires protected local verification');
    },
  });
}

function publishNonAuthoritativeObservation<T>(
  sink: ((value: T) => void) | undefined,
  value: T,
): void {
  if (sink === undefined) {
    return;
  }
  try {
    sink(value);
  } catch {
    // Assessment observation cannot participate in product execution authority.
  }
}

function validateGoal(
  goal: Goal,
  projectPath: string,
  contract: M251ProductionProjectContract,
): void {
  const required = goal.successCriteria.filter(({ required }) => required);
  if (
    goal.scope.projectPath !== projectPath ||
    JSON.stringify(goal.scope.allowedPaths) !== JSON.stringify(contract.allowedPaths) ||
    required.length !== 1 ||
    required[0]?.description !== contract.expectedResult
  ) {
    throw new TypeError('Goal does not match the bounded M2.5.1 protected-verification contract');
  }
}

/**
 * Trusted M2.5.1 production graph. The optional contract/clock/ID controls are
 * accepted only when the activation is the named explicit protocol-fixture
 * seam used by deterministic composition tests.
 */
function createM251TrustedProductionCompositionWithOwnedAssistant(
  options: CreateM251TrustedProductionCompositionOptions,
): M251TrustedProductionComposition {
  const usingFixture = options.activation.kind === 'EXPLICIT_PROTOCOL_FIXTURE';
  if (
    !usingFixture &&
    (options.projectContract !== undefined ||
      options.clock !== undefined ||
      options.ids !== undefined ||
      options.candidateSourceFixture !== undefined)
  ) {
    throw new TypeError('Production M2.5.1 composition rejects deterministic fixture controls');
  }
  const contract = options.projectContract ?? M251_PAYMENT_DEMO_PROJECT_CONTRACT;
  const roots = validateRoots(options.roots, options.projectPath);
  const projectPath = realpathSync(options.projectPath);
  if (
    options.activation.operationRoots.length === 0 ||
    new Set(options.activation.operationRoots).size !== options.activation.operationRoots.length
  ) {
    throw new TypeError('M2.5.1 activation has an incomplete controlled-root set');
  }
  options.activation.operationRoots.forEach((path, index) =>
    assertExactNormalizedAbsolutePath(path, `M2.5.1 operation root ${String(index + 1)}`),
  );
  assertSeparated(
    [
      projectPath,
      roots.authorityHome,
      roots.candidateWorkspace,
      roots.credentialRoot,
      roots.projectReadWorkspace,
      roots.protectedAssetRoot,
      roots.verificationRunRoot,
      ...options.activation.operationRoots,
    ],
    'M2.5.1 source, authority, and operation roots must be separated',
  );
  const operationRoots = Object.freeze(
    options.activation.operationRoots.map((path, index) =>
      exactRealDirectory(path, `M2.5.1 operation root ${String(index + 1)}`),
    ),
  );
  if (!operationRoots.includes(options.activation.sharedProfile.controlledStateRootIdentity)) {
    throw new TypeError('M2.5.1 activation has an incomplete controlled-root set');
  }
  const separatedRoots = [
    projectPath,
    roots.authorityHome,
    roots.candidateWorkspace,
    roots.credentialRoot,
    roots.projectReadWorkspace,
    roots.protectedAssetRoot,
    roots.verificationRunRoot,
    ...operationRoots,
  ];
  assertSeparated(
    separatedRoots,
    'M2.5.1 source, authority, and operation roots must be separated',
  );
  const intakeExecutionRoot = validatePreparedIntakeExecutionRoot(
    options.intakeAssistant.prepare(),
  );
  assertSeparated(
    [...separatedRoots, intakeExecutionRoot.root],
    'M2.5.1 Intake, source, authority, and operation roots must be separated',
  );
  if (
    options.activation.sharedProfile.codexVersion !== 'codex-cli 0.146.1' ||
    options.activation.sharedProfile.protocolSnapshotDigest !==
      'sha256:312156edfdf765f134ce5f754419a9509fd34186798a1bdbb0c219ac7c19c610' ||
    options.activation.capabilityRecord.binaryIdentityDigest !==
      sha256Digest(options.activation.sharedProfile.delegatedExecutableDigest) ||
    options.activation.capabilityRecord.protocolSchemaDigest !==
      sha256Digest(options.activation.sharedProfile.protocolSnapshotDigest)
  ) {
    throw new TypeError('M2.5.1 activation does not bind the pinned shared toolchain identity');
  }
  verifyProjectContract(projectPath, contract);
  const protectedCheckPath = realpathSync(options.protectedCheckPath);
  if (
    !sameOrWithin(protectedCheckPath, roots.protectedAssetRoot) ||
    fileDigest(protectedCheckPath) !==
      'sha256:16a4a1c6c18dddc972cd8e51507f4e22d1c78b172da871687bca1d9d44f604af'
  ) {
    throw new TypeError('M2.5.1 protected checker does not match the frozen asset');
  }
  const clock = options.clock ?? new SystemUtcClock();
  const ids = options.ids ?? new CryptographicIdentityGenerator();
  const digests = new CanonicalJsonSha256DigestProvider();
  const canonicalizer = new Rfc8785Canonicalizer();
  const store = openCliSqliteAuthority({
    dataHomePath: roots.authorityHome,
    protectedPaths: Object.freeze([
      Object.freeze({ kind: ProtectedPathKind.PROJECT, path: projectPath }),
      Object.freeze({ kind: ProtectedPathKind.CANDIDATE, path: roots.candidateWorkspace }),
    ]),
    allowedProjectPaths: Object.freeze([projectPath]),
    ...(options.expectedUserId === undefined ? {} : { expectedUserId: options.expectedUserId }),
    ...(options.busyTimeoutMilliseconds === undefined
      ? {}
      : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
  });
  try {
    const workerForbiddenRoots = Object.freeze(
      [
        roots.authorityHome,
        roots.credentialRoot,
        roots.protectedAssetRoot,
        roots.verificationRunRoot,
        projectPath,
        ...operationRoots,
      ].toSorted(),
    );
    const localVerificationForbiddenRoots = Object.freeze(
      [
        roots.authorityHome,
        roots.credentialRoot,
        roots.protectedAssetRoot,
        projectPath,
        roots.projectReadWorkspace,
        ...operationRoots,
      ].toSorted(),
    );
    for (const phase of options.activation.phaseAuthorities) {
      const expectedAllowed =
        phase.phase === WorkflowPhase.IMPLEMENT
          ? roots.candidateWorkspace
          : roots.projectReadWorkspace;
      const expectedForbidden = Object.freeze(
        [
          ...workerForbiddenRoots,
          phase.phase === WorkflowPhase.IMPLEMENT
            ? roots.projectReadWorkspace
            : roots.candidateWorkspace,
        ].toSorted(),
      );
      if (
        JSON.stringify(phase.allowedRoots) !== JSON.stringify([expectedAllowed]) ||
        JSON.stringify(phase.forbiddenRoots) !== JSON.stringify(expectedForbidden)
      ) {
        throw new TypeError('M2.5.1 activation roots do not bind trusted production roots');
      }
    }
    const authority = installM251ExecutionAuthority({
      store,
      clock,
      ids,
      digests,
      capabilityRecord: options.activation.capabilityRecord,
      managedRequirementsDigest: sha256Digest(
        options.activation.sharedProfile.managedRequirementsDigest,
      ),
      controlledStateRootIdentity: options.activation.sharedProfile.controlledStateRootIdentity,
      environmentProjectionDigest: sha256Digest(
        options.activation.sharedProfile.nonSecretEnvironmentDigest,
      ),
      model: options.activation.sharedProfile.model,
      modelProvider: options.activation.sharedProfile.modelProvider,
      serviceTier: options.activation.sharedProfile.serviceTier,
      reasoningEffort: options.activation.sharedProfile.reasoningEffort,
      phaseAuthorities: options.activation.phaseAuthorities,
    });
    const admissionPolicy = createM25AdmissionPolicy(
      createM251ProductionAdmissionPolicyDefinition({
        projectPath,
        allowedPaths: contract.allowedPaths,
      }),
      digests,
    );
    const admissionInstall = store.installIntentAdmissionPolicy({
      policy: admissionPolicy,
      installedAt: clock.now(),
      auditEventId: ids.nextAuditEventId(),
      payloadDigest: admissionPolicy.digest,
    });
    if (admissionInstall.status === 'POLICY_CONFLICT') {
      throw new TypeError('M2.5.1 Intake Admission Policy conflicts with retained authority');
    }

    const projectReadWorkspace = createLocalProjectReadWorkspace({
      authorityRoots: Object.freeze([
        roots.authorityHome,
        roots.candidateWorkspace,
        roots.credentialRoot,
        roots.protectedAssetRoot,
        roots.verificationRunRoot,
        ...operationRoots,
      ]),
      ownerId: 'codeclosure-m2-5-1-project-read',
      workspaceRoot: roots.projectReadWorkspace,
    });
    const candidateWorkspace = createLocalCandidateWorkspace({
      authorityRoots: Object.freeze([
        roots.authorityHome,
        roots.credentialRoot,
        roots.projectReadWorkspace,
        roots.protectedAssetRoot,
        ...operationRoots,
      ]),
      ownerId: 'codeclosure-m2-5-1-candidate',
      workspaceRoot: roots.candidateWorkspace,
    });
    const protectedAsset = inspectProtectedVerificationAsset({
      logicalAssetId: M251_PAYMENT_DEMO_PROTECTED_CHECK_ID,
      registeredProtectedRootIdentity: roots.protectedAssetRoot,
      executionPath: protectedCheckPath,
    });
    const protectedAssets = createProtectedAssetReadLeaseAuthority({
      protectedRoots: Object.freeze([roots.protectedAssetRoot]),
    });
    const nodeExecutable = realpathSync(process.execPath);
    const semanticCheck = Object.freeze({
      schemaVersion: 1 as const,
      checkVersion: M251_PAYMENT_DEMO_PROTECTED_CHECK_VERSION,
      producerIdentity: M251_VERIFICATION_RUNNER_ID,
      operation: 'local-command.execute',
      runnerIdentity: M251_VERIFICATION_RUNNER_ID,
      runnerVersion: M251_VERIFICATION_RUNNER_VERSION,
      executablePath: nodeExecutable,
      executableDigest: fileDigest(nodeExecutable),
      declaredToolVersion: process.version,
      argv: Object.freeze([
        '--input-type=module',
        '--eval',
        M251_PROTECTED_NODE_MODULE_LAUNCHER,
        protectedAsset.executionPath,
        '.',
      ]),
      cwd: '.',
      environmentVariables: Object.freeze([]),
      isolationProfileId: DARWIN_SEATBELT_PROFILE_ID,
      isolationProfileDigest: darwinSeatbeltProtectedProfileDigest(),
      timeoutMilliseconds: 10_000,
      terminationGraceMilliseconds: 250,
      stdoutLimitBytes: 4_096,
      stderrLimitBytes: 4_096,
      totalOutputLimitBytes: 8_192,
      payloadRetentionLimitBytes: 8_192,
      acceptedExitCodes: Object.freeze([0]),
    });
    const localVerification = Object.freeze({
      workspace: candidateWorkspace,
      runner: createLocalCommandVerificationRunner({
        workspaceLeases: candidateWorkspace,
        protectedAssets,
        runnerIdentity: M251_VERIFICATION_RUNNER_ID,
        runnerVersion: M251_VERIFICATION_RUNNER_VERSION,
        isolation: createDarwinSeatbeltIsolation({
          runRootBase: roots.verificationRunRoot,
          credentialRoots: Object.freeze([roots.credentialRoot]),
        }),
      }),
      profile: Object.freeze({
        forbiddenRoots: Object.freeze(localVerificationForbiddenRoots),
        check: Object.freeze({
          version: semanticCheck.checkVersion,
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
      }),
    });
    const installedExternalProfile = authority.profile.profile;
    if (
      installedExternalProfile.schemaVersion !== 2 ||
      installedExternalProfile.externalExecution.schemaVersion !== 3
    ) {
      throw new TypeError('M2.5.1 installed Profile lost its v3 external authority');
    }
    const externalWorker = options.activation.createExternalWorker({
      authority: store,
      clock,
      expectedExternalProfile: installedExternalProfile.externalExecution,
      forbiddenRoots: Object.freeze(
        [...workerForbiddenRoots, roots.projectReadWorkspace].toSorted(),
      ),
      ...(options.observationSink?.onAdapterObservation === undefined
        ? {}
        : {
            onAdapterObservation: (observation: CodexAdapterObservationV2) =>
              publishNonAuthoritativeObservation(
                (value) => options.observationSink?.onAdapterObservation?.(value),
                observation,
              ),
          }),
      workspace: candidateWorkspace,
    });
    const recovery = createRecoveryCoordinator({
      store,
      clock,
      ids,
      digests,
      policyBundleId: authority.policy.bundle.id,
      policyBundleDigest: authority.policy.bundle.digest,
      inspector: new M1LocalRecoveryInspector(digests),
      externalProcessReconciler: createCodexExternalProcessReconciler(),
      inspectorVersion: 'm2-5-1-local-recovery-inspector-v1',
      recoveryPolicyVersion: 'm2-5-1-exact-authority-recovery-v1',
    });
    const startupRecovery = recovery.recoverOnStartup();
    const reconcileProjectRead = () =>
      reconcileProjectReadSnapshots({
        store,
        workspace: projectReadWorkspace,
        clock,
        identities: ids,
        digests,
      });
    reconcileProjectRead();
    const compiler = new MinimalContextCompiler({
      compilerVersion: 'm2-5-1-context-compiler-v1',
      maxPackageBytes: 256 * 1024,
      canonicalizer,
      digests,
    });

    const driverForGoal = (goalIdentifier: GoalId) => {
      const retained = store.getGoalWithWorkflow(goalIdentifier);
      if (retained === undefined) {
        throw new TypeError('M2.5.1 Start target is unavailable');
      }
      validateGoal(retained.goal, projectPath, contract);
      const registry = createM251RuntimeProfileRegistry(
        authority.profile,
        Object.freeze({
          worker: noLocalWorkerFallback(),
          candidateSource: options.candidateSourceFixture ?? candidateWorkspace,
          verification: noLegacyVerificationFallback(),
          externalWorker,
          projectRead: Object.freeze({ workspace: projectReadWorkspace, identities: ids }),
          localCommandVerification: localVerification,
          protectedVerification: Object.freeze({
            identities: ids,
            proposal: Object.freeze({
              acceptanceCriticalCriterionIds: Object.freeze(
                retained.goal.successCriteria
                  .filter(({ required }) => required)
                  .map(({ id }) => id)
                  .toSorted(),
              ),
              acceptanceRuleIds: Object.freeze(
                [...authority.policy.bundle.acceptanceRules].toSorted(),
              ),
              semanticCheckTemplate: semanticCheck,
              protectedAssets: Object.freeze([protectedAsset]),
              protectedAssetManifestDigest: protectedVerificationAssetManifestDigest([
                protectedAsset,
              ]),
              protectedAssetReadLeasePolicy:
                ProtectedAssetReadLeasePolicy.EXACT_READ_ONLY_SINGLE_INVOCATION,
              derivationRule: 'BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1' as const,
              authoritySource: 'TRUSTED_RUNTIME_COMPOSITION' as const,
            }),
            assets: protectedAssets,
          }),
        }),
        digests,
      );
      return createProtectedM2WorkflowDriver({
        store,
        clock,
        ids,
        digests,
        contextFactory: Object.freeze({
          compile: (request: Parameters<MinimalContextCompiler['compile']>[0]) =>
            compiler.compile(request),
        }),
        policyBundleId: authority.policy.bundle.id,
        policyBundleDigest: authority.policy.bundle.digest,
        phaseGuards: createM1DeterministicPhaseGuardEvaluator(),
        recovery,
        startProfile: registry.startProfile,
        profiles: registry.resolver,
      });
    };
    const execution = Object.freeze({
      startGoal: async (input: Parameters<ReturnType<typeof driverForGoal>['startGoal']>[0]) => {
        const result = await driverForGoal(input.goalId).startGoal(input);
        reconcileProjectRead();
        publishNonAuthoritativeObservation(
          (value) => options.observationSink?.onOrdinaryStartResult?.(value),
          result,
        );
        return result;
      },
      resumeGoal: async (input: Parameters<ReturnType<typeof driverForGoal>['resumeGoal']>[0]) => {
        const result = await driverForGoal(input.goalId).resumeGoal(input);
        reconcileProjectRead();
        return result;
      },
      cancelGoal: (input: Parameters<ReturnType<typeof driverForGoal>['cancelGoal']>[0]) => {
        const result = driverForGoal(input.goalId).cancelGoal(input);
        reconcileProjectRead();
        return result;
      },
      repairGoal: async (input: Parameters<ReturnType<typeof driverForGoal>['repairGoal']>[0]) => {
        const result = await driverForGoal(input.goalId).repairGoal(input);
        reconcileProjectRead();
        return result;
      },
    });
    const application = createCodeClosureApplication({
      store,
      clock,
      creationIds: ids,
      digests,
      projectPaths: createNormalizedProjectPathPort(),
      execution,
    });
    const startComposition: IntakeStartCompositionPort = Object.freeze({
      startGoal: (input: Parameters<IntakeStartCompositionPort['startGoal']>[0]) =>
        application.startGoal(input),
      getProcessedCommand: (
        commandId: Parameters<IntakeStartCompositionPort['getProcessedCommand']>[0],
      ) => store.getProcessedCommand(commandId),
      getWorkflow: (workflowId: Parameters<IntakeStartCompositionPort['getWorkflow']>[0]) =>
        store.getWorkflow(workflowId),
      getExecutionProfileBinding: (
        workflowId: Parameters<IntakeStartCompositionPort['getExecutionProfileBinding']>[0],
      ) => store.getExecutionProfileBinding(workflowId),
      getWorkflowPolicyBinding: (
        workflowId: Parameters<IntakeStartCompositionPort['getWorkflowPolicyBinding']>[0],
      ) => store.getWorkflowPolicyBinding(workflowId),
    });
    const coordinator = new M25IntakeCoordinator({
      store,
      assistant: options.intakeAssistant.assistant,
      packageCompiler: new M251IntakePackageCompiler({ canonicalizer, digests }),
      projectionCompiler: new M251TrustedIntentProjectionCompiler({ canonicalizer, digests }),
      admissionEngine: new M25IntentAdmissionEngine(digests, {
        governedExecutionPreflight: authority.governedExecutionPreflight,
      }),
      admissionPolicyId: admissionPolicy.id,
      governedExecutionPreflight: authority.governedExecutionPreflight,
      startComposition,
      clock,
      digests,
      ids,
    });
    const intakeRecovery = coordinator.reconcileStartup();
    const inspection: M251TrustedProductionInspection = Object.freeze({
      getAcceptanceAuthority: (workflowId: WorkflowId, policyBundleId: PolicyBundleId) =>
        store.getAcceptanceAuthorityForWorkflow(workflowId, policyBundleId),
      getGoalAuthority: (goalId: GoalId) => store.getGoalStatusAuthority(goalId),
      getIntakeAuthority: (intakeRunId: string) => store.getIntakeAuthority(intakeRunId),
      getInstalledAuthority: () =>
        Object.freeze({ policy: authority.policy, profile: authority.profile }),
      getProcessedCommand: (commandId: CommandId) => store.getProcessedCommand(commandId),
      readPhaseAuthority: (adapterObservation: CodexAdapterObservationV2) => {
        const selectedAttemptId = attemptId(adapterObservation.requestAttemptId);
        const attempt = store.getAttempt(selectedAttemptId);
        const externalRecord = store.getExternalExecutionForAttempt(selectedAttemptId);
        const contextManifest =
          attempt?.contextManifestId === undefined
            ? undefined
            : store.getContextManifest(attempt.contextManifestId);
        const workerEventReceipt =
          adapterObservation.resultEventId === undefined
            ? undefined
            : store.getWorkerEventReceipt(workerEventId(adapterObservation.resultEventId));
        if (
          attempt === undefined ||
          externalRecord === undefined ||
          contextManifest === undefined ||
          workerEventReceipt === undefined ||
          externalRecord.attemptId !== attempt.id ||
          contextManifest.attemptId !== attempt.id ||
          workerEventReceipt.attemptId !== attempt.id
        ) {
          throw new TypeError('M2.5.1 phase inspection lacks exact retained authority');
        }
        const projectReadAuthority =
          externalRecord.schemaVersion === 2 &&
          externalRecord.sourceAuthority.kind === 'PROJECT_READ'
            ? store.getProjectSourceReadAuthority(
                externalRecord.sourceAuthority.projectReadAuthorityId,
              )
            : undefined;
        if (
          externalRecord.schemaVersion === 2 &&
          externalRecord.sourceAuthority.kind === 'PROJECT_READ' &&
          projectReadAuthority === undefined
        ) {
          throw new TypeError('M2.5.1 phase inspection lacks ProjectRead authority');
        }
        return Object.freeze({
          adapterObservation,
          attempt,
          contextManifest,
          externalRecord,
          ...(projectReadAuthority === undefined ? {} : { projectReadAuthority }),
          workerEventReceipt,
        });
      },
    });
    const declaredProjectRef = (declaredProjectPath: string | undefined) => {
      if (declaredProjectPath === undefined) {
        return undefined;
      }
      if (realpathSync(declaredProjectPath) !== projectPath) {
        throw new TypeError('M2.5.1 Intake declared another project');
      }
      return Object.freeze({
        schemaVersion: 1 as const,
        normalizedPath: projectPath,
        identityDigest: digests.digest({ normalizedPath: projectPath }),
      });
    };
    let closed = false;
    return Object.freeze({
      application,
      intakeApplication: Object.freeze({
        submit: (input) => {
          const projectRef = declaredProjectRef(input.declaredProjectPath);
          return coordinator.submit({
            commandId: input.commandId,
            interactionAction: input.interactionAction,
            admittedUserContent: input.admittedUserContent,
            ...(projectRef === undefined ? {} : { declaredProjectRef: projectRef }),
            ...(input.declaredConstraints === undefined
              ? {}
              : { declaredConstraints: input.declaredConstraints }),
          });
        },
        clarify: (input) => {
          const projectRef = declaredProjectRef(input.declaredProjectPath);
          return coordinator.clarify({
            commandId: input.commandId,
            intakeRunId: input.intakeRunId,
            expectedIntakeRunVersion: input.expectedIntakeRunVersion,
            clarificationQuestionId: input.clarificationQuestionId,
            answer: input.answer,
            ...(projectRef === undefined ? {} : { declaredProjectRef: projectRef }),
          });
        },
        abandon: (input) => coordinator.abandon(input),
        getStatus: (intakeRunId) => coordinator.getStatus(intakeRunId),
        getAudit: (intakeRunId) => coordinator.getAudit(intakeRunId),
      } satisfies IntakeCliApplication),
      intakeRecovery,
      inspection,
      startupRecovery,
      profile: Object.freeze({
        id: authority.profile.profile.id,
        version: authority.profile.profile.version,
        digest: authority.profile.profile.digest,
      }),
      close: (): void => {
        if (!closed) {
          closed = true;
          const closeErrors: unknown[] = [];
          try {
            store.close();
          } catch (error) {
            closeErrors.push(error);
          }
          try {
            options.intakeAssistant.close();
          } catch (error) {
            closeErrors.push(error);
          }
          if (closeErrors.length === 1) {
            throw closeErrors[0];
          }
          if (closeErrors.length > 1) {
            throw new AggregateError(
              closeErrors,
              'M2.5.1 production composition resources could not close',
            );
          }
        }
      },
    });
  } catch (error) {
    try {
      store.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'M2.5.1 production composition failed and its authority could not close',
        { cause: closeError },
      );
    }
    throw error;
  }
}

export function createM251TrustedProductionComposition(
  options: CreateM251TrustedProductionCompositionOptions,
): M251TrustedProductionComposition {
  try {
    return createM251TrustedProductionCompositionWithOwnedAssistant(options);
  } catch (error) {
    try {
      options.intakeAssistant.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'M2.5.1 production composition failed and its Intake resource could not close',
        { cause: closeError },
      );
    }
    throw error;
  }
}
