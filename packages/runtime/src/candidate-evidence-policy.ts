import {
  CheckSpecificationKind,
  EvidenceKind,
  EvidenceProducerType,
  checkSpecificationRef,
  decodeCheckSpecification,
  decodeVerificationObligation,
  type CandidateGeneration,
  type CandidateGenerationId,
  type CheckSpecification,
  type CheckSpecificationId,
  type Goal,
  type IsoTimestamp,
  type VerificationObligation,
  type VerificationObligationId,
} from '@codeclosure/domain';

import type { DigestProvider } from './ports.js';

export const M1CandidateEvidenceProducerIdentity = {
  CANDIDATE_MANAGER: 'candidate-manager:m1',
  VERIFICATION_RUNNER: 'fake-verification-runner:m1',
} as const;

export function deriveM1BaseProjectIdentity(projectPath: string, digests: DigestProvider): string {
  return `m1-project:${digests.digest({ schemaVersion: 1, projectPath })}`;
}

export function deriveM1WorkspaceIdentity(generationId: CandidateGenerationId): string {
  return `m1-workspace:${generationId}`;
}

export interface M1CheckSpecificationIdentities {
  readonly freeze: CheckSpecificationId;
  readonly verification: CheckSpecificationId;
}

export interface M1VerificationObligationIdentities {
  nextVerificationObligationId(): VerificationObligationId;
}

export interface M1CandidateEvidencePolicy {
  readonly freeze: CheckSpecification;
  readonly verification: CheckSpecification;
  readonly obligations: readonly VerificationObligation[];
}

function hasExactValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertM1CheckSpecification(
  specification: CheckSpecification,
  generation: CandidateGeneration,
  expected: {
    readonly kind: CheckSpecification['kind'];
    readonly producerType: CheckSpecification['producerType'];
    readonly producerIdentity: string;
    readonly operation: string;
    readonly observationSchema: string;
  },
): void {
  if (
    specification.version !== 'm1.2' ||
    specification.kind !== expected.kind ||
    specification.producerType !== expected.producerType ||
    specification.producerIdentity !== expected.producerIdentity ||
    specification.operation !== expected.operation ||
    specification.cwdIdentity !== generation.workspaceIdentity ||
    !hasExactValues(specification.inputRefs, [generation.id]) ||
    specification.environmentPolicy !== 'M1_LOGICAL_DETERMINISTIC' ||
    specification.timeoutMilliseconds !== 1_000 ||
    specification.outputLimitBytes !== 65_536 ||
    specification.expectedObservationSchema !== expected.observationSchema ||
    specification.cleanupPolicy !== 'M1_LOGICAL_NO_EXTERNAL_RESOURCES'
  ) {
    throw new TypeError(`Check Specification ${specification.id} is not the exact M1 policy`);
  }
}

