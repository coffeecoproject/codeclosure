import {
  aggregateVersion,
  attemptId,
  candidateGenerationId,
  checkSpecificationId,
  commandId,
  evidenceId,
  goalId,
  goalRevision,
  isoTimestamp,
  nextAggregateVersion,
  policyBundleId,
  sha256Digest,
  verificationObligationId,
  workflowId,
  type AggregateVersion,
  type AttemptId,
  type CandidateGenerationId,
  type CheckSpecificationId,
  type CommandId,
  type EvidenceId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type PolicyBundleId,
  type Sha256Digest,
  type SuccessCriterionId,
  type VerificationObligationId,
  type WorkflowId,
} from './identifiers.js';
import { DomainInvariantError } from './workflow.js';

export const EvidenceProducerType = {
  CANDIDATE_MANAGER: 'CANDIDATE_MANAGER',
  VERIFICATION_RUNNER: 'VERIFICATION_RUNNER',
  WORKER_OBSERVATION: 'WORKER_OBSERVATION',
} as const;
export type EvidenceProducerType = (typeof EvidenceProducerType)[keyof typeof EvidenceProducerType];

export const EvidenceKind = {
  CANDIDATE_FREEZE: 'CANDIDATE_FREEZE',
  TEST_RESULT: 'TEST_RESULT',
} as const;
export type EvidenceKind = (typeof EvidenceKind)[keyof typeof EvidenceKind];

