import {
  AttemptStatus,
  ExternalExecutionState,
  ExternalPhaseCwdKind,
  ExternalPhaseSourceAuthorityKind,
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSnapshotCleanupEligibilityKind,
  ProjectReadSnapshotCleanupDisposition,
  ProjectReadSnapshotCleanupLifecyclePolicy,
  ProjectReadSourceCheckoutAccess,
  WorkflowPhase,
  auditEventId,
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectSourceReadAuthorityRecord,
  externalExecutionPhaseDispatchEntryProjection,
  latestIsoTimestamp,
  projectReadSnapshotCleanupGrantId,
  projectReadSnapshotCleanupGrantProjection,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectSourceReadAuthorityId,
  projectSourceReadAuthorityProjection,
  sha256Digest,
  type AuditEventId,
  type ExecutionProfile,
  type ExternalExecutionRecord,
  type Goal,
  type IsoTimestamp,
  type PolicyBundle,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectReadSnapshotCleanupGrantId,
  type ProjectReadSnapshotCleanupOutcome,
  type ProjectReadSnapshotId,
  type ProjectReadWorkspaceAuthoritySnapshotId,
  type ProjectSourceReadAuthorityId,
  type ProjectSourceReadAuthorityRecord,
  type WorkflowInstance,
  type Attempt,
} from '@codeclosure/domain';

import { m1WorkerResponseContract } from './context-compiler.js';
import {
  M251CandidateFreezeProfileClassification,
  classifyM251CandidateFreezeProfile,
} from './m251-execution-profile.js';
import type { Clock, DigestProvider } from './ports.js';
import {
  ProjectReadSnapshotCleanupCoordinatorStatus,
  createProjectReadSnapshotCleanupCoordinator,
  type ProjectReadSnapshotCleanupCoordinatorResult,
} from './project-read-cleanup-coordinator.js';
import type { ProjectReadCleanupControlStore } from './project-read-cleanup-store.js';
import {
  ProjectReadWorkspaceClassification,
  assertProjectReadSnapshotMaterializationReceiptMatchesRecord,
  assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot,
  createProjectReadOwnershipMarker,
  decodeProjectReadSnapshotMaterializationReceipt,
  decodeProjectReadSourceObservation,
  decodeProjectReadWorkspaceAuthoritySnapshot,
  decodeProjectReadWorkspaceObservation,
  type ProjectReadWorkspaceAuthoritySnapshot,
  type ProjectReadWorkspaceObservation,
} from './project-read-workspace-contracts.js';
import type { ProjectReadWorkspacePort } from './project-read-workspace-port.js';
import { digestProjectReadSnapshotCleanupValue } from './project-read-snapshot-cleanup-contracts.js';

export interface ProjectReadAttemptIdentityGenerator {
  nextProjectSourceReadAuthorityId(): ProjectSourceReadAuthorityId;
  nextProjectReadSnapshotId(): ProjectReadSnapshotId;
  nextProjectReadWorkspaceAuthoritySnapshotId(): ProjectReadWorkspaceAuthoritySnapshotId;
  nextProjectReadSnapshotCleanupGrantId(): ProjectReadSnapshotCleanupGrantId;
  nextProjectReadSnapshotCleanupOutcomeId(): ProjectReadSnapshotCleanupOutcome['id'];
  nextAuditEventId(): AuditEventId;
}

export interface ProjectReadAttemptRuntimeDependencies {
  readonly workspace: ProjectReadWorkspacePort;
  readonly identities: ProjectReadAttemptIdentityGenerator;
}

export interface PrepareProjectReadAttemptAuthorityInput {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly attempt: Extract<Attempt, { readonly status: 'RUNNING' }>;
  readonly policyBundle: PolicyBundle;
  readonly executionProfile: ExecutionProfile;
  readonly issuedAt: IsoTimestamp;
  readonly authorityId: ProjectSourceReadAuthorityId;
  readonly snapshotId: ProjectReadSnapshotId;
}

