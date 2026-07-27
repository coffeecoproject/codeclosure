import {
  candidateGenerationId,
  contextManifestId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  attemptId,
  workflowId,
  workflowVersion,
  type AttemptId,
  type CandidateGenerationId,
  type ContextManifestId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type PolicyBundleId,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import {
  WorkflowPhase,
  type SuccessCriterion,
  type WorkflowPhase as WorkflowPhaseType,
} from './model.js';
import { isCanonicalCapabilityGrant, type CapabilityGrant } from './capabilities.js';

export const ContextAuthorityClass = {
  GOAL_AUTHORITY: 'GOAL_AUTHORITY',
  CONFIRMED_FACT: 'CONFIRMED_FACT',
  HUMAN_DECISION: 'HUMAN_DECISION',
  PROJECT_OBSERVATION: 'PROJECT_OBSERVATION',
  NON_AUTHORITATIVE_WORKING: 'NON_AUTHORITATIVE_WORKING',
} as const;
export type ContextAuthorityClass =
  (typeof ContextAuthorityClass)[keyof typeof ContextAuthorityClass];

export const ContextEntryKind = {
  GOAL: 'GOAL',
  SUCCESS_CRITERION: 'SUCCESS_CRITERION',
  FACT: 'FACT',
  DECISION: 'DECISION',
  PROJECT_RULE: 'PROJECT_RULE',
  PROJECT_OBSERVATION: 'PROJECT_OBSERVATION',
  WORKING_CONTEXT: 'WORKING_CONTEXT',
  CANDIDATE: 'CANDIDATE',
} as const;
export type ContextEntryKind = (typeof ContextEntryKind)[keyof typeof ContextEntryKind];

export const WorkerResultKind = {
  PROPOSALS: 'PROPOSALS',
  COMPLETION_REQUEST: 'COMPLETION_REQUEST',
} as const;
export type WorkerResultKind = (typeof WorkerResultKind)[keyof typeof WorkerResultKind];

export interface WorkerResponseContract {
  readonly schemaVersion: 1;
  readonly workerEventSchemaVersion: 1;
  readonly allowedResultKinds: readonly WorkerResultKind[];
  readonly unknownFields: 'REJECT';
}

export interface ContextPackageEntry {
  readonly kind: ContextEntryKind;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly sourceDigest?: Sha256Digest;
  readonly authorityClass: ContextAuthorityClass;
  readonly renderedContent: string;
}

export interface ContextPackageGoal {
  readonly objective: string;
  readonly successCriteria: readonly SuccessCriterion[];
  readonly scope: {
    readonly projectPath: string;
    readonly allowedPaths: readonly string[];
  };
  readonly nonGoals: readonly string[];
}

export interface ContextPackage {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: WorkflowPhaseType;
  readonly attemptId: AttemptId;
  readonly candidateGenerationId?: CandidateGenerationId;
  readonly candidateDigest?: Sha256Digest;
  readonly phaseObjective: string;
  readonly capabilityGrant: CapabilityGrant;
  readonly goal: ContextPackageGoal;
  readonly selectedEntries: readonly ContextPackageEntry[];
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly responseContract: WorkerResponseContract;
}

export interface ContextManifestEntry {
  readonly kind: ContextEntryKind;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly sourceDigest?: Sha256Digest;
  readonly authorityClass: ContextAuthorityClass;
  readonly renderedDigest: Sha256Digest;
}

export interface ContextOmissionDecision {
  readonly sourceRef: string;
  readonly selectionRule: string;
  readonly reason: string;
}

export interface ContextManifest {
  readonly id: ContextManifestId;
  readonly schemaVersion: 1;
  readonly compilerVersion: string;
  readonly createdAt: IsoTimestamp;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: WorkflowPhaseType;
  readonly attemptId: AttemptId;
  readonly candidateGenerationId?: CandidateGenerationId;
  readonly candidateDigest?: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly capabilityGrantDigest: Sha256Digest;
  readonly responseContractDigest: Sha256Digest;
  readonly entries: readonly ContextManifestEntry[];
  readonly omissionDecisions: readonly ContextOmissionDecision[];
  readonly packageDigest: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
}

export interface ContextCompilation {
  readonly package: ContextPackage;
  readonly manifest: ContextManifest;
}

function isKnown<Value extends string>(
  values: Readonly<Record<string, Value>>,
  value: unknown,
): value is Value {
  return Object.values(values).some((candidate) => candidate === value);
}

function field(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be blank`);
  }
}

function contextEntryKey(
  entry: Pick<ContextManifestEntry, 'kind' | 'sourceRef' | 'sourceRevision'>,
): string {
  return `${entry.kind}\u0000${entry.sourceRef}\u0000${entry.sourceRevision}`;
}

function omissionKey(decision: ContextOmissionDecision): string {
  return `${decision.sourceRef}\u0000${decision.selectionRule}\u0000${decision.reason}`;
}

export function assertContextEntryAuthorityInvariant(
  entry: Pick<ContextPackageEntry, 'kind' | 'authorityClass'>,
): void {
  switch (entry.kind) {
    case ContextEntryKind.GOAL:
    case ContextEntryKind.SUCCESS_CRITERION:
      if (entry.authorityClass !== ContextAuthorityClass.GOAL_AUTHORITY) {
        throw new TypeError(`${entry.kind} Context entry must retain Goal authority`);
      }
      return;
    case ContextEntryKind.FACT:
      if (
        entry.authorityClass !== ContextAuthorityClass.CONFIRMED_FACT &&
        entry.authorityClass !== ContextAuthorityClass.PROJECT_OBSERVATION &&
        entry.authorityClass !== ContextAuthorityClass.NON_AUTHORITATIVE_WORKING
      ) {
        throw new TypeError('Fact Context entry has an invalid authority class');
      }
      return;
    case ContextEntryKind.DECISION:
      if (entry.authorityClass !== ContextAuthorityClass.HUMAN_DECISION) {
        throw new TypeError('Decision Context entry must retain Human Decision authority');
      }
      return;
    case ContextEntryKind.PROJECT_RULE:
    case ContextEntryKind.PROJECT_OBSERVATION:
    case ContextEntryKind.CANDIDATE:
      if (entry.authorityClass !== ContextAuthorityClass.PROJECT_OBSERVATION) {
        throw new TypeError(`${entry.kind} Context entry must remain a project observation`);
      }
      return;
    case ContextEntryKind.WORKING_CONTEXT:
      if (entry.authorityClass !== ContextAuthorityClass.NON_AUTHORITATIVE_WORKING) {
        throw new TypeError('Working Context entry must remain explicitly non-authoritative');
      }
      return;
  }
}

function assertCanonicalOrder<Value>(
  values: readonly Value[],
  keyOf: (value: Value) => string,
  name: string,
): void {
  let previous: string | undefined;
  for (const value of values) {
    const current = keyOf(value);
    if (previous !== undefined && current <= previous) {
      throw new TypeError(`${name} must be uniquely sorted in canonical order`);
    }
    previous = current;
  }
}

function assertCandidateBinding(
  candidateGeneration: CandidateGenerationId | undefined,
  candidateIdentity: Sha256Digest | undefined,
): void {
  if ((candidateGeneration === undefined) !== (candidateIdentity === undefined)) {
    throw new TypeError('Context candidate generation and digest must be present together');
  }
  if (candidateGeneration !== undefined && candidateIdentity !== undefined) {
    candidateGenerationId(candidateGeneration);
    sha256Digest(candidateIdentity);
  }
}

export function assertWorkerResponseContractInvariant(contract: WorkerResponseContract): void {
  if (
    field(contract, 'schemaVersion') !== 1 ||
    field(contract, 'workerEventSchemaVersion') !== 1 ||
    field(contract, 'unknownFields') !== 'REJECT'
  ) {
    throw new TypeError('Worker response contract version or unknown-field policy is invalid');
  }
  if (contract.allowedResultKinds.length === 0) {
    throw new TypeError('Worker response contract must allow at least one result kind');
  }
  const seen = new Set<WorkerResultKind>();
  for (const kind of contract.allowedResultKinds) {
    if (!isKnown(WorkerResultKind, kind) || seen.has(kind)) {
      throw new TypeError('Worker response result kinds must be known and unique');
    }
    seen.add(kind);
  }
}

export function assertContextPackageInvariant(contextPackage: ContextPackage): void {
  if (field(contextPackage, 'schemaVersion') !== 1) {
    throw new TypeError('Context Package schema version is unsupported');
  }
  goalId(contextPackage.goalId);
  goalRevision(contextPackage.goalRevision);
  workflowId(contextPackage.workflowId);
  workflowVersion(contextPackage.workflowVersion);
  attemptId(contextPackage.attemptId);
  policyBundleId(contextPackage.policyBundleId);
  sha256Digest(contextPackage.policyBundleDigest);
  if (
    !isKnown(WorkflowPhase, contextPackage.phase) ||
    contextPackage.phase === WorkflowPhase.CLOSEOUT
  ) {
    throw new TypeError('Context Package phase is not dispatchable');
  }
  assertCandidateBinding(contextPackage.candidateGenerationId, contextPackage.candidateDigest);
  assertNonBlank(contextPackage.phaseObjective, 'Context phase objective');
  if (
    contextPackage.capabilityGrant.phase !== contextPackage.phase ||
    !isCanonicalCapabilityGrant(contextPackage.capabilityGrant)
  ) {
    throw new TypeError('Context Package capability grant is not canonical for its phase');
  }
  assertNonBlank(contextPackage.goal.objective, 'Context Goal objective');
  assertNonBlank(contextPackage.goal.scope.projectPath, 'Context Goal project path');
  if (contextPackage.goal.successCriteria.length === 0) {
    throw new TypeError('Context Package must contain Goal success criteria');
  }
  const criterionIds = new Set<string>();
  for (const criterion of contextPackage.goal.successCriteria) {
    assertNonBlank(criterion.description, 'Context success criterion');
    if (criterionIds.has(criterion.id)) {
      throw new TypeError('Context Package success criterion IDs must be unique');
    }
    criterionIds.add(criterion.id);
  }
  for (const entry of contextPackage.selectedEntries) {
    assertNonBlank(entry.sourceRef, 'Context entry sourceRef');
    assertNonBlank(entry.sourceRevision, 'Context entry sourceRevision');
    assertNonBlank(entry.renderedContent, 'Context entry renderedContent');
    if (
      !isKnown(ContextEntryKind, entry.kind) ||
      !isKnown(ContextAuthorityClass, entry.authorityClass)
    ) {
      throw new TypeError('Context Package entry kind or authority class is unknown');
    }
    if (entry.sourceDigest !== undefined) {
      sha256Digest(entry.sourceDigest);
    }
    if (
      entry.kind === ContextEntryKind.GOAL ||
      entry.kind === ContextEntryKind.SUCCESS_CRITERION ||
      entry.kind === ContextEntryKind.CANDIDATE
    ) {
      throw new TypeError(`${entry.kind} Context entries are compiler-owned`);
    }
    assertContextEntryAuthorityInvariant(entry);
  }
  assertCanonicalOrder(contextPackage.selectedEntries, contextEntryKey, 'Context Package entries');
  assertWorkerResponseContractInvariant(contextPackage.responseContract);
}

export function assertContextManifestInvariant(manifest: ContextManifest): void {
  if (field(manifest, 'schemaVersion') !== 1) {
    throw new TypeError('Context Manifest schema version is unsupported');
  }
  contextManifestId(manifest.id);
  goalId(manifest.goalId);
  goalRevision(manifest.goalRevision);
  workflowId(manifest.workflowId);
  workflowVersion(manifest.workflowVersion);
  attemptId(manifest.attemptId);
  policyBundleId(manifest.policyBundleId);
  isoTimestamp(manifest.createdAt);
  assertNonBlank(manifest.compilerVersion, 'Context compilerVersion');
  if (!isKnown(WorkflowPhase, manifest.phase) || manifest.phase === WorkflowPhase.CLOSEOUT) {
    throw new TypeError('Context Manifest phase is not dispatchable');
  }
  assertCandidateBinding(manifest.candidateGenerationId, manifest.candidateDigest);
  sha256Digest(manifest.policyBundleDigest);
  sha256Digest(manifest.capabilityGrantDigest);
  sha256Digest(manifest.responseContractDigest);
  sha256Digest(manifest.packageDigest);
  sha256Digest(manifest.manifestDigest);
  const goalEntries: ContextManifestEntry[] = [];
  const candidateEntries: ContextManifestEntry[] = [];
  const manifestedSourceRefs = new Set<string>();
  for (const entry of manifest.entries) {
    assertNonBlank(entry.sourceRef, 'Context Manifest entry sourceRef');
    assertNonBlank(entry.sourceRevision, 'Context Manifest entry sourceRevision');
    if (
      !isKnown(ContextEntryKind, entry.kind) ||
      !isKnown(ContextAuthorityClass, entry.authorityClass)
    ) {
      throw new TypeError('Context Manifest entry kind or authority class is unknown');
    }
    if (entry.sourceDigest !== undefined) {
      sha256Digest(entry.sourceDigest);
    }
    sha256Digest(entry.renderedDigest);
    assertContextEntryAuthorityInvariant(entry);
    manifestedSourceRefs.add(entry.sourceRef);
    if (entry.kind === ContextEntryKind.GOAL) {
      goalEntries.push(entry);
    }
    if (entry.kind === ContextEntryKind.CANDIDATE) {
      candidateEntries.push(entry);
    }
  }
  assertCanonicalOrder(manifest.entries, contextEntryKey, 'Context Manifest entries');
  if (
    goalEntries.length !== 1 ||
    goalEntries[0]?.sourceRef !== manifest.goalId ||
    goalEntries[0].sourceRevision !== String(manifest.goalRevision)
  ) {
    throw new TypeError('Context Manifest must contain its exact authoritative Goal entry');
  }
  for (const criterion of manifest.entries.filter(
    (entry) => entry.kind === ContextEntryKind.SUCCESS_CRITERION,
  )) {
    if (criterion.sourceRevision !== String(manifest.goalRevision)) {
      throw new TypeError('Context criterion entry must bind the Manifest Goal revision');
    }
  }
  if (manifest.candidateGenerationId === undefined || manifest.candidateDigest === undefined) {
    if (candidateEntries.length !== 0) {
      throw new TypeError('Context Manifest without a Candidate binding cannot contain one');
    }
  } else if (
    candidateEntries.length !== 1 ||
    candidateEntries[0]?.sourceRef !== manifest.candidateGenerationId ||
    candidateEntries[0].sourceRevision !== String(manifest.workflowVersion) ||
    candidateEntries[0].sourceDigest !== manifest.candidateDigest
  ) {
    throw new TypeError('Context Manifest Candidate entry does not match its binding');
  }
  const omittedSourceRefs = new Set<string>();
  for (const decision of manifest.omissionDecisions) {
    assertNonBlank(decision.sourceRef, 'Context omission sourceRef');
    assertNonBlank(decision.selectionRule, 'Context omission selectionRule');
    assertNonBlank(decision.reason, 'Context omission reason');
    if (omittedSourceRefs.has(decision.sourceRef)) {
      throw new TypeError('Context omission decisions must identify unique sources');
    }
    if (manifestedSourceRefs.has(decision.sourceRef)) {
      throw new TypeError(`Context source ${decision.sourceRef} cannot be selected and omitted`);
    }
    omittedSourceRefs.add(decision.sourceRef);
  }
  assertCanonicalOrder(manifest.omissionDecisions, omissionKey, 'Context omission decisions');
}
