import { z } from 'zod';

import {
  AcceptanceOutcome,
  PendingIssueClassification,
  PendingIssueRepairability,
  PendingIssueSeverity,
  PendingIssueStatus,
  RuleApplicability,
  RuleOutcome,
  assertAcceptanceRepairRecordInvariant,
  assertAcceptanceDecisionInvariant,
  assertAcceptanceInputManifestInvariant,
  assertCloseoutRecordInvariant,
  assertPendingIssueInvariant,
  assertPendingIssueSetInvariant,
  assertRuleResultInvariant,
  type AcceptanceDecision,
  type AcceptanceInputManifest,
  type AcceptanceRepairRecord,
  type CloseoutRecord,
  type PendingIssue,
  type PendingIssueSet,
  type RuleResult,
} from './acceptance.js';
import {
  aggregateVersion,
  acceptanceDecisionId,
  acceptanceCriticalVerificationPlanId,
  candidateGenerationId,
  checkSpecificationId,
  goalId,
  goalRevision,
  isoTimestamp,
  pendingIssueId,
  policyBundleId,
  sha256Digest,
  verificationObligationId,
  workflowId,
  workflowVersion,
} from './identifiers.js';
import { WorkflowPhase } from './model.js';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected a non-blank string',
});

const pendingIssueSchema = z
  .object({
    id: z.string(),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    candidateGenerationId: z.string().optional(),
    classification: z.enum(Object.values(PendingIssueClassification)),
    severity: z.enum(Object.values(PendingIssueSeverity)),
    description: nonBlankStringSchema,
    sourceRefs: z.array(nonBlankStringSchema),
    repairability: z.enum(Object.values(PendingIssueRepairability)),
    status: z.enum(Object.values(PendingIssueStatus)),
    createdAt: z.string(),
    resolvedAt: z.string().optional(),
  })
  .strict();

export function decodePendingIssue(value: unknown): PendingIssue {
  const parsed = pendingIssueSchema.parse(value);
  const issue: PendingIssue = Object.freeze({
    id: pendingIssueId(parsed.id),
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    ...(parsed.candidateGenerationId === undefined
      ? {}
      : { candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId) }),
    classification: parsed.classification,
    severity: parsed.severity,
    description: parsed.description,
    sourceRefs: Object.freeze([...parsed.sourceRefs]),
    repairability: parsed.repairability,
    status: parsed.status,
    createdAt: isoTimestamp(parsed.createdAt),
    ...(parsed.resolvedAt === undefined ? {} : { resolvedAt: isoTimestamp(parsed.resolvedAt) }),
  });
  assertPendingIssueInvariant(issue);
  return issue;
}

const pendingIssueSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    issues: z.array(z.unknown()),
    digest: z.string(),
  })
  .strict();

export function decodePendingIssueSet(value: unknown): PendingIssueSet {
  const parsed = pendingIssueSetSchema.parse(value);
  const set: PendingIssueSet = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    issues: Object.freeze(parsed.issues.map((issue) => decodePendingIssue(issue))),
    digest: sha256Digest(parsed.digest),
  });
  assertPendingIssueSetInvariant(set);
  return set;
}

const manifestBaseShape = {
  goalId: z.string(),
  goalRevision: z.number().int().positive(),
  workflowId: z.string(),
  workflowVersion: z.number().int().positive(),
  phase: z.literal(WorkflowPhase.FINAL_VERIFY),
  factSnapshotDigest: z.string(),
  decisionSetDigest: z.string(),
  scenarioSetDigest: z.string(),
  candidateGenerationId: z.string(),
  candidateDigest: z.string(),
  evidenceSetDigest: z.string(),
  pendingIssueSetDigest: z.string(),
  policyBundleId: z.string(),
  policyBundleDigest: z.string(),
  createdAt: z.string(),
  manifestDigest: z.string(),
} as const;
const manifestSchema = z.union([
  z.object({ schemaVersion: z.literal(1), ...manifestBaseShape }).strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      ...manifestBaseShape,
      acceptanceCriticalVerificationPlanId: z.string(),
      acceptanceCriticalVerificationPlanDigest: z.string(),
    })
    .strict(),
]);