export interface PreparedProjectReadAttemptAuthority {
  readonly record: ProjectSourceReadAuthorityRecord;
  readonly cleanupGrantId: ProjectReadSnapshotCleanupGrantId;
}

export interface ProjectReadOrphanReconciliationDependencies {
  readonly store: ProjectReadCleanupControlStore;
  readonly workspace: ProjectReadWorkspacePort;
  readonly clock: Clock;
  readonly identities: ProjectReadAttemptIdentityGenerator;
  readonly digests: DigestProvider;
}

export interface ProjectReadTerminalCleanupStore extends ProjectReadCleanupControlStore {
  getProjectReadSnapshotCleanupGrantForAuthority(
    projectReadAuthorityId: ProjectSourceReadAuthorityId,
  ): ProjectReadSnapshotCleanupGrant | undefined;
  getProjectSourceReadAuthority(
    id: ProjectSourceReadAuthorityId,
  ): ProjectSourceReadAuthorityRecord | undefined;
  getAttempt(id: Attempt['id']): Attempt | undefined;
  getExternalExecutionForAttempt(attemptId: Attempt['id']): ExternalExecutionRecord | undefined;
}

export interface ProjectReadTerminalCleanupDependencies {
  readonly store: ProjectReadTerminalCleanupStore;
  readonly workspace: ProjectReadWorkspacePort;
  readonly clock: Clock;
  readonly identities: ProjectReadAttemptIdentityGenerator;
  readonly digests: DigestProvider;
}

export interface ProjectReadTerminalCleanupSummary {
  readonly authoritySnapshotId: ProjectReadWorkspaceAuthoritySnapshotId;
  readonly observedSnapshotCount: number;
  readonly resolvedOrphanCount: number;
  readonly resolvedTerminalCount: number;
}

export type ProjectReadOrphanReconciliationResult =
  | Readonly<{ readonly status: 'NO_ORPHAN' }>
  | Readonly<{
      readonly status: 'CLEANUP_RESOLVED';
      readonly grant: ProjectReadSnapshotCleanupGrant;
      readonly cleanup: ProjectReadSnapshotCleanupCoordinatorResult & {
        readonly status: typeof ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED;
      };
    }>
  | Readonly<{
      readonly status: 'CLEANUP_UNRESOLVED';
      readonly grant: ProjectReadSnapshotCleanupGrant;
      readonly cleanup: Extract<
        ProjectReadSnapshotCleanupCoordinatorResult,
        { readonly status: typeof ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED }
      >;
    }>
  | Readonly<{
      readonly status: 'CLEANUP_REJECTED';
      readonly grant: ProjectReadSnapshotCleanupGrant;
      readonly cleanup: Extract<
        ProjectReadSnapshotCleanupCoordinatorResult,
        { readonly status: typeof ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED }
      >;
    }>;

function exactPhaseEntry(input: PrepareProjectReadAttemptAuthorityInput, digests: DigestProvider) {
  const profile = input.executionProfile;
  if (
    classifyM251CandidateFreezeProfile(profile) !==
      M251CandidateFreezeProfileClassification.M251_FREEZE_V2 ||
    profile.schemaVersion !== 2 ||
    profile.externalExecution.schemaVersion !== 3
  ) {
    throw new TypeError('Project-read Attempt requires the exact formal M2.5.1 Profile');
  }
  const phase = input.attempt.phase;
  if (phase !== WorkflowPhase.DISCOVERY && phase !== WorkflowPhase.PLAN) {
    throw new TypeError('Project-read Attempt authority is limited to candidate-free phases');
  }
  const entry = profile.externalExecution.phaseDispatch.find(
    (candidate) => candidate.phase === phase,
  );
  const capabilityGrantDigest = digests.digest({
    schemaVersion: 1,
    capabilityGrant: input.attempt.capabilityGrant,
  });
  const responseContractDigest = digests.digest({
    schemaVersion: 1,
    responseContract: m1WorkerResponseContract(phase),
  });
  if (
    entry?.cwdKind !== ExternalPhaseCwdKind.PROJECT_READ_SNAPSHOT ||
    entry.sourceAuthorityKind !== ExternalPhaseSourceAuthorityKind.PROJECT_READ ||
    entry.capabilityGrantDigest !== capabilityGrantDigest ||
    entry.responseContractDigest !== responseContractDigest
  ) {
    throw new TypeError('M2.5.1 candidate-free phase authority is incomplete');
  }
  return Object.freeze({
    entry,
    phaseDispatchEntryDigest: digests.digest(externalExecutionPhaseDispatchEntryProjection(entry)),
    capabilityGrantDigest,
    responseContractDigest,
  });
}

