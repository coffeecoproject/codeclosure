import {
  ExternalPhaseCwdKind,
  ExternalPhaseSourceAuthorityKind,
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSnapshotCleanupEligibilityKind,
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