export function decodeAcceptanceInputManifest(value: unknown): AcceptanceInputManifest {
  const parsed = manifestSchema.parse(value);
  const base = {
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    phase: parsed.phase,
    factSnapshotDigest: sha256Digest(parsed.factSnapshotDigest),
    decisionSetDigest: sha256Digest(parsed.decisionSetDigest),
    scenarioSetDigest: sha256Digest(parsed.scenarioSetDigest),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    candidateDigest: sha256Digest(parsed.candidateDigest),
    evidenceSetDigest: sha256Digest(parsed.evidenceSetDigest),
    pendingIssueSetDigest: sha256Digest(parsed.pendingIssueSetDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    createdAt: isoTimestamp(parsed.createdAt),
    manifestDigest: sha256Digest(parsed.manifestDigest),
  } as const;
  const manifest: AcceptanceInputManifest =
    parsed.schemaVersion === 1
      ? Object.freeze({ ...base, schemaVersion: parsed.schemaVersion })
      : Object.freeze({
          ...base,
          schemaVersion: parsed.schemaVersion,
          acceptanceCriticalVerificationPlanId: acceptanceCriticalVerificationPlanId(
            parsed.acceptanceCriticalVerificationPlanId,
          ),
          acceptanceCriticalVerificationPlanDigest: sha256Digest(
            parsed.acceptanceCriticalVerificationPlanDigest,
          ),
        });
  assertAcceptanceInputManifestInvariant(manifest);
  return manifest;
}

const ruleResultSchema = z
  .object({
    ruleId: nonBlankStringSchema,
    ruleVersion: nonBlankStringSchema,
    applicability: z.enum(Object.values(RuleApplicability)),
    outcome: z.enum(Object.values(RuleOutcome)),
    reasonCode: nonBlankStringSchema,
    message: nonBlankStringSchema,
    inputRefs: z.array(nonBlankStringSchema),
    evidenceRefs: z.array(nonBlankStringSchema),
    checkerDigest: z.string(),
  })
  .strict();

export function decodeRuleResult(value: unknown): RuleResult {
  const parsed = ruleResultSchema.parse(value);
  const result: RuleResult = Object.freeze({
    ...parsed,
    inputRefs: Object.freeze([...parsed.inputRefs]),
    evidenceRefs: Object.freeze([...parsed.evidenceRefs]),
    checkerDigest: sha256Digest(parsed.checkerDigest),
  });
  assertRuleResultInvariant(result);
  return result;
}

const acceptanceDecisionSchema = z
  .object({
    id: z.string(),
    schemaVersion: z.literal(1),
    inputManifestDigest: z.string(),
    policyBundleDigest: z.string(),
    outcome: z.enum(Object.values(AcceptanceOutcome)),
    dominantReasonCode: nonBlankStringSchema,
    ruleResults: z.array(z.unknown()),
    engineVersion: nonBlankStringSchema,
    issuedAt: z.string(),
    decisionDigest: z.string(),
  })
  .strict();

export function decodeAcceptanceDecision(value: unknown): AcceptanceDecision {
  const parsed = acceptanceDecisionSchema.parse(value);
  const decision: AcceptanceDecision = Object.freeze({
    id: acceptanceDecisionId(parsed.id),
    schemaVersion: parsed.schemaVersion,
    inputManifestDigest: sha256Digest(parsed.inputManifestDigest),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    outcome: parsed.outcome,
    dominantReasonCode: parsed.dominantReasonCode,
    ruleResults: Object.freeze(parsed.ruleResults.map((result) => decodeRuleResult(result))),
    engineVersion: parsed.engineVersion,
    issuedAt: isoTimestamp(parsed.issuedAt),
    decisionDigest: sha256Digest(parsed.decisionDigest),
  });
  assertAcceptanceDecisionInvariant(decision);
  return decision;
}

const closeoutRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    workflowVersion: z.number().int().positive(),
    acceptanceDecisionId: z.string(),
    acceptanceDecisionDigest: z.string(),
    inputManifestDigest: z.string(),
    candidateGenerationId: z.string(),
    candidateDigest: z.string(),
    evidenceSetDigest: z.string(),
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    closedAt: z.string(),
  })
  .strict();