export function authorProjectReadAttemptAuthorityRecord(
  input: PrepareProjectReadAttemptAuthorityInput,
  dependencies: Pick<ProjectReadAttemptRuntimeDependencies, 'workspace'> & {
    readonly digests: DigestProvider;
  },
): ProjectSourceReadAuthorityRecord {
  if (
    input.workflow.goalId !== input.goal.id ||
    input.workflow.goalRevision !== input.goal.revision ||
    input.workflow.phase !== input.attempt.phase ||
    input.workflow.activeAttemptId !== input.attempt.id ||
    input.attempt.startedAt > input.issuedAt
  ) {
    throw new TypeError('Project-read authority input is not one exact active Attempt');
  }
  const selected = exactPhaseEntry(input, dependencies.digests);
  const phase = input.attempt.phase;
  if (phase !== WorkflowPhase.DISCOVERY && phase !== WorkflowPhase.PLAN) {
    throw new TypeError('Project-read Attempt authority is limited to candidate-free phases');
  }
  const authorityId = projectSourceReadAuthorityId(input.authorityId);
  const snapshotId = projectReadSnapshotId(input.snapshotId);
  const source = decodeProjectReadSourceObservation(
    dependencies.workspace.observeSource({
      schemaVersion: 1,
      normalizedProjectRoot: input.goal.scope.projectPath,
    }),
  );
  if (source.normalizedProjectRoot !== input.goal.scope.projectPath) {
    throw new TypeError('Project-read source observation substituted the Goal project root');
  }
  const workspaceRootIdentity = dependencies.workspace.workspaceRootIdentity;
  const snapshotLeafRealpath = dependencies.workspace.snapshotLeafFor(snapshotId);
  if (!selected.entry.allowedRoots.includes(workspaceRootIdentity)) {
    throw new TypeError('M2.5.1 phase authority does not admit the project-read workspace root');
  }
  const forbiddenRoots = Object.freeze(
    [
      ...new Set([
        ...selected.entry.forbiddenRoots,
        source.normalizedProjectRoot,
        source.resolvedProjectRoot,
      ]),
    ].toSorted(),
  );
  const marker = createProjectReadOwnershipMarker({
    schemaVersion: 1,
    profile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    projectReadAuthorityId: authorityId,
    snapshotId,
    workspaceRootIdentity,
    snapshotLeafRealpath,
    snapshotTreeDigest: source.sourceTree.projectionDigest,
  });
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    id: authorityId,
    goalId: input.goal.id,
    goalRevision: input.goal.revision,
    workflowId: input.workflow.id,
    workflowVersion: input.workflow.version,
    phase,
    attemptId: input.attempt.id,
    normalizedProjectRoot: source.normalizedProjectRoot,
    resolvedProjectRoot: source.resolvedProjectRoot,
    repositoryControlRootIdentity: source.repositoryControlRootIdentity,
    sourceTree: source.sourceTree,
    gitState: source.gitState,
    workspaceRootIdentity,
    snapshotId,
    snapshotLeafRealpath,
    snapshotTreeDigest: source.sourceTree.projectionDigest,
    ownershipMarkerProfile: marker.profile,
    ownershipMarkerDigest: marker.markerDigest,
    policyBundleId: input.policyBundle.id,
    policyBundleVersion: input.policyBundle.version,
    policyBundleDigest: input.policyBundle.digest,
    executionProfileId: input.executionProfile.id,
    executionProfileVersion: input.executionProfile.version,
    executionProfileDigest: input.executionProfile.digest,
    phaseDispatchEntryDigest: selected.phaseDispatchEntryDigest,
    capabilityGrantDigest: selected.capabilityGrantDigest,
    responseContractDigest: selected.responseContractDigest,
    accessMode: ProjectReadSnapshotAccessMode.READ_ONLY,
    sourceCheckoutAccess: ProjectReadSourceCheckoutAccess.NONE,
    modelUsableNetworkPolicy: ProjectReadModelUsableNetworkPolicy.DENIED,
    forbiddenRoots,
    isolationProfileId: selected.entry.isolationProfileId,
    isolationProfileDigest: selected.entry.isolationProfileDigest,
    issuedAt: input.issuedAt,
    lifecyclePolicy: ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT,
    retentionPolicy: ProjectReadRetentionPolicy.RUNTIME_OWNED,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
  });
  const record = decodeProjectSourceReadAuthorityRecord({
    ...withoutDigest,
    recordDigest: sha256Digest(
      dependencies.digests.digest(projectSourceReadAuthorityProjection(withoutDigest)),
    ),
  });
  if (
    record.recordDigest !==
    dependencies.digests.digest(projectSourceReadAuthorityProjection(record))
  ) {
    throw new TypeError('Runtime-authored project-read record digest is inconsistent');
  }
  return record;
}

