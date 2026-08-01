import {
  AcceptanceOutcome,
  CandidateGenerationState,
  EvidenceEligibilityState,
  EvidenceKind,
  EvidenceResultStatus,
  sha256Digest,
  type AcceptanceDecision,
  type AcceptanceInputManifest,
  type AcceptanceRepairRecord,
  type CandidateGeneration,
  type EvidenceEligibility,
  type EvidenceRecord,
  type EvidenceSet,
  type Goal,
  type PolicyBundleId,
  type PriorAttemptFeedback,
  type RepairContext,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowVersion,
} from '@codeclosure/domain';

import type { DigestProvider } from './ports.js';

export interface BoundedM2RepairEvidenceSource {
  readonly record: EvidenceRecord;
  readonly eligibility: EvidenceEligibility;
}

export interface BoundedM2RepairContextSources {
  readonly goal: Goal;
  readonly workflowId: WorkflowId;
  readonly contextWorkflowVersion: WorkflowVersion;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly repair: AcceptanceRepairRecord;
  readonly decision: AcceptanceDecision;
  readonly manifest: AcceptanceInputManifest;
  readonly evidenceSet: EvidenceSet;
  readonly parent: CandidateGeneration;
  readonly child: CandidateGeneration;
  readonly freezeEvidence: BoundedM2RepairEvidenceSource;
  readonly evidence: readonly BoundedM2RepairEvidenceSource[];
}

export interface BoundedM2RepairCompilationInput {
  readonly repairContext: RepairContext;
  readonly priorAttemptFeedback: PriorAttemptFeedback;
}

function digest(digests: DigestProvider, value: unknown): Sha256Digest {
  return sha256Digest(digests.digest(value));
}

function sourceArrays(values: readonly { readonly ref: string; readonly digest: Sha256Digest }[]): {
  readonly sourceRefs: readonly string[];
  readonly sourceDigests: readonly Sha256Digest[];
} {
  const sorted = values.toSorted((left, right) => left.ref.localeCompare(right.ref));
  return Object.freeze({
    sourceRefs: Object.freeze(sorted.map(({ ref }) => ref)),
    sourceDigests: Object.freeze(sorted.map(({ digest: sourceDigest }) => sourceDigest)),
  });
}

/**
 * Builds the one closed M2 repair projection from decoded durable authority.
 * It deliberately accepts no transcript, Worker summary, changed-file list,
 * attempted approach, hypothesis, or old backend-session state.
 */
