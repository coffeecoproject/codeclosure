import { z } from 'zod';

import {
  AttemptFailureClass,
  AttemptStatus,
  CandidateGenerationState,
  EvidenceEligibilityState,
  GoalStatus,
  RunStatus,
  WorkflowPhase,
  auditEventId,
  decodeAcceptanceDecision,
  decodeAcceptanceInputManifest,
  decodeAcceptanceRepairRecord,
  decodeAcceptanceCriticalVerificationPlan,
  decodeCandidate,
  decodeCandidateGeneration,
  decodeCheckSpecification,
  decodeEvidenceEligibility,
  decodeEvidenceRecord,
  decodeEvidenceSet,
  decodeExecutionProfile,
  decodeExecutionProfileBinding,
  decodeExternalBackendCapabilityRecord,
  decodeExternalExecutionObservation,
  decodeExternalExecutionRecord,
  decodeExternalMaintenanceIntent,
  decodeRecoveryReconciliationRecord,
  decodeCloseoutRecord,
  decodePendingIssue,
  commandId,
  decodeAttemptSnapshot,
  decodeContextManifest,
  decodeGoalSnapshot,
  decodePolicyBundle,
  decodeWorkflowPolicyBinding,
  decodeVerificationObligation,
  decodeWorkflowSnapshot,
  goalId,
  isoTimestamp,
  sha256Digest,
  workflowId,
  type ContextManifest,
  type Attempt,
  type AcceptanceDecision,
  type AcceptanceInputManifest,
  type AcceptanceRepairRecord,
  type AcceptanceCriticalVerificationPlan,
  type AuditEventId,
  type CommandId,
  type Candidate,
  type CandidateGeneration,
  type CheckSpecification,
  type EvidenceEligibility,
  type EvidenceRecord,
  type EvidenceSet,
  type ExecutionProfile,
  type ExecutionProfileBinding,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionObservation,
  type ExternalExecutionRecord,
  type ExternalMaintenanceIntent,
  type RecoveryReconciliationRecord,
  type CloseoutRecord,
  type Goal,
  type GoalId,
  type IsoTimestamp,
  type PolicyBundle,
  type PendingIssue,
  type Sha256Digest,
  type WorkflowInstance,
  type WorkflowId,
  type WorkflowPolicyBinding,
  type VerificationObligation,
} from '@codeclosure/domain';
import {
  decodeWorkerDispatchClaim,
  decodeWorkerEventReceipt,
  type InstalledExecutionProfile,
  type InstalledPolicyBundle,
  type WorkerDispatchClaim,
  type WorkerEventReceipt,
} from '@codeclosure/runtime';

import { PersistenceDecodeError } from './errors.js';
import { parseJson, type JsonValue } from './json.js';

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  error: 'String must not be blank',
});
const goalStatusSchema = z.enum([
  GoalStatus.ACTIVE,
  GoalStatus.WAITING_FOR_INPUT,
  GoalStatus.BLOCKED,
  GoalStatus.CANCELLED,
  GoalStatus.CLOSED,
]);
const workflowPhaseSchema = z.enum([
  WorkflowPhase.DISCOVERY,
  WorkflowPhase.PLAN,
  WorkflowPhase.IMPLEMENT,
  WorkflowPhase.SOURCE_FREEZE,
  WorkflowPhase.EVIDENCE_BUILD,
  WorkflowPhase.FINAL_VERIFY,
  WorkflowPhase.CLOSEOUT,
]);
const runStatusSchema = z.enum([
  RunStatus.READY,
  RunStatus.RUNNING,
  RunStatus.WAITING_FOR_INPUT,
  RunStatus.BLOCKED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
  RunStatus.CLOSED,
]);
const attemptStatusSchema = z.enum([
  AttemptStatus.RUNNING,
  AttemptStatus.RESULT_RECORDED,
  AttemptStatus.FAILED,
  AttemptStatus.INTERRUPTED,
]);
const attemptFailureClassSchema = z.enum([
  AttemptFailureClass.TRANSIENT_BACKEND,
  AttemptFailureClass.TIMEOUT,
  AttemptFailureClass.ABRUPT_TERMINATION,
  AttemptFailureClass.PROTOCOL_ERROR,
  AttemptFailureClass.INTEGRITY_VIOLATION,
  AttemptFailureClass.PERMANENT_BACKEND,
  AttemptFailureClass.UNKNOWN,
]);
const goalRowSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  objective: z.string().min(1),
  project_path: z.string().min(1),
  allowed_paths_json: z.string(),
  non_goals_json: z.string(),
  status: goalStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

const criterionRowSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  required: z.union([z.literal(0), z.literal(1)]),
});