export function materializeProjectReadAttemptAuthority(
  rawRecord: ProjectSourceReadAuthorityRecord,
  rawCleanupGrantId: ProjectReadSnapshotCleanupGrantId,
  workspace: ProjectReadWorkspacePort,
): PreparedProjectReadAttemptAuthority {
  const record = decodeProjectSourceReadAuthorityRecord(rawRecord);
  const cleanupGrantId = projectReadSnapshotCleanupGrantId(rawCleanupGrantId);
  const receipt = decodeProjectReadSnapshotMaterializationReceipt(
    workspace.materializeSnapshot(record),
  );
  assertProjectReadSnapshotMaterializationReceiptMatchesRecord(receipt, record);
  return Object.freeze({ record, cleanupGrantId });
}

function createOrphanGrant(
  record: ProjectSourceReadAuthorityRecord,
  cleanupGrantId: ProjectReadSnapshotCleanupGrantId,
  snapshot: ProjectReadWorkspaceAuthoritySnapshot,
  observation: ReturnType<typeof decodeProjectReadWorkspaceObservation>,
  dependencies: ProjectReadOrphanReconciliationDependencies,
): ProjectReadSnapshotCleanupGrant {
  const issuedAt = latestIsoTimestamp(
    dependencies.clock.now(),
    snapshot.issuedAt,
    observation.observedAt,
  );
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    id: cleanupGrantId,
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.ORPHANED,
    authoritySnapshotId: snapshot.id,
    authoritySnapshotDigest: snapshot.authorityDigest,
    authoritySequence: snapshot.authoritySequence,
    projectReadAuthorityId: record.id,
    snapshotId: record.snapshotId,
    workspaceRootIdentity: record.workspaceRootIdentity,
    snapshotLeafRealpath: record.snapshotLeafRealpath,
    ownershipMarkerProfile: record.ownershipMarkerProfile,
    ownershipMarkerDigest: record.ownershipMarkerDigest,
    cleanupPolicy: record.cleanupPolicy,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt,
    workspaceObservationId: observation.id,
    workspaceObservationDigest: observation.observationDigest,
  });
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...withoutDigest,
      grantDigest: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupGrantProjection(withoutDigest),
      ),
    },
    dependencies.digests,
  );
}