export function validateM1CandidateEvidencePolicy(
  goal: Goal,
  generation: CandidateGeneration,
  rawPolicy: M1CandidateEvidencePolicy,
  createdAt: IsoTimestamp,
): M1CandidateEvidencePolicy {
  const freeze = decodeCheckSpecification(rawPolicy.freeze);
  const verification = decodeCheckSpecification(rawPolicy.verification);
  if (freeze.id === verification.id) {
    throw new TypeError('M1 freeze and verification Check Specifications require distinct IDs');
  }
  assertM1CheckSpecification(freeze, generation, {
    kind: CheckSpecificationKind.CANDIDATE_FREEZE,
    producerType: EvidenceProducerType.CANDIDATE_MANAGER,
    producerIdentity: M1CandidateEvidenceProducerIdentity.CANDIDATE_MANAGER,
    operation: 'm1.logical.candidate.freeze',
    observationSchema: 'codeclosure.candidate-freeze-observation.v1',
  });
  assertM1CheckSpecification(verification, generation, {
    kind: CheckSpecificationKind.FAKE_VERIFICATION,
    producerType: EvidenceProducerType.VERIFICATION_RUNNER,
    producerIdentity: M1CandidateEvidenceProducerIdentity.VERIFICATION_RUNNER,
    operation: 'm1.logical.fake-verification',
    observationSchema: 'codeclosure.fake-verification-observation.v1',
  });

  const obligations = Object.freeze(
    rawPolicy.obligations.map((obligation) => decodeVerificationObligation(obligation)),
  );
  const requiredCriteria = goal.successCriteria.filter((criterion) => criterion.required);
  if (requiredCriteria.length === 0) {
    throw new TypeError('M1 requires at least one required success criterion');
  }
  if (obligations.length !== requiredCriteria.length) {
    throw new TypeError('M1 requires exactly one Verification Obligation per required criterion');
  }
  const seenIdentifiers = new Set<VerificationObligationId>();
  const obligationsByCriterion = new Map<
    (typeof requiredCriteria)[number]['id'],
    VerificationObligation
  >();
  const verificationRef = checkSpecificationRef(verification);
  obligations.forEach((obligation) => {
    const criterionId = obligation.sourceCriterionRefs[0];
    const criterion = requiredCriteria.find((candidate) => candidate.id === criterionId);
    if (
      criterion === undefined ||
      obligation.sourceCriterionRefs.length !== 1 ||
      seenIdentifiers.has(obligation.id) ||
      obligationsByCriterion.has(criterion.id) ||
      obligation.goalId !== goal.id ||
      obligation.goalRevision !== goal.revision ||
      obligation.candidateGenerationId !== generation.id ||
      !hasExactValues(obligation.sourceCriterionRefs, [criterion.id]) ||
      !hasExactValues(obligation.scenarioRefs, [`criterion:${criterion.id}`]) ||
      obligation.checkSpecRef !== verificationRef ||
      obligation.requiredEvidenceKind !== EvidenceKind.TEST_RESULT ||
      obligation.strength !== 'M1_DETERMINISTIC' ||
      obligation.createdAt !== createdAt
    ) {
      throw new TypeError(
        `Verification Obligation ${obligation.id} is not the exact M1 criterion mapping`,
      );
    }
    seenIdentifiers.add(obligation.id);
    obligationsByCriterion.set(criterion.id, obligation);
  });
  const orderedObligations = Object.freeze(
    requiredCriteria.map((criterion) => {
      const obligation = obligationsByCriterion.get(criterion.id);
      if (obligation === undefined) {
        throw new TypeError(`Required criterion ${criterion.id} has no Verification Obligation`);
      }
      return obligation;
    }),
  );
  return Object.freeze({ freeze, verification, obligations: orderedObligations });
}

export function createM1CandidateEvidencePolicy(
  goal: Goal,
  generation: CandidateGeneration,
  checkIds: M1CheckSpecificationIdentities,
  obligationIds: M1VerificationObligationIdentities,
  createdAt: IsoTimestamp,
): M1CandidateEvidencePolicy {
  const common = {
    schemaVersion: 1 as const,
    version: 'm1.2',
    cwdIdentity: generation.workspaceIdentity,
    inputRefs: Object.freeze([generation.id]),
    environmentPolicy: 'M1_LOGICAL_DETERMINISTIC',
    timeoutMilliseconds: 1_000,
    outputLimitBytes: 65_536,
    cleanupPolicy: 'M1_LOGICAL_NO_EXTERNAL_RESOURCES',
  };
  const freeze = decodeCheckSpecification({
    ...common,
    id: checkIds.freeze,
    kind: CheckSpecificationKind.CANDIDATE_FREEZE,
    producerType: EvidenceProducerType.CANDIDATE_MANAGER,
    producerIdentity: M1CandidateEvidenceProducerIdentity.CANDIDATE_MANAGER,
    operation: 'm1.logical.candidate.freeze',
    expectedObservationSchema: 'codeclosure.candidate-freeze-observation.v1',
  });
  const verification = decodeCheckSpecification({
    ...common,
    id: checkIds.verification,
    kind: CheckSpecificationKind.FAKE_VERIFICATION,
    producerType: EvidenceProducerType.VERIFICATION_RUNNER,
    producerIdentity: M1CandidateEvidenceProducerIdentity.VERIFICATION_RUNNER,
    operation: 'm1.logical.fake-verification',
    expectedObservationSchema: 'codeclosure.fake-verification-observation.v1',
  });
  const verificationRef = checkSpecificationRef(verification);
  const obligations = Object.freeze(
    goal.successCriteria
      .filter((criterion) => criterion.required)
      .map((criterion) =>
        decodeVerificationObligation({
          id: obligationIds.nextVerificationObligationId(),
          goalId: goal.id,
          goalRevision: goal.revision,
          candidateGenerationId: generation.id,
          sourceCriterionRefs: [criterion.id],
          scenarioRefs: [`criterion:${criterion.id}`],
          checkSpecRef: verificationRef,
          requiredEvidenceKind: EvidenceKind.TEST_RESULT,
          strength: 'M1_DETERMINISTIC',
          createdAt,
        }),
      ),
  );
  return validateM1CandidateEvidencePolicy(
    goal,
    generation,
    Object.freeze({ freeze, verification, obligations }),
    createdAt,
  );
}