export function decodeCloseoutRecord(value: unknown): CloseoutRecord {
  const parsed = closeoutRecordSchema.parse(value);
  const record: CloseoutRecord = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    acceptanceDecisionId: acceptanceDecisionId(parsed.acceptanceDecisionId),
    acceptanceDecisionDigest: sha256Digest(parsed.acceptanceDecisionDigest),
    inputManifestDigest: sha256Digest(parsed.inputManifestDigest),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    candidateDigest: sha256Digest(parsed.candidateDigest),
    evidenceSetDigest: sha256Digest(parsed.evidenceSetDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    closedAt: isoTimestamp(parsed.closedAt),
  });
  assertCloseoutRecordInvariant(record);
  return record;
}

const acceptanceRepairRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    workflowVersion: z.number().int().positive(),
    acceptanceDecisionId: z.string(),
    acceptanceDecisionDigest: z.string(),
    inputManifestDigest: z.string(),
    rejectedCandidateGenerationId: z.string(),
    rejectedCandidateVersion: z.number().int().positive(),
    rejectedCandidateDigest: z.string(),
    repairCandidateGenerationId: z.string(),
    repairCandidateSequence: z.number().int().positive(),
    repairCandidateBaseDigest: z.string(),
    freezeCheckId: z.string(),
    freezeCheckVersion: nonBlankStringSchema,
    verificationCheckId: z.string(),
    verificationCheckVersion: nonBlankStringSchema,
    verificationObligationIds: z.array(z.string()),
    evidenceSetDigest: z.string(),
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    repairedAt: z.string(),
    repairDigest: z.string(),
  })
  .strict();

export function decodeAcceptanceRepairRecord(value: unknown): AcceptanceRepairRecord {
  const parsed = acceptanceRepairRecordSchema.parse(value);
  const record: AcceptanceRepairRecord = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    acceptanceDecisionId: acceptanceDecisionId(parsed.acceptanceDecisionId),
    acceptanceDecisionDigest: sha256Digest(parsed.acceptanceDecisionDigest),
    inputManifestDigest: sha256Digest(parsed.inputManifestDigest),
    rejectedCandidateGenerationId: candidateGenerationId(parsed.rejectedCandidateGenerationId),
    rejectedCandidateVersion: aggregateVersion(parsed.rejectedCandidateVersion),
    rejectedCandidateDigest: sha256Digest(parsed.rejectedCandidateDigest),
    repairCandidateGenerationId: candidateGenerationId(parsed.repairCandidateGenerationId),
    repairCandidateSequence: parsed.repairCandidateSequence,
    repairCandidateBaseDigest: sha256Digest(parsed.repairCandidateBaseDigest),
    freezeCheckId: checkSpecificationId(parsed.freezeCheckId),
    freezeCheckVersion: parsed.freezeCheckVersion,
    verificationCheckId: checkSpecificationId(parsed.verificationCheckId),
    verificationCheckVersion: parsed.verificationCheckVersion,
    verificationObligationIds: Object.freeze(
      parsed.verificationObligationIds.map((id) => verificationObligationId(id)),
    ),
    evidenceSetDigest: sha256Digest(parsed.evidenceSetDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    repairedAt: isoTimestamp(parsed.repairedAt),
    repairDigest: sha256Digest(parsed.repairDigest),
  });
  assertAcceptanceRepairRecordInvariant(record);
  return record;
}