function assertCleanupGrantMatchesRecord(
  grant: ProjectReadSnapshotCleanupGrant,
  expectedGrantId: ProjectReadSnapshotCleanupGrantId,
  record: ProjectSourceReadAuthorityRecord,
): void {
  if (
    grant.id !== expectedGrantId ||
    grant.eligibilityKind !== ProjectReadSnapshotCleanupEligibilityKind.ORPHANED ||
    grant.projectReadAuthorityId !== record.id ||
    grant.snapshotId !== record.snapshotId ||
    grant.workspaceRootIdentity !== record.workspaceRootIdentity ||
    grant.snapshotLeafRealpath !== record.snapshotLeafRealpath ||
    grant.ownershipMarkerDigest !== record.ownershipMarkerDigest
  ) {
    throw new TypeError('Retained project-read cleanup Grant does not bind the exact orphan');
  }
}

function resolveCleanupGrant(
  grant: ProjectReadSnapshotCleanupGrant,
  dependencies: ProjectReadOrphanReconciliationDependencies,
): ProjectReadOrphanReconciliationResult {
  const cleanup = createProjectReadSnapshotCleanupCoordinator({
    store: dependencies.store,
    workspace: dependencies.workspace,
    clock: dependencies.clock,
    ids: dependencies.identities,
    digests: dependencies.digests,
  }).resolve({ grant });
  switch (cleanup.status) {
    case ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED:
      return Object.freeze({ status: 'CLEANUP_RESOLVED', grant, cleanup });
    case ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED:
      return Object.freeze({ status: 'CLEANUP_UNRESOLVED', grant, cleanup });
    case ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED:
      return Object.freeze({ status: 'CLEANUP_REJECTED', grant, cleanup });
  }
}

function requireResolvedCleanup(
  grant: ProjectReadSnapshotCleanupGrant,
  dependencies: ProjectReadTerminalCleanupDependencies,
): void {
  const result = createProjectReadSnapshotCleanupCoordinator({
    store: dependencies.store,
    workspace: dependencies.workspace,
    clock: dependencies.clock,
    ids: dependencies.identities,
    digests: dependencies.digests,
  }).resolve({ grant });
  if (
    result.status !== ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED ||
    (result.outcome.disposition !== ProjectReadSnapshotCleanupDisposition.DELETED &&
      result.outcome.disposition !== ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT)
  ) {
    throw new TypeError('Project-read snapshot cleanup did not close safely');
  }
}

function retainWorkspaceObservation(
  observation: ProjectReadWorkspaceObservation,
  dependencies: ProjectReadTerminalCleanupDependencies,
): ProjectReadWorkspaceObservation {
  const result = dependencies.store.recordProjectReadWorkspaceObservation({
    observation,
    auditEventId: dependencies.identities.nextAuditEventId(),
  });
  if (result.status === 'OBSERVATION_CONFLICT') {
    throw new TypeError('Project-read reconciliation observation conflicted');
  }
  const retained = decodeProjectReadWorkspaceObservation(result.value);
  if (
    retained.id !== observation.id ||
    retained.observationDigest !== observation.observationDigest
  ) {
    throw new TypeError('Project-read Store substituted a reconciliation observation');
  }
  return retained;
}

function issueCleanupGrant(
  grant: ProjectReadSnapshotCleanupGrant,
  dependencies: ProjectReadTerminalCleanupDependencies,
): ProjectReadSnapshotCleanupGrant {
  const result = dependencies.store.issueProjectReadSnapshotCleanupGrant({
    grant,
    auditEventId: dependencies.identities.nextAuditEventId(),
  });
  if (result.status === 'GRANT_CONFLICT' || result.status === 'NOT_ELIGIBLE') {
    throw new TypeError('Project-read cleanup Grant was not admitted');
  }
  if (!('value' in result)) {
    throw new TypeError('Project-read cleanup Grant result is malformed');
  }
  const retained = decodeProjectReadSnapshotCleanupGrant(result.value, dependencies.digests);
  if (retained.id !== grant.id || retained.grantDigest !== grant.grantDigest) {
    throw new TypeError('Project-read Store substituted a cleanup Grant');
  }
  return retained;
}