export function compileBoundedM2RepairContext(
  rawSources: BoundedM2RepairContextSources,
  digests: DigestProvider,
): BoundedM2RepairCompilationInput {
  const sources = Object.freeze({
    ...rawSources,
    freezeEvidence: Object.freeze({ ...rawSources.freezeEvidence }),
    evidence: Object.freeze([...rawSources.evidence]),
  });
  const { goal, repair, decision, manifest, evidenceSet, parent, child } = sources;
  const authorityMismatch =
    repair.goalId !== goal.id || repair.goalRevision !== goal.revision
      ? 'REPAIR_GOAL'
      : repair.workflowId !== sources.workflowId
        ? 'REPAIR_WORKFLOW'
        : repair.workflowVersion + 1 !== sources.contextWorkflowVersion
          ? 'REPAIR_CONTEXT_WORKFLOW_VERSION'
          : repair.policyBundleId !== sources.policyBundleId ||
              repair.policyBundleDigest !== sources.policyBundleDigest
            ? 'REPAIR_POLICY'
            : decision.id !== repair.acceptanceDecisionId ||
                decision.decisionDigest !== repair.acceptanceDecisionDigest ||
                decision.inputManifestDigest !== repair.inputManifestDigest ||
                decision.outcome !== AcceptanceOutcome.REJECT_REPAIRABLE
              ? 'ACCEPTANCE_DECISION'
              : manifest.manifestDigest !== repair.inputManifestDigest ||
                  manifest.goalId !== goal.id ||
                  manifest.goalRevision !== goal.revision ||
                  manifest.workflowId !== sources.workflowId ||
                  manifest.candidateGenerationId !== repair.rejectedCandidateGenerationId ||
                  manifest.candidateDigest !== repair.rejectedCandidateDigest ||
                  manifest.evidenceSetDigest !== repair.evidenceSetDigest ||
                  manifest.policyBundleId !== sources.policyBundleId ||
                  manifest.policyBundleDigest !== sources.policyBundleDigest
                ? 'ACCEPTANCE_INPUT_MANIFEST'
                : evidenceSet.digest !== repair.evidenceSetDigest ||
                    evidenceSet.goalId !== goal.id ||
                    evidenceSet.goalRevision !== goal.revision ||
                    evidenceSet.candidateGenerationId !== repair.rejectedCandidateGenerationId ||
                    evidenceSet.candidateDigest !== repair.rejectedCandidateDigest
                  ? 'EVIDENCE_SET'
                  : parent.id !== repair.rejectedCandidateGenerationId ||
                      parent.version !== repair.rejectedCandidateVersion ||
                      parent.state !== CandidateGenerationState.REJECTED ||
                      parent.frozenDigest !== repair.rejectedCandidateDigest
                    ? 'REJECTED_PARENT'
                    : child.id !== repair.repairCandidateGenerationId
                      ? 'REPAIR_CHILD_ID'
                      : child.parentGenerationId !== parent.id
                        ? 'REPAIR_CHILD_PARENT'
                        : child.sequence !== repair.repairCandidateSequence
                          ? 'REPAIR_CHILD_SEQUENCE'
                          : child.baseDigest !== repair.repairCandidateBaseDigest
                            ? 'REPAIR_CHILD_BASE'
                            : undefined;
  if (authorityMismatch !== undefined) {
    throw new TypeError(
      `Repair Context sources do not share exact repair authority (${authorityMismatch})`,
    );
  }

  const expectedEvidenceIds = evidenceSet.evidenceRefs.map(({ evidenceId }) => evidenceId);
  const actualEvidenceIds = sources.evidence.map(({ record }) => record.id).toSorted();
  if (JSON.stringify(expectedEvidenceIds) !== JSON.stringify(actualEvidenceIds)) {
    throw new TypeError('Repair Context source set does not equal its Evidence Set');
  }
  const evidenceById = new Map(sources.evidence.map((entry) => [entry.record.id, entry]));
  for (const reference of evidenceSet.evidenceRefs) {
    const source = evidenceById.get(reference.evidenceId);
    if (
      source?.record.recordDigest !== reference.evidenceRecordDigest ||
      source.record.goalId !== goal.id ||
      source.record.goalRevision !== goal.revision ||
      source.record.workflowId !== sources.workflowId ||
      source.record.candidateGenerationId !== parent.id ||
      source.record.candidateDigest !== repair.rejectedCandidateDigest ||
      source.eligibility.evidenceId !== reference.evidenceId ||
      source.eligibility.version !== reference.eligibilityVersion ||
      source.eligibility.state !== reference.eligibilityState
    ) {
      throw new TypeError('Repair Context Evidence snapshot is stale or mismatched');
    }
  }

  const freezeEvidence = sources.freezeEvidence;
  if (
    Reflect.get(freezeEvidence.record, 'kind') !== EvidenceKind.CANDIDATE_FREEZE ||
    freezeEvidence.record.observation.kind !== EvidenceKind.CANDIDATE_FREEZE ||
    freezeEvidence.record.goalId !== goal.id ||
    freezeEvidence.record.goalRevision !== goal.revision ||
    freezeEvidence.record.workflowId !== sources.workflowId ||
    freezeEvidence.record.candidateGenerationId !== parent.id ||
    freezeEvidence.record.candidateDigest !== repair.rejectedCandidateDigest ||
    freezeEvidence.eligibility.evidenceId !== freezeEvidence.record.id ||
    freezeEvidence.eligibility.version !== 1 ||
    freezeEvidence.eligibility.state !== EvidenceEligibilityState.ELIGIBLE
  ) {
    throw new TypeError('Repair Context has no eligible parent Candidate-freeze Evidence');
  }
  const failedEvidence = sources.evidence
    .filter(
      ({ record, eligibility }) =>
        record.resultStatus === EvidenceResultStatus.FAIL &&
        eligibility.state === EvidenceEligibilityState.ELIGIBLE,
    )
    .map(({ record, eligibility }) => {
      if (record.kind === EvidenceKind.CANDIDATE_FREEZE) {
        throw new TypeError('Candidate-freeze Evidence cannot be a failed repair check');
      }
      return Object.freeze({
        evidenceId: record.id,
        evidenceRecordDigest: record.recordDigest,
        evidenceEligibilityVersion: eligibility.version,
        evidenceEligibilityState: EvidenceEligibilityState.ELIGIBLE,
        resultStatus: EvidenceResultStatus.FAIL,
        verificationObligationId: record.verificationObligationId,
        checkSpecificationId: record.checkSpec.id,
        checkSpecificationDigest: digest(digests, record.checkSpec),
      });
    })
    .toSorted((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  if (failedEvidence.length === 0) {
    throw new TypeError('Repair Context Evidence Set contains no eligible failing Evidence');
  }

  const goalSourceDigest = digest(digests, {
    objective: goal.objective,
    successCriteria: goal.successCriteria,
    scope: goal.scope,
    nonGoals: goal.nonGoals,
  });
  const constraintsToPreserve = [
    ...goal.scope.allowedPaths.map((content) =>
      Object.freeze({
        kind: 'ALLOWED_PATH' as const,
        content,
        sourceRef: goal.id,
        sourceDigest: goalSourceDigest,
      }),
    ),
    ...goal.nonGoals.map((content) =>
      Object.freeze({
        kind: 'NON_GOAL' as const,
        content,
        sourceRef: goal.id,
        sourceDigest: goalSourceDigest,
      }),
    ),
  ].toSorted((left, right) =>
    `${left.kind}\u0000${left.content}`.localeCompare(`${right.kind}\u0000${right.content}`),
  );
  const repairContext: RepairContext = Object.freeze({
    schemaVersion: 1,
    acceptanceRepairDigest: repair.repairDigest,
    acceptanceDecisionId: decision.id,
    acceptanceDecisionDigest: decision.decisionDigest,
    inputManifestDigest: manifest.manifestDigest,
    evidenceSetDigest: evidenceSet.digest,
    rejectedCandidateGenerationId: parent.id,
    rejectedCandidateVersion: parent.version,
    rejectedCandidateDigest: repair.rejectedCandidateDigest,
    repairCandidateGenerationId: child.id,
    repairCandidateSequence: child.sequence,
    repairCandidateBaseDigest: child.baseDigest,
    parentChangeSetDigest: freezeEvidence.record.observation.changeSetDigest,
    failedEvidence: Object.freeze(failedEvidence),
    constraintsToPreserve: Object.freeze(constraintsToPreserve),
  });
  const feedbackItems = [
    ...failedEvidence.map((evidence) =>
      Object.freeze({
        kind: 'FAILED_CHECK' as const,
        content: `Required check ${evidence.checkSpecificationId} produced FAIL for obligation ${evidence.verificationObligationId}.`,
        ...sourceArrays([
          { ref: decision.id, digest: decision.decisionDigest },
          { ref: evidence.evidenceId, digest: evidence.evidenceRecordDigest },
        ]),
      }),
    ),
    Object.freeze({
      kind: 'PARENT_CHANGE_SET' as const,
      content: `The rejected parent is bound to change-set digest ${repairContext.parentChangeSetDigest}.`,
      ...sourceArrays([
        {
          ref: freezeEvidence.record.id,
          digest: freezeEvidence.record.recordDigest,
        },
      ]),
    }),
    ...constraintsToPreserve.map((constraint) =>
      Object.freeze({
        kind: 'PRESERVATION_CONSTRAINT' as const,
        content: `Preserve ${constraint.kind}: ${constraint.content}`,
        ...sourceArrays([{ ref: constraint.sourceRef, digest: constraint.sourceDigest }]),
      }),
    ),
  ].toSorted((left, right) =>
    `${left.kind}\u0000${left.content}`.localeCompare(`${right.kind}\u0000${right.content}`),
  );
  const feedbackWithoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    items: Object.freeze(feedbackItems),
  });
  const priorAttemptFeedback: PriorAttemptFeedback = Object.freeze({
    ...feedbackWithoutDigest,
    feedbackDigest: digest(digests, feedbackWithoutDigest),
  });
  return Object.freeze({ repairContext, priorAttemptFeedback });
}