const workflowRowSchema = z.object({
  id: z.string(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  phase: workflowPhaseSchema,
  run_status: runStatusSchema,
  version: z.number().int().positive(),
  active_attempt_id: z.string().nullable(),
  active_candidate_generation_id: z.string().nullable(),
  suspended_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const attemptRowSchema = z.object({
  id: z.string(),
  workflow_id: z.string(),
  phase: workflowPhaseSchema,
  sequence: z.number().int().positive(),
  context_manifest_id: z.string().nullable(),
  capability_grant_json: z.string(),
  worker_session_ref: z.string().nullable(),
  status: attemptStatusSchema,
  failure_class: attemptFailureClassSchema.nullable(),
  termination_reason: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
});

const processedCommandRowSchema = z.object({
  command_id: z.string(),
  input_digest: z.string(),
  aggregate_type: z.enum(['GOAL', 'WORKFLOW']),
  aggregate_id: z.string().min(1),
  outcome_json: z.string(),
  completed_at: z.string(),
});

const auditEventRowSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  aggregate_type: nonBlankStringSchema,
  aggregate_id: nonBlankStringSchema,
  event_type: nonBlankStringSchema,
  actor_type: nonBlankStringSchema,
  command_id: z.string().nullable(),
  before_version: z.number().int().positive().nullable(),
  after_version: z.number().int().positive().nullable(),
  correlation_id: nonBlankStringSchema.nullable(),
  causation_id: nonBlankStringSchema.nullable(),
  payload_digest: z.string(),
  occurred_at: z.string(),
});

const contextManifestRowSchema = z.object({
  id: z.string(),
  schema_version: z.number().int().positive(),
  compiler_version: z.string(),
  created_at: z.string(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  workflow_id: z.string(),
  workflow_version: z.number().int().positive(),
  phase: workflowPhaseSchema,
  attempt_id: z.string(),
  candidate_generation_id: z.string().nullable(),
  candidate_digest: z.string().nullable(),
  execution_profile_id: z.string(),
  execution_profile_digest: z.string(),
  policy_bundle_id: z.string(),
  policy_bundle_digest: z.string(),
  capability_grant_digest: z.string(),
  response_contract_digest: z.string(),
  entries_json: z.string(),
  omission_decisions_json: z.string(),
  package_digest: z.string(),
  manifest_digest: z.string(),
  logical_schema_version: z.number().int().positive().nullable().optional(),
  repair_context_digest: z.string().nullable().optional(),
  prior_attempt_feedback_digest: z.string().nullable().optional(),
  protected_logical_schema_version: z.number().int().positive().nullable().optional(),
  verification_plan_id: z.string().nullable().optional(),
  verification_plan_digest: z.string().nullable().optional(),
});

const acceptanceCriticalVerificationPlanRowSchema = z.object({
  id: z.string(),
  schema_version: z.literal(1),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  workflow_id: z.string(),
  workflow_version_at_lock: z.number().int().positive(),
  policy_bundle_id: z.string(),
  policy_bundle_digest: z.string(),
  execution_profile_id: z.string(),
  execution_profile_digest: z.string(),
  protected_asset_manifest_digest: z.string(),
  canonical_json: z.string(),
  plan_digest: z.string(),
  audit_sequence: z.number().int().positive(),
});

const policyBundleRowSchema = z.object({
  id: z.string(),
  schema_version: z.number().int().positive(),
  policy_version: z.string(),
  checker_identities_json: z.string(),
  canonical_content_json: z.string(),
  bundle_digest: z.string(),
  installed_at: z.string(),
});

const executionProfileRowSchema = z.object({
  id: z.string(),
  schema_version: z.number().int().positive(),
  profile_version: nonBlankStringSchema,
  canonical_content_json: z.string(),
  profile_digest: z.string(),
  installed_at: z.string(),
  logical_schema_version: z.number().int().positive().nullable().optional(),
  capability_record_digest: z.string().nullable().optional(),
  external_execution_json: z.string().nullable().optional(),
});

const externalBackendCapabilityRowSchema = z.object({
  record_digest: z.string(),
  schema_version: z.literal(1),
  backend_kind: nonBlankStringSchema,
  binary_identity_digest: z.string(),
  protocol_schema_digest: z.string(),
  configuration_profile_digest: z.string(),
  capability_entries_json: z.string(),
  observed_at: z.string(),
});

const externalExecutionRowSchema = z.object({
  id: z.string(),
  schema_version: z.literal(1),
  version: z.number().int().positive(),
  state: z.string(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  workflow_id: z.string(),
  workflow_version_at_authorization: z.number().int().positive(),
  phase: workflowPhaseSchema,
  phase_version: z.number().int().positive(),
  attempt_id: z.string(),
  worker_session_id: z.string(),
  dispatch_claim_digest: z.string(),
  context_manifest_id: z.string(),
  context_manifest_digest: z.string(),
  context_package_digest: z.string(),
  execution_profile_id: z.string(),
  execution_profile_digest: z.string(),
  policy_bundle_id: z.string(),
  policy_bundle_digest: z.string(),
  backend_kind: nonBlankStringSchema,
  binary_identity_digest: z.string(),
  binary_protocol_schema_digest: z.string(),
  execution_config_digest: z.string(),
  managed_requirements_digest: z.string(),
  instruction_source_manifest_digest: z.string(),
  controlled_state_root_identity: nonBlankStringSchema,
  process_launch_nonce: z.string(),
  thread_json: z.string(),
  continuity_policy: z.string(),
  compaction_policy: z.string(),
  retention_policy: z.string(),
  fallback_policy: z.string(),
  interruption_policy: z.string(),
  candidate_workspace_lease_id: z.string().nullable(),
  candidate_workspace_lease_digest: z.string().nullable(),
  candidate_workspace_cwd_identity: z.string().nullable(),
  authorized_at: z.string(),
  intent_digest: z.string(),
  process_identity_json: z.string().nullable(),
  backend_session_ref: z.string().nullable(),
  backend_operation_ref: z.string().nullable(),
  compaction_count: z.number().int().nonnegative(),
  turn_interrupt_count: z.number().int().nonnegative(),
  failure_code: z.string().nullable(),
  result_event_id: z.string().nullable(),
  updated_at: z.string(),
  terminal_at: z.string().nullable(),
  last_observation_id: z.string().nullable(),
  audit_sequence: z.number().int().positive(),
  record_digest: z.string(),
});

const externalExecutionObservationRowSchema = z.object({
  id: z.string(),
  schema_version: z.literal(1),
  external_execution_id: z.string(),
  intent_digest: z.string(),
  expected_record_version: z.number().int().positive(),
  state: z.string(),
  process_identity_json: z.string().nullable(),
  backend_session_ref: z.string().nullable(),
  backend_operation_ref: z.string().nullable(),
  compaction_count: z.number().int().nonnegative(),
  turn_interrupt_count: z.number().int().nonnegative(),
  failure_code: z.string().nullable(),
  result_event_id: z.string().nullable(),
  observed_at: z.string(),
  observation_digest: z.string(),
});

const externalMaintenanceIntentRowSchema = z.object({
  id: z.string(),
  schema_version: z.literal(1),
  external_execution_id: z.string(),
  sequence: z.number().int().positive(),
  kind: z.string(),
  state: z.string(),
  authorized_at: z.string(),
  observed_at: z.string().nullable(),
  failure_code: z.string().nullable(),
  intent_digest: z.string(),
  record_digest: z.string(),
});

const executionProfileBindingRowSchema = z.object({
  workflow_id: z.string(),
  schema_version: z.number().int().positive(),
  goal_id: z.string(),
  profile_id: z.string(),
  profile_version: nonBlankStringSchema,
  profile_digest: z.string(),
  start_command_id: z.string(),
  bound_at: z.string(),
  binding_digest: z.string(),
});

const workflowPolicyBindingRowSchema = z.object({
  workflow_id: z.string(),
  schema_version: z.literal(1),
  goal_id: z.string(),
  policy_bundle_id: z.string(),
  policy_bundle_version: nonBlankStringSchema,
  policy_bundle_digest: z.string(),
  start_command_id: z.string(),
  bound_at: z.string(),
  binding_digest: z.string(),
});

const recoveryReconciliationRowSchema = z.object({
  id: z.string(),
  schema_version: z.literal(1),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  workflow_id: z.string(),
  phase: workflowPhaseSchema,
  inspected_workflow_version: z.number().int().positive(),
  resulting_workflow_version: z.number().int().positive(),
  source_attempt_id: z.string().nullable(),
  dispatch_claim_digest: z.string().nullable(),
  last_audit_sequence: z.number().int().positive(),
  expected_project_identity: nonBlankStringSchema,
  observed_project_identity: nonBlankStringSchema.nullable(),
  candidate_generation_id: z.string().nullable(),
  candidate_base_identity: nonBlankStringSchema.nullable(),
  expected_candidate_digest: z.string().nullable(),
  observed_candidate_digest: z.string().nullable(),
  execution_profile_id: z.string(),
  execution_profile_digest: z.string(),
  purpose: z.enum(['STARTUP', 'RESUME']),
  disposition: z.enum(['SAFE_SAME_PHASE', 'SAFE_EARLIER_PHASE', 'BLOCKED']),
  safe_resume_phase: workflowPhaseSchema.nullable(),
  reason_code: z.enum([
    'EXACT_AUTHORITY_MATCH',
    'INSPECTION_UNAVAILABLE',
    'INSPECTOR_FAILURE',
    'PROFILE_BINDING_MISSING',
    'PROFILE_BINDING_MISMATCH',
    'SOURCE_ATTEMPT_NOT_RECOVERABLE',
    'PROJECT_IDENTITY_MISMATCH',
    'CANDIDATE_AUTHORITY_MISSING',
    'CANDIDATE_GENERATION_MISMATCH',
    'CANDIDATE_BASE_IDENTITY_MISMATCH',
    'CANDIDATE_DIGEST_MISMATCH',
    'LOCAL_COMMAND_VERIFICATION_SESSION_UNAVAILABLE',
    'UNSUPPORTED_RECOVERY_PHASE',
  ]),
  observation_refs_json: z.string(),
  inspector_version: nonBlankStringSchema,
  recovery_policy_version: nonBlankStringSchema,
  inspected_at: z.string(),
  reconciliation_digest: z.string(),
});

const workerDispatchClaimRowSchema = z.object({
  attempt_id: z.string(),
  schema_version: z.number().int().positive(),
  workflow_id: z.string(),
  workflow_version: z.number().int().positive(),
  worker_session_id: z.string(),
  context_manifest_id: z.string(),
  context_manifest_digest: z.string(),
  package_digest: z.string(),
  execution_profile_id: z.string(),
  execution_profile_digest: z.string(),
  claimed_at: z.string(),
});

const workerEventReceiptRowSchema = z.object({
  event_id: z.string(),
  schema_version: z.number().int().positive(),
  payload_digest: z.string(),
  worker_session_id: z.string(),
  workflow_id: z.string(),
  observed_workflow_version: z.number().int().positive(),
  attempt_id: z.string(),
  context_manifest_id: z.string(),
  context_manifest_digest: z.string(),
  package_digest: z.string(),
  disposition: z.enum(['ADMITTED', 'IGNORED']),
  internal_command_id: z.string().nullable(),
  reason_code: z.string().nullable(),
  received_at: z.string(),
});

const candidateRowSchema = z.object({
  id: z.string(),
  goal_id: z.string(),
  base_project_identity: nonBlankStringSchema,
});

const candidateGenerationRowSchema = z.object({
  id: z.string(),
  candidate_id: z.string(),
  workflow_id: z.string(),
  sequence: z.number().int().positive(),
  parent_generation_id: z.string().nullable(),
  workspace_identity: nonBlankStringSchema,
  state: z.enum([
    CandidateGenerationState.MUTABLE,
    CandidateGenerationState.FREEZING,
    CandidateGenerationState.FROZEN,
    CandidateGenerationState.INVALIDATED,
    CandidateGenerationState.REJECTED,
    CandidateGenerationState.ACCEPTED,
  ]),
  base_digest: z.string(),
  frozen_digest: z.string().nullable(),
  invalidation_reason: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
  frozen_at: z.string().nullable(),
});

const checkSpecificationRowSchema = z.object({
  id: z.string(),
  version: nonBlankStringSchema,
  canonical_json: z.string(),
});

const verificationObligationRowSchema = z.object({
  id: z.string(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  candidate_generation_id: z.string(),
  source_criterion_refs_json: z.string(),
  scenario_refs_json: z.string(),
  check_spec_ref: nonBlankStringSchema,
  required_evidence_kind: nonBlankStringSchema,
  strength: nonBlankStringSchema,
  created_at: z.string(),
});

const evidenceRecordRowSchema = z.object({
  id: z.string(),
  schema_version: z.number().int().positive(),
  kind: nonBlankStringSchema,
  producer_type: nonBlankStringSchema,
  producer_identity: nonBlankStringSchema,
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  workflow_id: z.string(),
  attempt_id: z.string(),
  verification_obligation_id: z.string().nullable(),
  candidate_generation_id: z.string(),
  candidate_digest: z.string(),
  fact_snapshot_digest: z.string().nullable(),
  workspace_lease_id: z.string().nullable(),
  workspace_lease_digest: z.string().nullable(),
  policy_bundle_id: z.string(),
  policy_bundle_digest: z.string(),
  check_spec_json: z.string(),
  environment_identity_json: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string(),
  observation_json: z.string(),
  payload_refs_json: z.string(),
  observation_digest: z.string(),
  result_status: nonBlankStringSchema,
  recorded_at: z.string(),
  record_digest: z.string(),
  acceptance_critical_verification_plan_id: z.string().nullable().optional(),
  acceptance_critical_verification_plan_digest: z.string().nullable().optional(),
  protected_asset_manifest_digest: z.string().nullable().optional(),
  protected_asset_read_lease_digest: z.string().nullable().optional(),
});

const evidenceEligibilityRowSchema = z.object({
  evidence_id: z.string(),
  version: z.number().int().positive(),
  state: z.enum([EvidenceEligibilityState.ELIGIBLE, EvidenceEligibilityState.INELIGIBLE]),
  reason_code: z.string().nullable(),
  source_ref: z.string().nullable(),
  changed_at: z.string(),
});

const evidenceSetRowSchema = z.object({
  digest: z.string(),
  schema_version: z.number().int().positive(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  candidate_generation_id: z.string(),
  candidate_digest: z.string(),
  obligation_mappings_json: z.string(),
  evidence_refs_json: z.string(),
  unresolved_requirements_json: z.string(),
});

const pendingIssueRowSchema = z.object({
  id: z.string(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  candidate_generation_id: z.string().nullable(),
  classification: nonBlankStringSchema,
  severity: nonBlankStringSchema,
  description: nonBlankStringSchema,
  source_refs_json: z.string(),
  repairability: nonBlankStringSchema,
  status: nonBlankStringSchema,
  created_at: z.string(),
  resolved_at: z.string().nullable(),
});

const acceptanceInputManifestRowSchema = z.object({
  manifest_digest: z.string(),
  schema_version: z.number().int().positive(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  workflow_id: z.string(),
  workflow_version: z.number().int().positive(),
  phase: z.literal(WorkflowPhase.FINAL_VERIFY),
  fact_snapshot_digest: z.string(),
  decision_set_digest: z.string(),
  scenario_set_digest: z.string(),
  candidate_generation_id: z.string(),
  candidate_digest: z.string(),
  evidence_set_digest: z.string(),
  pending_issue_set_digest: z.string(),
  policy_bundle_id: z.string(),
  policy_bundle_digest: z.string(),
  created_at: z.string(),
  acceptance_critical_verification_plan_id: z.string().nullable().optional(),
  acceptance_critical_verification_plan_digest: z.string().nullable().optional(),
});

const acceptanceDecisionRowSchema = z.object({
  id: z.string(),
  schema_version: z.number().int().positive(),
  input_manifest_digest: z.string(),
  policy_bundle_digest: z.string(),
  outcome: nonBlankStringSchema,
  dominant_reason_code: nonBlankStringSchema,
  rule_results_json: z.string(),
  engine_version: nonBlankStringSchema,
  issued_at: z.string(),
  decision_digest: z.string(),
});

const closeoutRowSchema = z.object({
  workflow_id: z.string(),
  schema_version: z.number().int().positive(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  workflow_version: z.number().int().positive(),
  acceptance_decision_id: z.string(),
  acceptance_decision_digest: z.string(),
  input_manifest_digest: z.string(),
  candidate_generation_id: z.string(),
  candidate_digest: z.string(),
  evidence_set_digest: z.string(),
  policy_bundle_id: z.string(),
  policy_bundle_digest: z.string(),
  closed_at: z.string(),
});

const acceptanceRepairRowSchema = z.object({
  rejected_candidate_generation_id: z.string(),
  schema_version: z.number().int().positive(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  workflow_id: z.string(),
  workflow_version: z.number().int().positive(),
  acceptance_decision_id: z.string(),
  acceptance_decision_digest: z.string(),
  input_manifest_digest: z.string(),
  rejected_candidate_version: z.number().int().positive(),
  rejected_candidate_digest: z.string(),
  repair_candidate_generation_id: z.string(),
  repair_candidate_sequence: z.number().int().positive(),
  repair_candidate_base_digest: z.string(),
  freeze_check_id: z.string(),
  freeze_check_version: nonBlankStringSchema,
  verification_check_id: z.string(),
  verification_check_version: nonBlankStringSchema,
  verification_obligation_ids_json: z.string(),
  evidence_set_digest: z.string(),
  policy_bundle_id: z.string(),
  policy_bundle_digest: z.string(),
  repaired_at: z.string(),
  repair_digest: z.string(),
});

function parseStringArray(value: string, recordType: string): readonly string[] {
  const parsed = parseJson(value, recordType);
  const result = z.array(z.string()).safeParse(parsed);
  if (!result.success) {
    throw new PersistenceDecodeError(recordType, { cause: result.error });
  }
  return Object.freeze(result.data);
}

export function decodeGoal(row: unknown, criterionRows: readonly unknown[]): Goal {
  try {
    const parsed = goalRowSchema.parse(row);
    const criteria = criterionRows.map((criterionRow) => {
      const criterion = criterionRowSchema.parse(criterionRow);
      return Object.freeze({
        id: criterion.id,
        description: criterion.description,
        required: criterion.required === 1,
      });
    });
    if (criteria.length === 0) {
      throw new TypeError('Stored Goal has no success criteria');
    }

    return decodeGoalSnapshot({
      id: parsed.id,
      revision: parsed.revision,
      objective: parsed.objective,
      successCriteria: Object.freeze(criteria),
      scope: Object.freeze({
        projectPath: parsed.project_path,
        allowedPaths: parseStringArray(parsed.allowed_paths_json, 'Goal.allowedPaths'),
      }),
      nonGoals: parseStringArray(parsed.non_goals_json, 'Goal.nonGoals'),
      status: parsed.status,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('Goal', { cause: error });
  }
}

export function decodeWorkflow(row: unknown): WorkflowInstance {
  try {
    const parsed = workflowRowSchema.parse(row);
    return decodeWorkflowSnapshot({
      id: parsed.id,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      phase: parsed.phase,
      runStatus: parsed.run_status,
      version: parsed.version,
      ...(parsed.active_attempt_id === null ? {} : { activeAttemptId: parsed.active_attempt_id }),
      ...(parsed.active_candidate_generation_id === null
        ? {}
        : {
            activeCandidateGenerationId: parsed.active_candidate_generation_id,
          }),
      ...(parsed.suspended_reason === null ? {} : { suspendedReason: parsed.suspended_reason }),
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    });
  } catch (error) {
    throw new PersistenceDecodeError('WorkflowInstance', { cause: error });
  }
}

export function decodeAttempt(row: unknown): Attempt {
  try {
    const parsed = attemptRowSchema.parse(row);
    return decodeAttemptSnapshot({
      id: parsed.id,
      workflowId: parsed.workflow_id,
      phase: parsed.phase,
      sequence: parsed.sequence,
      ...(parsed.context_manifest_id === null
        ? {}
        : { contextManifestId: parsed.context_manifest_id }),
      capabilityGrant: parseJson(parsed.capability_grant_json, 'Attempt.capabilityGrant'),
      ...(parsed.worker_session_ref === null
        ? {}
        : { workerSessionRef: parsed.worker_session_ref }),
      status: parsed.status,
      ...(parsed.failure_class === null ? {} : { failureClass: parsed.failure_class }),
      ...(parsed.termination_reason === null
        ? {}
        : { terminationReason: parsed.termination_reason }),
      startedAt: parsed.started_at,
      ...(parsed.ended_at === null ? {} : { endedAt: parsed.ended_at }),
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('Attempt', { cause: error });
  }
}

export function decodeContextManifestRow(row: unknown): ContextManifest {
  try {
    const parsed = contextManifestRowSchema.parse(row);
    const logicalSchemaVersion =
      parsed.protected_logical_schema_version ??
      parsed.logical_schema_version ??
      parsed.schema_version;
    const hasRepairContext =
      parsed.repair_context_digest !== null &&
      parsed.repair_context_digest !== undefined &&
      parsed.prior_attempt_feedback_digest !== null &&
      parsed.prior_attempt_feedback_digest !== undefined;
    const hasPartialRepairContext =
      (parsed.repair_context_digest !== null && parsed.repair_context_digest !== undefined) !==
      (parsed.prior_attempt_feedback_digest !== null &&
        parsed.prior_attempt_feedback_digest !== undefined);
    if (
      hasPartialRepairContext ||
      (logicalSchemaVersion === 3 && !hasRepairContext) ||
      (logicalSchemaVersion === 2 && hasRepairContext)
    ) {
      throw new TypeError('Repair Context Manifest extension is incomplete');
    }
    if (
      (logicalSchemaVersion === 4) !==
      (parsed.verification_plan_id !== null &&
        parsed.verification_plan_id !== undefined &&
        parsed.verification_plan_digest !== null &&
        parsed.verification_plan_digest !== undefined)
    ) {
      throw new TypeError('Protected Context Manifest extension is incomplete');
    }
    return decodeContextManifest({
      id: parsed.id,
      schemaVersion: logicalSchemaVersion,
      compilerVersion: parsed.compiler_version,
      createdAt: parsed.created_at,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      workflowId: parsed.workflow_id,
      workflowVersion: parsed.workflow_version,
      phase: parsed.phase,
      attemptId: parsed.attempt_id,
      ...(parsed.candidate_generation_id === null
        ? {}
        : { candidateGenerationId: parsed.candidate_generation_id }),
      ...(parsed.candidate_digest === null ? {} : { candidateDigest: parsed.candidate_digest }),
      executionProfileId: parsed.execution_profile_id,
      executionProfileDigest: parsed.execution_profile_digest,
      policyBundleId: parsed.policy_bundle_id,
      policyBundleDigest: parsed.policy_bundle_digest,
      ...(logicalSchemaVersion !== 4
        ? {}
        : {
            acceptanceCriticalVerificationPlanId: parsed.verification_plan_id,
            acceptanceCriticalVerificationPlanDigest: parsed.verification_plan_digest,
          }),
      capabilityGrantDigest: parsed.capability_grant_digest,
      responseContractDigest: parsed.response_contract_digest,
      ...(parsed.repair_context_digest === null || parsed.repair_context_digest === undefined
        ? {}
        : {
            repairContextDigest: parsed.repair_context_digest,
            priorAttemptFeedbackDigest: parsed.prior_attempt_feedback_digest,
          }),
      entries: parseJson(parsed.entries_json, 'ContextManifest.entries'),
      omissionDecisions: parseJson(
        parsed.omission_decisions_json,
        'ContextManifest.omissionDecisions',
      ),
      packageDigest: parsed.package_digest,
      manifestDigest: parsed.manifest_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('ContextManifest', { cause: error });
  }
}

export function decodeAcceptanceCriticalVerificationPlanRow(
  row: unknown,
): AcceptanceCriticalVerificationPlan {
  try {
    const parsed = acceptanceCriticalVerificationPlanRowSchema.parse(row);
    const plan = decodeAcceptanceCriticalVerificationPlan(
      parseJson(parsed.canonical_json, 'AcceptanceCriticalVerificationPlan.canonical'),
    );
    if (
      plan.id !== parsed.id ||
      plan.goalId !== parsed.goal_id ||
      plan.goalRevision !== parsed.goal_revision ||
      plan.workflowId !== parsed.workflow_id ||
      plan.workflowVersionAtLock !== parsed.workflow_version_at_lock ||
      plan.policyBundleId !== parsed.policy_bundle_id ||
      plan.policyBundleDigest !== parsed.policy_bundle_digest ||
      plan.executionProfileId !== parsed.execution_profile_id ||
      plan.executionProfileDigest !== parsed.execution_profile_digest ||
      plan.protectedAssetManifestDigest !== parsed.protected_asset_manifest_digest ||
      plan.planDigest !== parsed.plan_digest
    ) {
      throw new TypeError('Protected Verification Plan columns disagree with canonical content');
    }
    return plan;
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('AcceptanceCriticalVerificationPlan', { cause: error });
  }
}

function samePolicyCheckers(left: PolicyBundle, right: readonly unknown[]): boolean {
  if (left.checkerVersions.length !== right.length) {
    return false;
  }
  return left.checkerVersions.every((checker, index) => {
    const candidate = right[index];
    return (
      typeof candidate === 'object' &&
      candidate !== null &&
      Reflect.get(candidate, 'checkerId') === checker.checkerId &&
      Reflect.get(candidate, 'checkerVersion') === checker.checkerVersion &&
      Reflect.get(candidate, 'checkerDigest') === checker.checkerDigest
    );
  });
}

export function decodePolicyBundleRow(row: unknown): InstalledPolicyBundle {
  try {
    const parsed = policyBundleRowSchema.parse(row);
    const canonicalContent = parseJson(
      parsed.canonical_content_json,
      'PolicyBundle.canonicalContent',
    );
    if (!isJsonObject(canonicalContent)) {
      throw new TypeError('Policy Bundle canonical content must be an object');
    }
    const bundle = decodePolicyBundle({
      ...canonicalContent,
      digest: parsed.bundle_digest,
    });
    const checkerIdentities = parseJson(
      parsed.checker_identities_json,
      'PolicyBundle.checkerIdentities',
    );
    if (
      !Array.isArray(checkerIdentities) ||
      bundle.id !== parsed.id ||
      bundle.schemaVersion !== parsed.schema_version ||
      bundle.version !== parsed.policy_version ||
      !samePolicyCheckers(bundle, checkerIdentities)
    ) {
      throw new TypeError('Policy Bundle storage columns disagree with canonical content');
    }
    return Object.freeze({ bundle, installedAt: isoTimestamp(parsed.installed_at) });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('PolicyBundle', { cause: error });
  }
}

export function decodeExecutionProfileRow(row: unknown): InstalledExecutionProfile {
  try {
    const parsed = executionProfileRowSchema.parse(row);
    const canonicalContent = parseJson(
      parsed.canonical_content_json,
      'ExecutionProfile.canonicalContent',
    );
    if (!isJsonObject(canonicalContent)) {
      throw new TypeError('Execution Profile canonical content must be an object');
    }
    const logicalSchemaVersion = parsed.logical_schema_version ?? parsed.schema_version;
    const hasExternalExtension =
      parsed.external_execution_json !== null && parsed.external_execution_json !== undefined;
    if (
      (logicalSchemaVersion === 2) !== hasExternalExtension ||
      (logicalSchemaVersion === 2) !==
        (parsed.capability_record_digest !== null && parsed.capability_record_digest !== undefined)
    ) {
      throw new TypeError('External Execution Profile extension is incomplete');
    }
    let externalExecution: ReturnType<typeof parseJson> | undefined;
    if (hasExternalExtension) {
      if (typeof parsed.external_execution_json !== 'string') {
        throw new TypeError('External Execution Profile content is missing');
      }
      externalExecution = parseJson(
        parsed.external_execution_json,
        'ExecutionProfile.externalExecution',
      );
    }
    const profile: ExecutionProfile = decodeExecutionProfile(
      logicalSchemaVersion === 1
        ? { ...canonicalContent, digest: parsed.profile_digest }
        : {
            ...canonicalContent,
            schemaVersion: 2,
            externalExecution,
            digest: parsed.profile_digest,
          },
    );
    if (
      profile.id !== parsed.id ||
      profile.schemaVersion !== logicalSchemaVersion ||
      profile.version !== parsed.profile_version ||
      (profile.schemaVersion === 2 &&
        profile.externalExecution.capabilityRecordDigest !== parsed.capability_record_digest)
    ) {
      throw new TypeError('Execution Profile storage columns disagree with canonical content');
    }
    return Object.freeze({ profile, installedAt: isoTimestamp(parsed.installed_at) });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('ExecutionProfile', { cause: error });
  }
}

export function decodeExternalBackendCapabilityRow(row: unknown): ExternalBackendCapabilityRecord {
  try {
    const parsed = externalBackendCapabilityRowSchema.parse(row);
    return decodeExternalBackendCapabilityRecord({
      schemaVersion: parsed.schema_version,
      backendKind: parsed.backend_kind,
      binaryIdentityDigest: parsed.binary_identity_digest,
      protocolSchemaDigest: parsed.protocol_schema_digest,
      configurationProfileDigest: parsed.configuration_profile_digest,
      capabilityEntries: parseJson(
        parsed.capability_entries_json,
        'ExternalBackendCapabilityRecord.capabilityEntries',
      ),
      observedAt: parsed.observed_at,
      recordDigest: parsed.record_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('ExternalBackendCapabilityRecord', { cause: error });
  }
}

export function decodeExternalExecutionRow(row: unknown): ExternalExecutionRecord {
  try {
    const parsed = externalExecutionRowSchema.parse(row);
    return decodeExternalExecutionRecord({
      schemaVersion: parsed.schema_version,
      id: parsed.id,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      workflowId: parsed.workflow_id,
      workflowVersionAtAuthorization: parsed.workflow_version_at_authorization,
      phase: parsed.phase,
      phaseVersion: parsed.phase_version,
      attemptId: parsed.attempt_id,
      workerSessionId: parsed.worker_session_id,
      dispatchClaimDigest: parsed.dispatch_claim_digest,
      contextManifestId: parsed.context_manifest_id,
      contextManifestDigest: parsed.context_manifest_digest,
      contextPackageDigest: parsed.context_package_digest,
      executionProfileId: parsed.execution_profile_id,
      executionProfileDigest: parsed.execution_profile_digest,
      policyBundleId: parsed.policy_bundle_id,
      policyBundleDigest: parsed.policy_bundle_digest,
      backendKind: parsed.backend_kind,
      binaryIdentityDigest: parsed.binary_identity_digest,
      binaryProtocolSchemaDigest: parsed.binary_protocol_schema_digest,
      executionConfigDigest: parsed.execution_config_digest,
      managedRequirementsDigest: parsed.managed_requirements_digest,
      instructionSourceManifestDigest: parsed.instruction_source_manifest_digest,
      controlledStateRootIdentity: parsed.controlled_state_root_identity,
      processLaunchNonce: parsed.process_launch_nonce,
      thread: parseJson(parsed.thread_json, 'ExternalExecution.thread'),
      continuityPolicy: parsed.continuity_policy,
      compactionPolicy: parsed.compaction_policy,
      retentionPolicy: parsed.retention_policy,
      fallbackPolicy: parsed.fallback_policy,
      interruptionPolicy: parsed.interruption_policy,
      ...(parsed.candidate_workspace_lease_id === null
        ? {}
        : { candidateWorkspaceLeaseId: parsed.candidate_workspace_lease_id }),
      ...(parsed.candidate_workspace_lease_digest === null
        ? {}
        : { candidateWorkspaceLeaseDigest: parsed.candidate_workspace_lease_digest }),
      ...(parsed.candidate_workspace_cwd_identity === null
        ? {}
        : { candidateWorkspaceCwdIdentity: parsed.candidate_workspace_cwd_identity }),
      authorizedAt: parsed.authorized_at,
      intentDigest: parsed.intent_digest,
      version: parsed.version,
      state: parsed.state,
      ...(parsed.process_identity_json === null
        ? {}
        : {
            processIdentity: parseJson(
              parsed.process_identity_json,
              'ExternalExecution.processIdentity',
            ),
          }),
      ...(parsed.backend_session_ref === null
        ? {}
        : { backendSessionRef: parsed.backend_session_ref }),
      ...(parsed.backend_operation_ref === null
        ? {}
        : { backendOperationRef: parsed.backend_operation_ref }),
      compactionCount: parsed.compaction_count,
      turnInterruptCount: parsed.turn_interrupt_count,
      ...(parsed.failure_code === null ? {} : { failureCode: parsed.failure_code }),
      ...(parsed.result_event_id === null ? {} : { resultEventId: parsed.result_event_id }),
      updatedAt: parsed.updated_at,
      ...(parsed.terminal_at === null ? {} : { terminalAt: parsed.terminal_at }),
      ...(parsed.last_observation_id === null
        ? {}
        : { lastObservationId: parsed.last_observation_id }),
      auditSequence: parsed.audit_sequence,
      recordDigest: parsed.record_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('ExternalExecutionRecord', { cause: error });
  }
}

export function decodeExternalExecutionObservationRow(row: unknown): ExternalExecutionObservation {
  try {
    const parsed = externalExecutionObservationRowSchema.parse(row);
    return decodeExternalExecutionObservation({
      schemaVersion: parsed.schema_version,
      id: parsed.id,
      externalExecutionId: parsed.external_execution_id,
      intentDigest: parsed.intent_digest,
      expectedRecordVersion: parsed.expected_record_version,
      state: parsed.state,
      ...(parsed.process_identity_json === null
        ? {}
        : {
            processIdentity: parseJson(
              parsed.process_identity_json,
              'ExternalExecutionObservation.processIdentity',
            ),
          }),
      ...(parsed.backend_session_ref === null
        ? {}
        : { backendSessionRef: parsed.backend_session_ref }),
      ...(parsed.backend_operation_ref === null
        ? {}
        : { backendOperationRef: parsed.backend_operation_ref }),
      compactionCount: parsed.compaction_count,
      turnInterruptCount: parsed.turn_interrupt_count,
      ...(parsed.failure_code === null ? {} : { failureCode: parsed.failure_code }),
      ...(parsed.result_event_id === null ? {} : { resultEventId: parsed.result_event_id }),
      observedAt: parsed.observed_at,
      observationDigest: parsed.observation_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('ExternalExecutionObservation', { cause: error });
  }
}

export function decodeExternalMaintenanceIntentRow(row: unknown): ExternalMaintenanceIntent {
  try {
    const parsed = externalMaintenanceIntentRowSchema.parse(row);
    return decodeExternalMaintenanceIntent({
      schemaVersion: parsed.schema_version,
      id: parsed.id,
      externalExecutionId: parsed.external_execution_id,
      sequence: parsed.sequence,
      kind: parsed.kind,
      state: parsed.state,
      authorizedAt: parsed.authorized_at,
      ...(parsed.observed_at === null ? {} : { observedAt: parsed.observed_at }),
      ...(parsed.failure_code === null ? {} : { failureCode: parsed.failure_code }),
      intentDigest: parsed.intent_digest,
      recordDigest: parsed.record_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('ExternalMaintenanceIntent', { cause: error });
  }
}

export function decodeExecutionProfileBindingRow(row: unknown): ExecutionProfileBinding {
  try {
    const parsed = executionProfileBindingRowSchema.parse(row);
    return decodeExecutionProfileBinding({
      schemaVersion: parsed.schema_version,
      goalId: parsed.goal_id,
      workflowId: parsed.workflow_id,
      profileId: parsed.profile_id,
      profileVersion: parsed.profile_version,
      profileDigest: parsed.profile_digest,
      startCommandId: parsed.start_command_id,
      boundAt: parsed.bound_at,
      bindingDigest: parsed.binding_digest,
    });
  } catch (error) {
    throw new PersistenceDecodeError('ExecutionProfileBinding', { cause: error });
  }
}

export function decodeWorkflowPolicyBindingRow(row: unknown): WorkflowPolicyBinding {
  try {
    const parsed = workflowPolicyBindingRowSchema.parse(row);
    return decodeWorkflowPolicyBinding({
      schemaVersion: parsed.schema_version,
      goalId: parsed.goal_id,
      workflowId: parsed.workflow_id,
      policyBundleId: parsed.policy_bundle_id,
      policyBundleVersion: parsed.policy_bundle_version,
      policyBundleDigest: parsed.policy_bundle_digest,
      startCommandId: parsed.start_command_id,
      boundAt: parsed.bound_at,
      bindingDigest: parsed.binding_digest,
    });
  } catch (error) {
    throw new PersistenceDecodeError('WorkflowPolicyBinding', { cause: error });
  }
}

export function decodeRecoveryReconciliationRow(row: unknown): RecoveryReconciliationRecord {
  try {
    const parsed = recoveryReconciliationRowSchema.parse(row);
    const observationRefs = parseJson(
      parsed.observation_refs_json,
      'RecoveryReconciliation.observationRefs',
    );
    return decodeRecoveryReconciliationRecord({
      id: parsed.id,
      schemaVersion: parsed.schema_version,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      workflowId: parsed.workflow_id,
      phase: parsed.phase,
      inspectedWorkflowVersion: parsed.inspected_workflow_version,
      resultingWorkflowVersion: parsed.resulting_workflow_version,
      ...(parsed.source_attempt_id === null ? {} : { sourceAttemptId: parsed.source_attempt_id }),
      ...(parsed.dispatch_claim_digest === null
        ? {}
        : { dispatchClaimDigest: parsed.dispatch_claim_digest }),
      lastAuditSequence: parsed.last_audit_sequence,
      expectedProjectIdentity: parsed.expected_project_identity,
      ...(parsed.observed_project_identity === null
        ? {}
        : { observedProjectIdentity: parsed.observed_project_identity }),
      ...(parsed.candidate_generation_id === null
        ? {}
        : { candidateGenerationId: parsed.candidate_generation_id }),
      ...(parsed.candidate_base_identity === null
        ? {}
        : { candidateBaseIdentity: parsed.candidate_base_identity }),
      ...(parsed.expected_candidate_digest === null
        ? {}
        : { expectedCandidateDigest: parsed.expected_candidate_digest }),
      ...(parsed.observed_candidate_digest === null
        ? {}
        : { observedCandidateDigest: parsed.observed_candidate_digest }),
      executionProfileId: parsed.execution_profile_id,
      executionProfileDigest: parsed.execution_profile_digest,
      purpose: parsed.purpose,
      disposition: parsed.disposition,
      ...(parsed.safe_resume_phase === null ? {} : { safeResumePhase: parsed.safe_resume_phase }),
      reasonCode: parsed.reason_code,
      observationRefs,
      inspectorVersion: parsed.inspector_version,
      recoveryPolicyVersion: parsed.recovery_policy_version,
      inspectedAt: parsed.inspected_at,
      reconciliationDigest: parsed.reconciliation_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('RecoveryReconciliation', { cause: error });
  }
}

export function decodeWorkerDispatchClaimRow(row: unknown): WorkerDispatchClaim {
  try {
    const parsed = workerDispatchClaimRowSchema.parse(row);
    return decodeWorkerDispatchClaim({
      schemaVersion: parsed.schema_version,
      workflowId: parsed.workflow_id,
      workflowVersion: parsed.workflow_version,
      attemptId: parsed.attempt_id,
      workerSessionId: parsed.worker_session_id,
      contextManifestId: parsed.context_manifest_id,
      contextManifestDigest: parsed.context_manifest_digest,
      packageDigest: parsed.package_digest,
      executionProfileId: parsed.execution_profile_id,
      executionProfileDigest: parsed.execution_profile_digest,
      claimedAt: parsed.claimed_at,
    });
  } catch (error) {
    throw new PersistenceDecodeError('WorkerDispatchClaim', { cause: error });
  }
}

export function decodeWorkerEventReceiptRow(row: unknown): WorkerEventReceipt {
  try {
    const parsed = workerEventReceiptRowSchema.parse(row);
    return decodeWorkerEventReceipt({
      schemaVersion: parsed.schema_version,
      eventId: parsed.event_id,
      payloadDigest: parsed.payload_digest,
      workerSessionId: parsed.worker_session_id,
      workflowId: parsed.workflow_id,
      observedWorkflowVersion: parsed.observed_workflow_version,
      attemptId: parsed.attempt_id,
      contextManifestId: parsed.context_manifest_id,
      contextManifestDigest: parsed.context_manifest_digest,
      packageDigest: parsed.package_digest,
      receivedAt: parsed.received_at,
      disposition: parsed.disposition,
      ...(parsed.internal_command_id === null
        ? {}
        : { internalCommandId: parsed.internal_command_id }),
      ...(parsed.reason_code === null ? {} : { reasonCode: parsed.reason_code }),
    });
  } catch (error) {
    throw new PersistenceDecodeError('WorkerEventReceipt', { cause: error });
  }
}

export function decodeCandidateRow(row: unknown): Candidate {
  try {
    const parsed = candidateRowSchema.parse(row);
    return decodeCandidate({
      id: parsed.id,
      goalId: parsed.goal_id,
      baseProjectIdentity: parsed.base_project_identity,
    });
  } catch (error) {
    throw new PersistenceDecodeError('Candidate', { cause: error });
  }
}

export interface CandidateGenerationRowResult {
  readonly generation: CandidateGeneration;
  readonly workflowId: WorkflowId;
}

export function decodeCandidateGenerationRow(row: unknown): CandidateGenerationRowResult {
  try {
    const parsed = candidateGenerationRowSchema.parse(row);
    return Object.freeze({
      generation: decodeCandidateGeneration({
        id: parsed.id,
        candidateId: parsed.candidate_id,
        sequence: parsed.sequence,
        ...(parsed.parent_generation_id === null
          ? {}
          : { parentGenerationId: parsed.parent_generation_id }),
        workspaceIdentity: parsed.workspace_identity,
        state: parsed.state,
        baseDigest: parsed.base_digest,
        ...(parsed.frozen_digest === null ? {} : { frozenDigest: parsed.frozen_digest }),
        ...(parsed.invalidation_reason === null
          ? {}
          : { invalidationReason: parsed.invalidation_reason }),
        version: parsed.version,
        createdAt: parsed.created_at,
        updatedAt: parsed.updated_at,
        ...(parsed.frozen_at === null ? {} : { frozenAt: parsed.frozen_at }),
      }),
      workflowId: workflowId(parsed.workflow_id),
    });
  } catch (error) {
    throw new PersistenceDecodeError('CandidateGeneration', { cause: error });
  }
}

export function decodeCheckSpecificationRow(row: unknown): CheckSpecification {
  try {
    const parsed = checkSpecificationRowSchema.parse(row);
    const specification = decodeCheckSpecification(
      parseJson(parsed.canonical_json, 'CheckSpecification.canonical'),
    );
    if (specification.id !== parsed.id || specification.version !== parsed.version) {
      throw new TypeError('Check Specification columns disagree with canonical content');
    }
    return specification;
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('CheckSpecification', { cause: error });
  }
}

export function decodeVerificationObligationRow(row: unknown): VerificationObligation {
  try {
    const parsed = verificationObligationRowSchema.parse(row);
    return decodeVerificationObligation({
      id: parsed.id,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      candidateGenerationId: parsed.candidate_generation_id,
      sourceCriterionRefs: parseJson(
        parsed.source_criterion_refs_json,
        'VerificationObligation.sourceCriterionRefs',
      ),
      scenarioRefs: parseJson(parsed.scenario_refs_json, 'VerificationObligation.scenarioRefs'),
      checkSpecRef: parsed.check_spec_ref,
      requiredEvidenceKind: parsed.required_evidence_kind,
      strength: parsed.strength,
      createdAt: parsed.created_at,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('VerificationObligation', { cause: error });
  }
}

export function decodeEvidenceRecordRow(row: unknown): EvidenceRecord {
  try {
    const parsed = evidenceRecordRowSchema.parse(row);
    return decodeEvidenceRecord({
      id: parsed.id,
      schemaVersion: parsed.schema_version,
      kind: parsed.kind,
      producerType: parsed.producer_type,
      producerIdentity: parsed.producer_identity,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      workflowId: parsed.workflow_id,
      attemptId: parsed.attempt_id,
      ...(parsed.verification_obligation_id === null
        ? {}
        : { verificationObligationId: parsed.verification_obligation_id }),
      candidateGenerationId: parsed.candidate_generation_id,
      candidateDigest: parsed.candidate_digest,
      ...(parsed.fact_snapshot_digest === null
        ? {}
        : { factSnapshotDigest: parsed.fact_snapshot_digest }),
      ...(parsed.workspace_lease_id === null
        ? {}
        : { workspaceLeaseId: parsed.workspace_lease_id }),
      ...(parsed.workspace_lease_digest === null
        ? {}
        : { workspaceLeaseDigest: parsed.workspace_lease_digest }),
      ...(parsed.acceptance_critical_verification_plan_id === null ||
      parsed.acceptance_critical_verification_plan_id === undefined
        ? {}
        : {
            acceptanceCriticalVerificationPlanId: parsed.acceptance_critical_verification_plan_id,
          }),
      ...(parsed.acceptance_critical_verification_plan_digest === null ||
      parsed.acceptance_critical_verification_plan_digest === undefined
        ? {}
        : {
            acceptanceCriticalVerificationPlanDigest:
              parsed.acceptance_critical_verification_plan_digest,
          }),
      ...(parsed.protected_asset_manifest_digest === null ||
      parsed.protected_asset_manifest_digest === undefined
        ? {}
        : { protectedAssetManifestDigest: parsed.protected_asset_manifest_digest }),
      ...(parsed.protected_asset_read_lease_digest === null ||
      parsed.protected_asset_read_lease_digest === undefined
        ? {}
        : { protectedAssetReadLeaseDigest: parsed.protected_asset_read_lease_digest }),
      policyBundleId: parsed.policy_bundle_id,
      policyBundleDigest: parsed.policy_bundle_digest,
      checkSpec: parseJson(parsed.check_spec_json, 'EvidenceRecord.checkSpec'),
      ...(parsed.environment_identity_json === null
        ? {}
        : {
            environmentIdentity: parseJson(
              parsed.environment_identity_json,
              'EvidenceRecord.environmentIdentity',
            ),
          }),
      startedAt: parsed.started_at,
      endedAt: parsed.ended_at,
      observation: parseJson(parsed.observation_json, 'EvidenceRecord.observation'),
      payloadRefs: parseJson(parsed.payload_refs_json, 'EvidenceRecord.payloadRefs'),
      observationDigest: parsed.observation_digest,
      resultStatus: parsed.result_status,
      recordedAt: parsed.recorded_at,
      recordDigest: parsed.record_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('EvidenceRecord', { cause: error });
  }
}

export function decodeEvidenceEligibilityRow(row: unknown): EvidenceEligibility {
  try {
    const parsed = evidenceEligibilityRowSchema.parse(row);
    return decodeEvidenceEligibility({
      evidenceId: parsed.evidence_id,
      version: parsed.version,
      state: parsed.state,
      ...(parsed.reason_code === null ? {} : { reasonCode: parsed.reason_code }),
      ...(parsed.source_ref === null ? {} : { sourceRef: parsed.source_ref }),
      changedAt: parsed.changed_at,
    });
  } catch (error) {
    throw new PersistenceDecodeError('EvidenceEligibility', { cause: error });
  }
}

export function decodeEvidenceSetRow(row: unknown): EvidenceSet {
  try {
    const parsed = evidenceSetRowSchema.parse(row);
    return decodeEvidenceSet({
      schemaVersion: parsed.schema_version,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      candidateGenerationId: parsed.candidate_generation_id,
      candidateDigest: parsed.candidate_digest,
      obligationMappings: parseJson(
        parsed.obligation_mappings_json,
        'EvidenceSet.obligationMappings',
      ),
      evidenceRefs: parseJson(parsed.evidence_refs_json, 'EvidenceSet.evidenceRefs'),
      unresolvedEvidenceRequirements: parseJson(
        parsed.unresolved_requirements_json,
        'EvidenceSet.unresolvedRequirements',
      ),
      digest: parsed.digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('EvidenceSet', { cause: error });
  }
}

export function decodePendingIssueRow(row: unknown): PendingIssue {
  try {
    const parsed = pendingIssueRowSchema.parse(row);
    return decodePendingIssue({
      id: parsed.id,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      ...(parsed.candidate_generation_id === null
        ? {}
        : { candidateGenerationId: parsed.candidate_generation_id }),
      classification: parsed.classification,
      severity: parsed.severity,
      description: parsed.description,
      sourceRefs: parseJson(parsed.source_refs_json, 'PendingIssue.sourceRefs'),
      repairability: parsed.repairability,
      status: parsed.status,
      createdAt: parsed.created_at,
      ...(parsed.resolved_at === null ? {} : { resolvedAt: parsed.resolved_at }),
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('PendingIssue', { cause: error });
  }
}

export function decodeAcceptanceInputManifestRow(row: unknown): AcceptanceInputManifest {
  try {
    const parsed = acceptanceInputManifestRowSchema.parse(row);
    const hasPlanId =
      parsed.acceptance_critical_verification_plan_id !== null &&
      parsed.acceptance_critical_verification_plan_id !== undefined;
    const hasPlanDigest =
      parsed.acceptance_critical_verification_plan_digest !== null &&
      parsed.acceptance_critical_verification_plan_digest !== undefined;
    if (parsed.schema_version !== 1 || hasPlanId !== hasPlanDigest) {
      throw new TypeError('Acceptance Input Manifest storage extension is incomplete');
    }
    return decodeAcceptanceInputManifest({
      schemaVersion: hasPlanId ? 2 : 1,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      workflowId: parsed.workflow_id,
      workflowVersion: parsed.workflow_version,
      phase: parsed.phase,
      factSnapshotDigest: parsed.fact_snapshot_digest,
      decisionSetDigest: parsed.decision_set_digest,
      scenarioSetDigest: parsed.scenario_set_digest,
      candidateGenerationId: parsed.candidate_generation_id,
      candidateDigest: parsed.candidate_digest,
      evidenceSetDigest: parsed.evidence_set_digest,
      pendingIssueSetDigest: parsed.pending_issue_set_digest,
      policyBundleId: parsed.policy_bundle_id,
      policyBundleDigest: parsed.policy_bundle_digest,
      createdAt: parsed.created_at,
      manifestDigest: parsed.manifest_digest,
      ...(parsed.acceptance_critical_verification_plan_id === null ||
      parsed.acceptance_critical_verification_plan_id === undefined
        ? {}
        : {
            acceptanceCriticalVerificationPlanId: parsed.acceptance_critical_verification_plan_id,
          }),
      ...(parsed.acceptance_critical_verification_plan_digest === null ||
      parsed.acceptance_critical_verification_plan_digest === undefined
        ? {}
        : {
            acceptanceCriticalVerificationPlanDigest:
              parsed.acceptance_critical_verification_plan_digest,
          }),
    });
  } catch (error) {
    throw new PersistenceDecodeError('AcceptanceInputManifest', { cause: error });
  }
}

export function decodeAcceptanceDecisionRow(row: unknown): AcceptanceDecision {
  try {
    const parsed = acceptanceDecisionRowSchema.parse(row);
    return decodeAcceptanceDecision({
      id: parsed.id,
      schemaVersion: parsed.schema_version,
      inputManifestDigest: parsed.input_manifest_digest,
      policyBundleDigest: parsed.policy_bundle_digest,
      outcome: parsed.outcome,
      dominantReasonCode: parsed.dominant_reason_code,
      ruleResults: parseJson(parsed.rule_results_json, 'AcceptanceDecision.ruleResults'),
      engineVersion: parsed.engine_version,
      issuedAt: parsed.issued_at,
      decisionDigest: parsed.decision_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('AcceptanceDecision', { cause: error });
  }
}

export function decodeCloseoutRow(row: unknown): CloseoutRecord {
  try {
    const parsed = closeoutRowSchema.parse(row);
    return decodeCloseoutRecord({
      schemaVersion: parsed.schema_version,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      workflowId: parsed.workflow_id,
      workflowVersion: parsed.workflow_version,
      acceptanceDecisionId: parsed.acceptance_decision_id,
      acceptanceDecisionDigest: parsed.acceptance_decision_digest,
      inputManifestDigest: parsed.input_manifest_digest,
      candidateGenerationId: parsed.candidate_generation_id,
      candidateDigest: parsed.candidate_digest,
      evidenceSetDigest: parsed.evidence_set_digest,
      policyBundleId: parsed.policy_bundle_id,
      policyBundleDigest: parsed.policy_bundle_digest,
      closedAt: parsed.closed_at,
    });
  } catch (error) {
    throw new PersistenceDecodeError('CloseoutRecord', { cause: error });
  }
}

export function decodeAcceptanceRepairRow(row: unknown): AcceptanceRepairRecord {
  try {
    const parsed = acceptanceRepairRowSchema.parse(row);
    return decodeAcceptanceRepairRecord({
      schemaVersion: parsed.schema_version,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      workflowId: parsed.workflow_id,
      workflowVersion: parsed.workflow_version,
      acceptanceDecisionId: parsed.acceptance_decision_id,
      acceptanceDecisionDigest: parsed.acceptance_decision_digest,
      inputManifestDigest: parsed.input_manifest_digest,
      rejectedCandidateGenerationId: parsed.rejected_candidate_generation_id,
      rejectedCandidateVersion: parsed.rejected_candidate_version,
      rejectedCandidateDigest: parsed.rejected_candidate_digest,
      repairCandidateGenerationId: parsed.repair_candidate_generation_id,
      repairCandidateSequence: parsed.repair_candidate_sequence,
      repairCandidateBaseDigest: parsed.repair_candidate_base_digest,
      freezeCheckId: parsed.freeze_check_id,
      freezeCheckVersion: parsed.freeze_check_version,
      verificationCheckId: parsed.verification_check_id,
      verificationCheckVersion: parsed.verification_check_version,
      verificationObligationIds: parseStringArray(
        parsed.verification_obligation_ids_json,
        'AcceptanceRepairRecord.verificationObligationIds',
      ),
      evidenceSetDigest: parsed.evidence_set_digest,
      policyBundleId: parsed.policy_bundle_id,
      policyBundleDigest: parsed.policy_bundle_digest,
      repairedAt: parsed.repaired_at,
      repairDigest: parsed.repair_digest,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('AcceptanceRepairRecord', { cause: error });
  }
}

interface ProcessedCommandRecordBase {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly outcome: JsonValue;
  readonly completedAt: IsoTimestamp;
}

export type ProcessedCommandRecord = ProcessedCommandRecordBase &
  (
    | { readonly aggregateType: 'GOAL'; readonly aggregateId: GoalId }
    | { readonly aggregateType: 'WORKFLOW'; readonly aggregateId: WorkflowId }
  );

export function decodeProcessedCommand(row: unknown): ProcessedCommandRecord {
  try {
    const parsed = processedCommandRowSchema.parse(row);
    const common = {
      commandId: commandId(parsed.command_id),
      inputDigest: sha256Digest(parsed.input_digest),
      outcome: parseJson(parsed.outcome_json, 'ProcessedCommand.outcome'),
      completedAt: isoTimestamp(parsed.completed_at),
    };
    return parsed.aggregate_type === 'GOAL'
      ? Object.freeze({
          ...common,
          aggregateType: parsed.aggregate_type,
          aggregateId: goalId(parsed.aggregate_id),
        })
      : Object.freeze({
          ...common,
          aggregateType: parsed.aggregate_type,
          aggregateId: workflowId(parsed.aggregate_id),
        });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('ProcessedCommand', { cause: error });
  }
}

export interface AuditEventRecord {
  readonly id: AuditEventId;
  readonly sequence: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly commandId?: CommandId;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly payloadDigest: Sha256Digest;
  readonly occurredAt: IsoTimestamp;
}

export function decodeAuditEvent(row: unknown): AuditEventRecord {
  try {
    const parsed = auditEventRowSchema.parse(row);
    return Object.freeze({
      id: auditEventId(parsed.id),
      sequence: parsed.sequence,
      aggregateType: parsed.aggregate_type,
      aggregateId: parsed.aggregate_id,
      eventType: parsed.event_type,
      actorType: parsed.actor_type,
      ...(parsed.command_id === null ? {} : { commandId: commandId(parsed.command_id) }),
      ...(parsed.before_version === null ? {} : { beforeVersion: parsed.before_version }),
      ...(parsed.after_version === null ? {} : { afterVersion: parsed.after_version }),
      ...(parsed.correlation_id === null ? {} : { correlationId: parsed.correlation_id }),
      ...(parsed.causation_id === null ? {} : { causationId: parsed.causation_id }),
      payloadDigest: sha256Digest(parsed.payload_digest),
      occurredAt: isoTimestamp(parsed.occurred_at),
    });
  } catch (error) {
    throw new PersistenceDecodeError('AuditEvent', { cause: error });
  }
}