function terminalCleanupGrant(
  snapshot: ProjectReadWorkspaceAuthoritySnapshot,
  record: ProjectSourceReadAuthorityRecord,
  attempt: Attempt,
  execution: ExternalExecutionRecord,
  dependencies: ProjectReadTerminalCleanupDependencies,
): ProjectReadSnapshotCleanupGrant {
  if (
    (attempt.status !== AttemptStatus.RESULT_RECORDED &&
      attempt.status !== AttemptStatus.FAILED &&
      attempt.status !== AttemptStatus.INTERRUPTED) ||
    (execution.state !== ExternalExecutionState.COMPLETED &&
      execution.state !== ExternalExecutionState.INTERRUPTED &&
      execution.state !== ExternalExecutionState.FAILED &&
      execution.state !== ExternalExecutionState.ABANDONED) ||
    execution.terminalAt === undefined
  ) {
    throw new TypeError('Project-read terminal cleanup lacks exact terminal authority');
  }
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupGrantId(
      dependencies.identities.nextProjectReadSnapshotCleanupGrantId(),
    ),
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.TERMINAL,
    authoritySnapshotId: snapshot.id,
    authoritySnapshotDigest: snapshot.authorityDigest,
    authoritySequence: snapshot.authoritySequence,
    projectReadAuthorityId: record.id,
    projectReadAuthorityRecordDigest: record.recordDigest,
    snapshotId: record.snapshotId,
    workspaceRootIdentity: record.workspaceRootIdentity,
    snapshotLeafRealpath: record.snapshotLeafRealpath,
    ownershipMarkerProfile: record.ownershipMarkerProfile,
    ownershipMarkerDigest: record.ownershipMarkerDigest,
    cleanupPolicy: record.cleanupPolicy,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: latestIsoTimestamp(
      dependencies.clock.now(),
      snapshot.issuedAt,
      attempt.endedAt,
      execution.terminalAt,
    ),
    attemptId: attempt.id,
    terminalAttemptStatus: attempt.status,
    terminalAttemptEndedAt: attempt.endedAt,
    externalExecutionId: execution.id,
    terminalExternalExecutionState: execution.state,
    terminalExternalExecutionAt: execution.terminalAt,
    terminalExternalExecutionRecordDigest: execution.recordDigest,
  });
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...withoutDigest,
      grantDigest: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupGrantProjection(withoutDigest),
      ),
    },
    dependencies.digests,
  );
}

function orphanCleanupGrant(
  snapshot: ProjectReadWorkspaceAuthoritySnapshot,
  observation: ProjectReadWorkspaceObservation,
  dependencies: ProjectReadTerminalCleanupDependencies,
): ProjectReadSnapshotCleanupGrant {
  if (
    observation.classification !== ProjectReadWorkspaceClassification.OWNED_ORPHANED ||
    observation.projectReadAuthorityId === null ||
    observation.snapshotId === null ||
    observation.ownershipMarkerProfile !== PROJECT_READ_OWNERSHIP_MARKER_PROFILE ||
    observation.ownershipMarkerDigest === null
  ) {
    throw new TypeError('Project-read orphan cleanup lacks exact owned observation');
  }
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupGrantId(
      dependencies.identities.nextProjectReadSnapshotCleanupGrantId(),
    ),
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.ORPHANED,
    authoritySnapshotId: snapshot.id,
    authoritySnapshotDigest: snapshot.authorityDigest,
    authoritySequence: snapshot.authoritySequence,
    projectReadAuthorityId: observation.projectReadAuthorityId,
    snapshotId: observation.snapshotId,
    workspaceRootIdentity: observation.workspaceRootIdentity,
    snapshotLeafRealpath: observation.snapshotLeafRealpath,
    ownershipMarkerProfile: observation.ownershipMarkerProfile,
    ownershipMarkerDigest: observation.ownershipMarkerDigest,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: latestIsoTimestamp(
      dependencies.clock.now(),
      snapshot.issuedAt,
      observation.observedAt,
    ),
    workspaceObservationId: observation.id,
    workspaceObservationDigest: observation.observationDigest,
  });
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...withoutDigest,
      grantDigest: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupGrantProjection(withoutDigest),
      ),
    },
    dependencies.digests,
  );
}