export const EvidenceResultStatus = {
  OBSERVED: 'OBSERVED',
  PASS: 'PASS',
  FAIL: 'FAIL',
  RUNNER_ERROR: 'RUNNER_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const;
export type EvidenceResultStatus = (typeof EvidenceResultStatus)[keyof typeof EvidenceResultStatus];

export const FakeVerificationDetailCode = {
  PASS: 'M1_FAKE_PASS',
  FAIL: 'M1_FAKE_FAIL',
  RUNNER_ERROR: 'M1_FAKE_RUNNER_ERROR',
  TIMEOUT: 'M1_FAKE_TIMEOUT',
} as const;
export type FakeVerificationDetailCode =
  (typeof FakeVerificationDetailCode)[keyof typeof FakeVerificationDetailCode];

export function fakeVerificationDetailCodeForStatus(
  status: Exclude<EvidenceResultStatus, typeof EvidenceResultStatus.OBSERVED>,
): FakeVerificationDetailCode {
  switch (status) {
    case EvidenceResultStatus.PASS:
      return FakeVerificationDetailCode.PASS;
    case EvidenceResultStatus.FAIL:
      return FakeVerificationDetailCode.FAIL;
    case EvidenceResultStatus.RUNNER_ERROR:
      return FakeVerificationDetailCode.RUNNER_ERROR;
    case EvidenceResultStatus.TIMEOUT:
      return FakeVerificationDetailCode.TIMEOUT;
  }
}

export const EvidenceEligibilityState = {
  ELIGIBLE: 'ELIGIBLE',
  INELIGIBLE: 'INELIGIBLE',
} as const;
export type EvidenceEligibilityState =
  (typeof EvidenceEligibilityState)[keyof typeof EvidenceEligibilityState];

export const CheckSpecificationKind = {
  CANDIDATE_FREEZE: 'CANDIDATE_FREEZE',
  FAKE_VERIFICATION: 'FAKE_VERIFICATION',
} as const;
export type CheckSpecificationKind =
  (typeof CheckSpecificationKind)[keyof typeof CheckSpecificationKind];

export interface CheckSpecification {
  readonly schemaVersion: 1;
  readonly id: CheckSpecificationId;
  readonly version: string;
  readonly kind: CheckSpecificationKind;
  readonly producerType: EvidenceProducerType;
  readonly producerIdentity: string;
  readonly operation: string;
  readonly cwdIdentity: string;
  readonly inputRefs: readonly string[];
  readonly environmentPolicy: string;
  readonly timeoutMilliseconds: number;
  readonly outputLimitBytes: number;
  readonly expectedObservationSchema: string;
  readonly cleanupPolicy?: string;
}

export interface VerificationObligation {
  readonly id: VerificationObligationId;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly sourceCriterionRefs: readonly SuccessCriterionId[];
  readonly scenarioRefs: readonly string[];
  readonly checkSpecRef: string;
  readonly requiredEvidenceKind: EvidenceKind;
  readonly strength: string;
  readonly createdAt: IsoTimestamp;
}

export interface CandidateFreezeObservation {
  readonly schemaVersion: 1;
  readonly kind: typeof EvidenceKind.CANDIDATE_FREEZE;
  readonly firstSourceDigest: Sha256Digest;
  readonly secondSourceDigest: Sha256Digest;
  readonly changeSetDigest: Sha256Digest;
}

export interface FakeVerificationObservation {
  readonly schemaVersion: 1;
  readonly kind: 'FAKE_VERIFICATION';
  readonly checkSpecRef: string;
  readonly observedResult: Exclude<EvidenceResultStatus, typeof EvidenceResultStatus.OBSERVED>;
  readonly detailCode: FakeVerificationDetailCode;
}

export type EvidenceObservation = CandidateFreezeObservation | FakeVerificationObservation;

export interface EvidenceEnvironmentIdentity {
  readonly schemaVersion: 1;
  readonly kind: 'M1_LOGICAL';
  readonly identity: string;
  readonly digest: Sha256Digest;
}

interface EvidenceRecordBase {
  readonly id: EvidenceId;
  readonly schemaVersion: 1;
  readonly producerIdentity: string;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly attemptId: AttemptId;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly checkSpec: CheckSpecification;
  readonly startedAt: IsoTimestamp;
  readonly endedAt: IsoTimestamp;
  readonly observationDigest: Sha256Digest;
  readonly recordedAt: IsoTimestamp;
  readonly recordDigest: Sha256Digest;
}

export interface CandidateFreezeEvidenceRecord extends EvidenceRecordBase {
  readonly kind: typeof EvidenceKind.CANDIDATE_FREEZE;
  readonly producerType: typeof EvidenceProducerType.CANDIDATE_MANAGER;
  readonly verificationObligationId?: never;
  readonly factSnapshotDigest?: never;
  readonly environmentIdentity?: never;
  readonly observation: CandidateFreezeObservation;
  readonly payloadRefs: readonly [Sha256Digest];
  readonly resultStatus: typeof EvidenceResultStatus.OBSERVED;
}

export interface TestResultEvidenceRecord extends EvidenceRecordBase {
  readonly kind: typeof EvidenceKind.TEST_RESULT;
  readonly producerType: typeof EvidenceProducerType.VERIFICATION_RUNNER;
  readonly verificationObligationId: VerificationObligationId;
  readonly factSnapshotDigest?: never;
  readonly environmentIdentity: EvidenceEnvironmentIdentity;
  readonly observation: FakeVerificationObservation;
  readonly payloadRefs: readonly [Sha256Digest];
  readonly resultStatus: Exclude<EvidenceResultStatus, typeof EvidenceResultStatus.OBSERVED>;
}

export type EvidenceRecord = CandidateFreezeEvidenceRecord | TestResultEvidenceRecord;

export interface EligibleEvidence {
  readonly evidenceId: EvidenceId;
  readonly version: AggregateVersion;
  readonly state: typeof EvidenceEligibilityState.ELIGIBLE;
  readonly reasonCode?: never;
  readonly sourceRef?: never;
  readonly changedAt: IsoTimestamp;
}

export interface IneligibleEvidence {
  readonly evidenceId: EvidenceId;
  readonly version: AggregateVersion;
  readonly state: typeof EvidenceEligibilityState.INELIGIBLE;
  readonly reasonCode: string;
  readonly sourceRef: string;
  readonly changedAt: IsoTimestamp;
}

export type EvidenceEligibility = EligibleEvidence | IneligibleEvidence;

export interface EvidenceEligibilityChanged {
  readonly type: 'EVIDENCE_ELIGIBILITY_CHANGED';
  readonly commandId: CommandId;
  readonly evidenceId: EvidenceId;
  readonly fromVersion: AggregateVersion;
  readonly toVersion: AggregateVersion;
  readonly fromState: typeof EvidenceEligibilityState.ELIGIBLE;
  readonly toState: typeof EvidenceEligibilityState.INELIGIBLE;
  readonly reasonCode: string;
  readonly sourceRef: string;
  readonly occurredAt: IsoTimestamp;
}

export interface EvidenceSetObligationMapping {
  readonly obligationId: VerificationObligationId;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface EvidenceSetEntry {
  readonly evidenceId: EvidenceId;
  readonly evidenceRecordDigest: Sha256Digest;
  readonly eligibilityVersion: AggregateVersion;
  readonly eligibilityState: EvidenceEligibilityState;
}

export interface EvidenceSet {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateDigest: Sha256Digest;
  readonly obligationMappings: readonly EvidenceSetObligationMapping[];
  readonly evidenceRefs: readonly EvidenceSetEntry[];
  readonly unresolvedEvidenceRequirements: readonly VerificationObligationId[];
  readonly digest: Sha256Digest;
}

function assertKnown<Value extends string>(
  values: Readonly<Record<string, Value>>,
  value: unknown,
  name: string,
): asserts value is Value {
  if (!Object.values(values).some((candidate) => candidate === value)) {
    throw new DomainInvariantError(`${name} is unknown`);
  }
}

function hasExactValue(value: unknown, expected: unknown): boolean {
  return value === expected;
}

function hasExactLength(values: readonly unknown[], expected: number): boolean {
  return values.length === expected;
}

function isUndefined(value: unknown): boolean {
  return value === undefined;
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new DomainInvariantError(`${name} must not be blank`);
  }
}

function assertCanonicalStrings(values: readonly string[], name: string): void {
  let previous: string | undefined;
  for (const value of values) {
    assertNonBlank(value, name);
    if (previous !== undefined && value <= previous) {
      throw new DomainInvariantError(`${name} must be uniquely sorted`);
    }
    previous = value;
  }
}

export function checkSpecificationRef(checkSpec: CheckSpecification): string {
  assertCheckSpecificationInvariant(checkSpec);
  return `${checkSpec.id}@${checkSpec.version}`;
}

export function assertCheckSpecificationInvariant(checkSpec: CheckSpecification): void {
  checkSpecificationId(checkSpec.id);
  assertKnown(CheckSpecificationKind, checkSpec.kind, 'Check Specification kind');
  assertKnown(EvidenceProducerType, checkSpec.producerType, 'Check Specification producer type');
  assertNonBlank(checkSpec.producerIdentity, 'Check Specification producer identity');
  assertNonBlank(checkSpec.version, 'Check Specification version');
  assertNonBlank(checkSpec.operation, 'Check Specification operation');
  assertNonBlank(checkSpec.cwdIdentity, 'Check Specification cwd identity');
  assertCanonicalStrings(checkSpec.inputRefs, 'Check Specification input refs');
  assertNonBlank(checkSpec.environmentPolicy, 'Check Specification environment policy');
  assertNonBlank(checkSpec.expectedObservationSchema, 'Expected observation schema');
  if (!Number.isSafeInteger(checkSpec.timeoutMilliseconds) || checkSpec.timeoutMilliseconds < 1) {
    throw new DomainInvariantError('Check Specification timeout must be a positive safe integer');
  }
  if (!Number.isSafeInteger(checkSpec.outputLimitBytes) || checkSpec.outputLimitBytes < 1) {
    throw new DomainInvariantError(
      'Check Specification output limit must be a positive safe integer',
    );
  }
  if (checkSpec.cleanupPolicy !== undefined) {
    assertNonBlank(checkSpec.cleanupPolicy, 'Check Specification cleanup policy');
  }
}

export function assertVerificationObligationInvariant(obligation: VerificationObligation): void {
  verificationObligationId(obligation.id);
  goalId(obligation.goalId);
  goalRevision(obligation.goalRevision);
  candidateGenerationId(obligation.candidateGenerationId);
  isoTimestamp(obligation.createdAt);
  if (obligation.sourceCriterionRefs.length === 0) {
    throw new DomainInvariantError('Verification obligation requires a source criterion');
  }
  assertCanonicalStrings(obligation.sourceCriterionRefs, 'Verification obligation criteria');
  assertCanonicalStrings(obligation.scenarioRefs, 'Verification obligation scenarios');
  assertNonBlank(obligation.checkSpecRef, 'Verification obligation Check Specification ref');
  assertKnown(EvidenceKind, obligation.requiredEvidenceKind, 'Required Evidence kind');
  assertNonBlank(obligation.strength, 'Verification obligation strength');
}

export function assertEvidenceObservationInvariant(observation: EvidenceObservation): void {
  if (observation.kind === EvidenceKind.CANDIDATE_FREEZE) {
    sha256Digest(observation.firstSourceDigest);
    sha256Digest(observation.secondSourceDigest);
    sha256Digest(observation.changeSetDigest);
    if (observation.firstSourceDigest !== observation.secondSourceDigest) {
      throw new DomainInvariantError('Freeze Evidence requires stable source observations');
    }
    return;
  }
  assertNonBlank(observation.checkSpecRef, 'Fake verification Check Specification ref');
  assertKnown(EvidenceResultStatus, observation.observedResult, 'Observed Evidence result');
  if (Object.is(observation.observedResult, EvidenceResultStatus.OBSERVED)) {
    throw new DomainInvariantError(
      'Fake verification cannot report the freeze-only OBSERVED result',
    );
  }
  if (observation.detailCode !== fakeVerificationDetailCodeForStatus(observation.observedResult)) {
    throw new DomainInvariantError('Fake verification detail code does not match its result');
  }
}

export function assertEvidenceRecordInvariant(record: EvidenceRecord): void {
  evidenceId(record.id);
  assertKnown(EvidenceKind, record.kind, 'Evidence kind');
  assertKnown(EvidenceProducerType, record.producerType, 'Evidence producer type');
  assertNonBlank(record.producerIdentity, 'Evidence producer identity');
  goalId(record.goalId);
  goalRevision(record.goalRevision);
  workflowId(record.workflowId);
  attemptId(record.attemptId);
  if (record.verificationObligationId !== undefined) {
    verificationObligationId(record.verificationObligationId);
  }
  candidateGenerationId(record.candidateGenerationId);
  sha256Digest(record.candidateDigest);
  if (Object.hasOwn(record, 'factSnapshotDigest')) {
    throw new DomainInvariantError('M1 Evidence cannot carry unresolved Fact authority');
  }
  policyBundleId(record.policyBundleId);
  sha256Digest(record.policyBundleDigest);
  assertCheckSpecificationInvariant(record.checkSpec);
  if (record.environmentIdentity !== undefined) {
    assertNonBlank(record.environmentIdentity.identity, 'Evidence environment identity');
    sha256Digest(record.environmentIdentity.digest);
  }
  isoTimestamp(record.startedAt);
  isoTimestamp(record.endedAt);
  isoTimestamp(record.recordedAt);
  if (record.endedAt < record.startedAt || record.recordedAt < record.endedAt) {
    throw new DomainInvariantError('Evidence timestamps are not causally ordered');
  }
  assertEvidenceObservationInvariant(record.observation);
  assertCanonicalStrings(record.payloadRefs, 'Evidence payload refs');
  if (!hasExactLength(record.payloadRefs, 1)) {
    throw new DomainInvariantError('M1 Evidence requires exactly one canonical payload');
  }
  sha256Digest(record.observationDigest);
  assertKnown(EvidenceResultStatus, record.resultStatus, 'Evidence result status');
  sha256Digest(record.recordDigest);

  if (
    record.producerType !== record.checkSpec.producerType ||
    record.producerIdentity !== record.checkSpec.producerIdentity
  ) {
    throw new DomainInvariantError('Evidence producer does not match its Check Specification');
  }

  if (record.kind === EvidenceKind.CANDIDATE_FREEZE) {
    if (
      !hasExactValue(record.producerType, EvidenceProducerType.CANDIDATE_MANAGER) ||
      !hasExactValue(record.observation.kind, EvidenceKind.CANDIDATE_FREEZE) ||
      !hasExactValue(record.resultStatus, EvidenceResultStatus.OBSERVED) ||
      record.checkSpec.kind !== CheckSpecificationKind.CANDIDATE_FREEZE ||
      Object.hasOwn(record, 'verificationObligationId') ||
      Object.hasOwn(record, 'environmentIdentity') ||
      record.payloadRefs[0] !== record.observation.changeSetDigest
    ) {
      throw new DomainInvariantError('Candidate freeze Evidence has an invalid authority owner');
    }
  } else if (
    !hasExactValue(record.producerType, EvidenceProducerType.VERIFICATION_RUNNER) ||
    isUndefined(record.verificationObligationId) ||
    !hasExactValue(record.observation.kind, 'FAKE_VERIFICATION') ||
    record.resultStatus !== record.observation.observedResult ||
    record.observation.checkSpecRef !== checkSpecificationRef(record.checkSpec) ||
    record.checkSpec.kind !== CheckSpecificationKind.FAKE_VERIFICATION ||
    record.environmentIdentity.identity !== `m1-logical:${record.checkSpec.cwdIdentity}` ||
    record.payloadRefs[0] !== record.observationDigest
  ) {
    throw new DomainInvariantError('Test Evidence has an invalid verification binding');
  }
}

export function assertEvidenceEligibilityInvariant(eligibility: EvidenceEligibility): void {
  evidenceId(eligibility.evidenceId);
  aggregateVersion(eligibility.version);
  isoTimestamp(eligibility.changedAt);
  assertKnown(EvidenceEligibilityState, eligibility.state, 'Evidence eligibility state');
  if (eligibility.state === EvidenceEligibilityState.ELIGIBLE) {
    if (eligibility.version !== aggregateVersion(1)) {
      throw new DomainInvariantError('Initial eligible Evidence must be version 1');
    }
    if (Object.hasOwn(eligibility, 'reasonCode') || Object.hasOwn(eligibility, 'sourceRef')) {
      throw new DomainInvariantError('Eligible Evidence cannot carry invalidation metadata');
    }
    return;
  }
  if (eligibility.version !== aggregateVersion(2)) {
    throw new DomainInvariantError('Ineligible Evidence must be the single version after eligible');
  }
  assertNonBlank(eligibility.reasonCode, 'Evidence ineligibility reason');
  assertNonBlank(eligibility.sourceRef, 'Evidence ineligibility source');
}

export function createInitialEvidenceEligibility(
  evidenceIdentifier: EvidenceId,
  changedAt: IsoTimestamp,
): EligibleEvidence {
  const eligibility = Object.freeze({
    evidenceId: evidenceId(evidenceIdentifier),
    version: aggregateVersion(1),
    state: EvidenceEligibilityState.ELIGIBLE,
    changedAt: isoTimestamp(changedAt),
  });
  assertEvidenceEligibilityInvariant(eligibility);
  return eligibility;
}

export function decideEvidenceInvalidation(
  current: EvidenceEligibility,
  input: {
    readonly commandId: CommandId;
    readonly expectedVersion: AggregateVersion;
    readonly reasonCode: string;
    readonly sourceRef: string;
    readonly occurredAt: IsoTimestamp;
  },
): EvidenceEligibilityChanged {
  assertEvidenceEligibilityInvariant(current);
  commandId(input.commandId);
  if (current.state !== EvidenceEligibilityState.ELIGIBLE) {
    throw new DomainInvariantError('Ineligible Evidence cannot transition again');
  }
  if (current.version !== input.expectedVersion) {
    throw new DomainInvariantError('Evidence eligibility expected version is stale');
  }
  assertNonBlank(input.reasonCode, 'Evidence ineligibility reason');
  assertNonBlank(input.sourceRef, 'Evidence ineligibility source');
  const occurredAt = isoTimestamp(input.occurredAt);
  if (occurredAt < current.changedAt) {
    throw new DomainInvariantError('Evidence eligibility cannot move time backward');
  }
  return Object.freeze({
    type: 'EVIDENCE_ELIGIBILITY_CHANGED',
    commandId: input.commandId,
    evidenceId: current.evidenceId,
    fromVersion: current.version,
    toVersion: nextAggregateVersion(current.version),
    fromState: EvidenceEligibilityState.ELIGIBLE,
    toState: EvidenceEligibilityState.INELIGIBLE,
    reasonCode: input.reasonCode,
    sourceRef: input.sourceRef,
    occurredAt,
  });
}

export function applyEvidenceEligibilityEvent(
  current: EvidenceEligibility,
  event: EvidenceEligibilityChanged,
): IneligibleEvidence {
  assertEvidenceEligibilityInvariant(current);
  if (
    current.state !== EvidenceEligibilityState.ELIGIBLE ||
    event.evidenceId !== current.evidenceId ||
    event.fromVersion !== current.version ||
    event.toVersion !== nextAggregateVersion(current.version)
  ) {
    throw new DomainInvariantError('Evidence eligibility event does not match current state');
  }
  if (event.occurredAt < current.changedAt) {
    throw new DomainInvariantError('Evidence eligibility event cannot move time backward');
  }
  const next = Object.freeze({
    evidenceId: current.evidenceId,
    version: event.toVersion,
    state: EvidenceEligibilityState.INELIGIBLE,
    reasonCode: event.reasonCode,
    sourceRef: event.sourceRef,
    changedAt: event.occurredAt,
  });
  assertEvidenceEligibilityInvariant(next);
  return next;
}

export function evidenceObservationDigestProjection(observation: EvidenceObservation): unknown {
  assertEvidenceObservationInvariant(observation);
  return observation;
}

export function evidenceRecordDigestProjection(
  record: Omit<EvidenceRecord, 'id' | 'recordedAt' | 'recordDigest'>,
): unknown {
  return {
    schemaVersion: record.schemaVersion,
    kind: record.kind,
    producerType: record.producerType,
    producerIdentity: record.producerIdentity,
    goalId: record.goalId,
    goalRevision: record.goalRevision,
    workflowId: record.workflowId,
    attemptId: record.attemptId,
    ...(record.verificationObligationId === undefined
      ? {}
      : { verificationObligationId: record.verificationObligationId }),
    candidateGenerationId: record.candidateGenerationId,
    candidateDigest: record.candidateDigest,
    policyBundleId: record.policyBundleId,
    policyBundleDigest: record.policyBundleDigest,
    checkSpec: record.checkSpec,
    ...(record.environmentIdentity === undefined
      ? {}
      : { environmentIdentity: record.environmentIdentity }),
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    observationDigest: record.observationDigest,
    payloadRefs: record.payloadRefs,
    resultStatus: record.resultStatus,
  };
}

export function evidenceSetDigestProjection(set: Omit<EvidenceSet, 'digest'>): unknown {
  return {
    schemaVersion: set.schemaVersion,
    goalId: set.goalId,
    goalRevision: set.goalRevision,
    candidateGenerationId: set.candidateGenerationId,
    candidateDigest: set.candidateDigest,
    obligationMappings: set.obligationMappings,
    evidenceRefs: set.evidenceRefs,
    unresolvedEvidenceRequirements: set.unresolvedEvidenceRequirements,
  };
}

export function assertEvidenceSetInvariant(set: EvidenceSet): void {
  goalId(set.goalId);
  goalRevision(set.goalRevision);
  candidateGenerationId(set.candidateGenerationId);
  sha256Digest(set.candidateDigest);
  sha256Digest(set.digest);
  if (set.obligationMappings.length === 0) {
    throw new DomainInvariantError('Evidence Set must map at least one required obligation');
  }

  const unresolved = new Set(set.unresolvedEvidenceRequirements);
  const mappedEvidence = new Set<EvidenceId>();
  let previousObligation: string | undefined;
  for (const mapping of set.obligationMappings) {
    verificationObligationId(mapping.obligationId);
    if (previousObligation !== undefined && mapping.obligationId <= previousObligation) {
      throw new DomainInvariantError('Evidence Set obligation mappings must be uniquely sorted');
    }
    previousObligation = mapping.obligationId;
    assertCanonicalStrings(mapping.evidenceIds, 'Mapped Evidence IDs');
    if (unresolved.has(mapping.obligationId) !== (mapping.evidenceIds.length === 0)) {
      throw new DomainInvariantError(
        'Evidence Set unresolved requirements must exactly match empty obligation mappings',
      );
    }
    for (const identifier of mapping.evidenceIds) {
      if (mappedEvidence.has(identifier)) {
        throw new DomainInvariantError(
          'Evidence Set cannot map one Evidence record to multiple obligations',
        );
      }
      mappedEvidence.add(identifier);
    }
  }

  let previousEvidence: string | undefined;
  for (const entry of set.evidenceRefs) {
    evidenceId(entry.evidenceId);
    sha256Digest(entry.evidenceRecordDigest);
    aggregateVersion(entry.eligibilityVersion);
    assertKnown(EvidenceEligibilityState, entry.eligibilityState, 'Evidence Set eligibility');
    if (entry.eligibilityState !== EvidenceEligibilityState.ELIGIBLE) {
      throw new DomainInvariantError(
        'A newly selected Evidence Set may contain only eligible Evidence',
      );
    }
    if (previousEvidence !== undefined && entry.evidenceId <= previousEvidence) {
      throw new DomainInvariantError('Evidence Set entries must be uniquely sorted');
    }
    previousEvidence = entry.evidenceId;
  }
  assertCanonicalStrings(set.unresolvedEvidenceRequirements, 'Unresolved Evidence requirements');
  const obligationIds = new Set(set.obligationMappings.map((mapping) => mapping.obligationId));
  if ([...unresolved].some((identifier) => !obligationIds.has(identifier))) {
    throw new DomainInvariantError(
      'Evidence Set unresolved requirements must name a mapped obligation',
    );
  }
  const referencedEvidence = new Set(set.evidenceRefs.map((entry) => entry.evidenceId));
  if (
    [...mappedEvidence].some((identifier) => !referencedEvidence.has(identifier)) ||
    [...referencedEvidence].some((identifier) => !mappedEvidence.has(identifier))
  ) {
    throw new DomainInvariantError(
      'Evidence Set references must exactly equal the Evidence selected by its mappings',
    );
  }
}
