import { z } from 'zod';

import {
  RecoveryReasonCode,
  RecoveryReconciliationDisposition,
  RecoveryReconciliationPurpose,
  assertRecoveryReconciliationInvariant,
  type RecoveryReconciliationRecord,
  type RecoveryWorkflowReconciled,
} from './recovery.js';
import { RunStatus, WorkflowPhase } from './model.js';
import {
  attemptId,
  candidateGenerationId,
  commandId,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  recoveryReconciliationId,
  sha256Digest,
  workflowId,
  workflowVersion,
} from './identifiers.js';

const recoveryRecordSchema = z
  .object({
    id: z.string(),
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    phase: z.enum(Object.values(WorkflowPhase)),
    inspectedWorkflowVersion: z.number().int().positive(),
    resultingWorkflowVersion: z.number().int().positive(),
    sourceAttemptId: z.string().optional(),
    dispatchClaimDigest: z.string().optional(),
    lastAuditSequence: z.number().int().positive(),
    expectedProjectIdentity: z.string(),
    observedProjectIdentity: z.string().optional(),
    candidateGenerationId: z.string().optional(),
    candidateBaseIdentity: z.string().optional(),
    expectedCandidateDigest: z.string().optional(),
    observedCandidateDigest: z.string().optional(),
    executionProfileId: z.string(),
    executionProfileDigest: z.string(),
    purpose: z.enum(Object.values(RecoveryReconciliationPurpose)),
    disposition: z.enum(Object.values(RecoveryReconciliationDisposition)),
    safeResumePhase: z.enum(Object.values(WorkflowPhase)).optional(),
    reasonCode: z.enum(Object.values(RecoveryReasonCode)),
    observationRefs: z.array(z.string()),
    inspectorVersion: z.string(),
    recoveryPolicyVersion: z.string(),
    inspectedAt: z.string(),
    reconciliationDigest: z.string(),
  })
  .strict();

export function decodeRecoveryReconciliationRecord(value: unknown): RecoveryReconciliationRecord {
  const parsed = recoveryRecordSchema.parse(value);
  const record: RecoveryReconciliationRecord = Object.freeze({
    id: recoveryReconciliationId(parsed.id),
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    phase: parsed.phase,
    inspectedWorkflowVersion: workflowVersion(parsed.inspectedWorkflowVersion),
    resultingWorkflowVersion: workflowVersion(parsed.resultingWorkflowVersion),
    ...(parsed.sourceAttemptId === undefined
      ? {}
      : { sourceAttemptId: attemptId(parsed.sourceAttemptId) }),
    ...(parsed.dispatchClaimDigest === undefined
      ? {}
      : { dispatchClaimDigest: sha256Digest(parsed.dispatchClaimDigest) }),
    lastAuditSequence: parsed.lastAuditSequence,
    expectedProjectIdentity: parsed.expectedProjectIdentity,
    ...(parsed.observedProjectIdentity === undefined
      ? {}
      : { observedProjectIdentity: parsed.observedProjectIdentity }),
    ...(parsed.candidateGenerationId === undefined
      ? {}
      : { candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId) }),
    ...(parsed.candidateBaseIdentity === undefined
      ? {}
      : { candidateBaseIdentity: parsed.candidateBaseIdentity }),
    ...(parsed.expectedCandidateDigest === undefined
      ? {}
      : { expectedCandidateDigest: sha256Digest(parsed.expectedCandidateDigest) }),
    ...(parsed.observedCandidateDigest === undefined
      ? {}
      : { observedCandidateDigest: sha256Digest(parsed.observedCandidateDigest) }),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    purpose: parsed.purpose,
    disposition: parsed.disposition,
    ...(parsed.safeResumePhase === undefined ? {} : { safeResumePhase: parsed.safeResumePhase }),
    reasonCode: parsed.reasonCode,
    observationRefs: Object.freeze([...parsed.observationRefs]),
    inspectorVersion: parsed.inspectorVersion,
    recoveryPolicyVersion: parsed.recoveryPolicyVersion,
    inspectedAt: isoTimestamp(parsed.inspectedAt),
    reconciliationDigest: sha256Digest(parsed.reconciliationDigest),
  });
  assertRecoveryReconciliationInvariant(record);
  return record;
}

const recoveryWorkflowEventSchema = z
  .object({
    type: z.literal('WORKFLOW_RECOVERY_RECONCILED'),
    commandId: z.string(),
    workflowId: z.string(),
    fromPhase: z.enum(Object.values(WorkflowPhase)),
    toPhase: z.enum(Object.values(WorkflowPhase)),
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    resultingRunStatus: z.enum([RunStatus.READY, RunStatus.BLOCKED]),
    reconciliationId: z.string(),
    reconciliationDigest: z.string(),
    reason: z.string(),
    occurredAt: z.string(),
  })
  .strict();

export function decodeRecoveryWorkflowEvent(value: unknown): RecoveryWorkflowReconciled {
  const parsed = recoveryWorkflowEventSchema.parse(value);
  return Object.freeze({
    type: parsed.type,
    commandId: commandId(parsed.commandId),
    workflowId: workflowId(parsed.workflowId),
    fromPhase: parsed.fromPhase,
    toPhase: parsed.toPhase,
    fromVersion: workflowVersion(parsed.fromVersion),
    toVersion: workflowVersion(parsed.toVersion),
    resultingRunStatus: parsed.resultingRunStatus,
    reconciliationId: recoveryReconciliationId(parsed.reconciliationId),
    reconciliationDigest: sha256Digest(parsed.reconciliationDigest),
    reason: parsed.reason,
    occurredAt: isoTimestamp(parsed.occurredAt),
  });
}