/**
 * Trusted Runtime reconciliation for terminal and pre-commit orphaned
 * ProjectRead snapshots. The workspace reports physical observations; only
 * retained Store authority can issue and consume Cleanup Grants.
 */
export function reconcileProjectReadSnapshots(
  dependencies: ProjectReadTerminalCleanupDependencies,
): ProjectReadTerminalCleanupSummary {
  const captured = dependencies.store.captureProjectReadWorkspaceAuthoritySnapshot({
    id: dependencies.identities.nextProjectReadWorkspaceAuthoritySnapshotId(),
    issuedAt: latestIsoTimestamp(dependencies.clock.now()),
    auditEventId: dependencies.identities.nextAuditEventId(),
  });
  if (captured.status === 'SNAPSHOT_CONFLICT') {
    throw new TypeError('Project-read reconciliation authority snapshot conflicted');
  }
  const snapshot = decodeProjectReadWorkspaceAuthoritySnapshot(captured.value);
  const observations = dependencies.workspace.reconcile(snapshot).map((raw) => {
    const observation = decodeProjectReadWorkspaceObservation(raw);
    assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(observation, snapshot);
    return retainWorkspaceObservation(observation, dependencies);
  });
  if (
    observations.some(
      ({ classification }) => classification === ProjectReadWorkspaceClassification.UNSAFE,
    )
  ) {
    throw new TypeError('Project-read reconciliation found an unsafe workspace entry');
  }

  let resolvedTerminalCount = 0;
  for (const expected of snapshot.expectedSnapshots) {
    if (expected.retention !== 'RETAINED') {
      continue;
    }
    const existing = dependencies.store.getProjectReadSnapshotCleanupGrantForAuthority(
      expected.projectReadAuthorityId,
    );
    if (existing !== undefined) {
      requireResolvedCleanup(existing, dependencies);
      resolvedTerminalCount += 1;
      continue;
    }
    const observation = observations.find(
      (candidate) =>
        candidate.classification === ProjectReadWorkspaceClassification.OWNED_RETAINED &&
        candidate.projectReadAuthorityId === expected.projectReadAuthorityId,
    );
    const record = dependencies.store.getProjectSourceReadAuthority(
      expected.projectReadAuthorityId,
    );
    const attempt =
      record === undefined ? undefined : dependencies.store.getAttempt(record.attemptId);
    const execution =
      record === undefined
        ? undefined
        : dependencies.store.getExternalExecutionForAttempt(record.attemptId);
    if (
      observation === undefined ||
      record === undefined ||
      attempt === undefined ||
      execution === undefined
    ) {
      throw new TypeError('Project-read retained snapshot lacks terminal cleanup authority');
    }
    const grant = issueCleanupGrant(
      terminalCleanupGrant(snapshot, record, attempt, execution, dependencies),
      dependencies,
    );
    requireResolvedCleanup(grant, dependencies);
    resolvedTerminalCount += 1;
  }

  let resolvedOrphanCount = 0;
  for (const observation of observations.filter(
    ({ classification }) => classification === ProjectReadWorkspaceClassification.OWNED_ORPHANED,
  )) {
    if (observation.projectReadAuthorityId === null) {
      throw new TypeError('Project-read orphan observation lacks authority identity');
    }
    const existing = dependencies.store.getProjectReadSnapshotCleanupGrantForAuthority(
      observation.projectReadAuthorityId,
    );
    const grant =
      existing ??
      issueCleanupGrant(orphanCleanupGrant(snapshot, observation, dependencies), dependencies);
    requireResolvedCleanup(grant, dependencies);
    resolvedOrphanCount += 1;
  }

  return Object.freeze({
    authoritySnapshotId: snapshot.id,
    observedSnapshotCount: observations.length,
    resolvedOrphanCount,
    resolvedTerminalCount,
  });
}

export function reconcileProjectReadAttemptOrphan(
  record: ProjectSourceReadAuthorityRecord,
  rawCleanupGrantId: ProjectReadSnapshotCleanupGrantId,
  dependencies: ProjectReadOrphanReconciliationDependencies,
): ProjectReadOrphanReconciliationResult {
  const cleanupGrantId = projectReadSnapshotCleanupGrantId(rawCleanupGrantId);
  const existingGrant = dependencies.store.getProjectReadSnapshotCleanupGrant(cleanupGrantId);
  if (existingGrant !== undefined) {
    const grant = decodeProjectReadSnapshotCleanupGrant(existingGrant, dependencies.digests);
    assertCleanupGrantMatchesRecord(grant, cleanupGrantId, record);
    return resolveCleanupGrant(grant, dependencies);
  }
  const authoritySnapshotId = projectReadWorkspaceAuthoritySnapshotId(
    dependencies.identities.nextProjectReadWorkspaceAuthoritySnapshotId(),
  );
  const captured = dependencies.store.captureProjectReadWorkspaceAuthoritySnapshot({
    id: authoritySnapshotId,
    issuedAt: latestIsoTimestamp(dependencies.clock.now(), record.issuedAt),
    auditEventId: auditEventId(dependencies.identities.nextAuditEventId()),
  });
  if (captured.status === 'SNAPSHOT_CONFLICT') {
    throw new TypeError('Project-read orphan reconciliation snapshot identity conflicted');
  }
  const authoritySnapshot = decodeProjectReadWorkspaceAuthoritySnapshot(captured.value);
  if (authoritySnapshot.id !== authoritySnapshotId) {
    throw new TypeError('Project-read Store substituted the reconciliation snapshot identity');
  }
  const observations = dependencies.workspace.reconcile(authoritySnapshot).map((raw) => {
    const observation = decodeProjectReadWorkspaceObservation(raw);
    assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(observation, authoritySnapshot);
    return observation;
  });
  const orphan = observations.find(
    (observation) =>
      observation.classification === ProjectReadWorkspaceClassification.OWNED_ORPHANED &&
      observation.projectReadAuthorityId === record.id &&
      observation.snapshotId === record.snapshotId &&
      observation.snapshotLeafRealpath === record.snapshotLeafRealpath &&
      observation.ownershipMarkerDigest === record.ownershipMarkerDigest,
  );
  if (orphan === undefined) {
    return Object.freeze({ status: 'NO_ORPHAN' });
  }
  const recorded = dependencies.store.recordProjectReadWorkspaceObservation({
    observation: orphan,
    auditEventId: auditEventId(dependencies.identities.nextAuditEventId()),
  });
  if (recorded.status === 'OBSERVATION_CONFLICT') {
    throw new TypeError('Project-read orphan observation identity conflicted');
  }
  const retainedObservation = decodeProjectReadWorkspaceObservation(recorded.value);
  if (
    retainedObservation.id !== orphan.id ||
    retainedObservation.observationDigest !== orphan.observationDigest
  ) {
    throw new TypeError('Project-read Store substituted the orphan observation');
  }
  const grant = createOrphanGrant(
    record,
    cleanupGrantId,
    authoritySnapshot,
    retainedObservation,
    dependencies,
  );
  const issued = dependencies.store.issueProjectReadSnapshotCleanupGrant({
    grant,
    auditEventId: auditEventId(dependencies.identities.nextAuditEventId()),
  });
  if (issued.status === 'GRANT_CONFLICT' || issued.status === 'NOT_ELIGIBLE') {
    throw new TypeError('Project-read orphan cleanup grant was not admitted');
  }
  if (!('value' in issued)) {
    throw new TypeError('Project-read orphan cleanup grant result is malformed');
  }
  const retainedGrant = decodeProjectReadSnapshotCleanupGrant(issued.value, dependencies.digests);
  if (retainedGrant.id !== grant.id || retainedGrant.grantDigest !== grant.grantDigest) {
    throw new TypeError('Project-read Store substituted the orphan cleanup Grant');
  }
  return resolveCleanupGrant(retainedGrant, dependencies);
}
