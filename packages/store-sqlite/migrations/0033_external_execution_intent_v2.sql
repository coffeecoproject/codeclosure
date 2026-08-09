-- M2.5.1 adds an external-execution Intent/Record v2 whose single nested
-- source-authority member binds either the exact project-read snapshot or the
-- exact Candidate lease. Historical v1 rows retain their flat Candidate-only
-- representation and digest meaning.

DROP TRIGGER external_execution_records_insert_guard;
DROP TRIGGER external_execution_records_update_guard;
DROP TRIGGER external_execution_records_no_delete;
DROP TRIGGER external_execution_observations_insert_guard;
DROP TRIGGER external_maintenance_intents_insert_guard;
DROP INDEX external_execution_records_workflow_idx;

CREATE TABLE external_execution_records_v2 (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
  version INTEGER NOT NULL CHECK (version >= 1 AND version <= 9007199254740991),
  state TEXT NOT NULL CHECK (state IN (
    'AUTHORIZED', 'PROCESS_OBSERVED', 'SESSION_OBSERVED', 'OPERATION_RUNNING',
    'COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED'
  )),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version_at_authorization INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('DISCOVERY', 'PLAN', 'IMPLEMENT')),
  phase_version INTEGER NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE RESTRICT,
  worker_session_id TEXT NOT NULL,
  dispatch_claim_digest TEXT NOT NULL,
  context_manifest_id TEXT NOT NULL UNIQUE REFERENCES context_manifests(id) ON DELETE RESTRICT,
  context_manifest_digest TEXT NOT NULL,
  context_package_digest TEXT NOT NULL,
  execution_profile_id TEXT NOT NULL REFERENCES execution_profiles(id) ON DELETE RESTRICT,
  execution_profile_digest TEXT NOT NULL,
  policy_bundle_id TEXT NOT NULL REFERENCES policy_bundles(id) ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  backend_kind TEXT NOT NULL CHECK (length(trim(backend_kind)) > 0),
  binary_identity_digest TEXT NOT NULL,
  binary_protocol_schema_digest TEXT NOT NULL,
  execution_config_digest TEXT NOT NULL,
  managed_requirements_digest TEXT NOT NULL,
  instruction_source_manifest_digest TEXT NOT NULL,
  controlled_state_root_identity TEXT NOT NULL CHECK (
    length(trim(controlled_state_root_identity)) > 0
  ),
  process_launch_nonce TEXT NOT NULL UNIQUE,
  thread_json TEXT NOT NULL CHECK (json_valid(thread_json) AND json_type(thread_json) = 'object'),
  continuity_policy TEXT NOT NULL CHECK (continuity_policy = 'SAME_SESSION_BOUNDED_OPERATION'),
  compaction_policy TEXT NOT NULL CHECK (
    compaction_policy IN ('FAIL_ON_OBSERVATION', 'MANUAL_BEFORE_OPERATION')
  ),
  retention_policy TEXT NOT NULL CHECK (retention_policy = 'CONTROLLED'),
  fallback_policy TEXT NOT NULL CHECK (fallback_policy = 'FAIL_CLOSED'),
  interruption_policy TEXT NOT NULL CHECK (interruption_policy = 'INTERRUPT_OPERATION'),
  candidate_workspace_lease_id TEXT,
  candidate_workspace_lease_digest TEXT,
  candidate_workspace_cwd_identity TEXT,
  phase_dispatch_entry_digest TEXT,
  source_authority_json TEXT CHECK (
    source_authority_json IS NULL OR
    (json_valid(source_authority_json) AND json_type(source_authority_json) = 'object')
  ),
  authorized_at TEXT NOT NULL,
  intent_digest TEXT NOT NULL UNIQUE,
  process_identity_json TEXT CHECK (
    process_identity_json IS NULL OR
    (json_valid(process_identity_json) AND json_type(process_identity_json) = 'object')
  ),
  backend_session_ref TEXT,
  backend_operation_ref TEXT,
  compaction_count INTEGER NOT NULL CHECK (
    compaction_count >= 0 AND compaction_count <= 9007199254740991
  ),
  turn_interrupt_count INTEGER NOT NULL CHECK (
    turn_interrupt_count >= 0 AND turn_interrupt_count <= 9007199254740991
  ),
  failure_code TEXT,
  result_event_id TEXT,
  updated_at TEXT NOT NULL,
  terminal_at TEXT,
  last_observation_id TEXT,
  audit_sequence INTEGER NOT NULL REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  record_digest TEXT NOT NULL UNIQUE,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (execution_profile_id, execution_profile_digest)
    REFERENCES execution_profiles(id, profile_digest) ON DELETE RESTRICT,
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT,
  CHECK (phase_version = workflow_version_at_authorization),
  CHECK (
    (
      schema_version = 1 AND phase_dispatch_entry_digest IS NULL AND
      source_authority_json IS NULL AND (
        (candidate_workspace_lease_id IS NULL AND candidate_workspace_lease_digest IS NULL AND
          candidate_workspace_cwd_identity IS NULL AND phase <> 'IMPLEMENT') OR
        (candidate_workspace_lease_id IS NOT NULL AND candidate_workspace_lease_digest IS NOT NULL AND
          candidate_workspace_cwd_identity IS NOT NULL AND phase = 'IMPLEMENT')
      )
    ) OR (
      schema_version = 2 AND phase_dispatch_entry_digest IS NOT NULL AND
      source_authority_json IS NOT NULL AND
      candidate_workspace_lease_id IS NULL AND candidate_workspace_lease_digest IS NULL AND
      candidate_workspace_cwd_identity IS NULL AND json_type(source_authority_json) = 'object' AND (
        (
          phase IN ('DISCOVERY', 'PLAN') AND
          json_extract(source_authority_json, '$.kind') = 'PROJECT_READ' AND
          json_type(source_authority_json, '$.projectReadAuthorityId') = 'text' AND
          json_type(source_authority_json, '$.projectReadAuthorityRecordDigest') = 'text' AND
          json_type(source_authority_json, '$.snapshotCwdIdentity') = 'text'
        ) OR (
          phase = 'IMPLEMENT' AND
          json_extract(source_authority_json, '$.kind') = 'CANDIDATE' AND
          json_type(source_authority_json, '$.candidateWorkspaceLeaseId') = 'text' AND
          json_type(source_authority_json, '$.candidateWorkspaceLeaseDigest') = 'text' AND
          json_type(source_authority_json, '$.candidateWorkspaceCwdIdentity') = 'text'
        )
      )
    )
  ),
  CHECK (
    (state IN ('COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED') AND terminal_at IS NOT NULL) OR
    (state NOT IN ('COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED') AND terminal_at IS NULL)
  ),
  CHECK (
    (state = 'AUTHORIZED' AND process_identity_json IS NULL) OR
    (state IN ('PROCESS_OBSERVED', 'SESSION_OBSERVED', 'OPERATION_RUNNING') AND
      process_identity_json IS NOT NULL) OR
    state IN ('COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED')
  ),
  CHECK (
    (state = 'COMPLETED' AND failure_code IS NULL) OR
    (state IN ('INTERRUPTED', 'FAILED') AND failure_code IN (
      'ADAPTER_REUSED', 'BACKEND_TURN_FAILED', 'CLEAN_SHUTDOWN_FAILED',
      'CLIENT_FAILURE', 'COMPACTION_POLICY_VIOLATION', 'DECLINED_APPROVAL_REQUEST',
      'EFFECTIVE_INPUT_MISMATCH', 'HOST_CANCELLED', 'INVALID_DIRECTIVE',
      'INVALID_REQUEST_BINDING', 'INVALID_TERMINAL_PAYLOAD',
      'INVALID_WORKSPACE_LEASE', 'NO_TERMINAL_PAYLOAD',
      'THREAD_BINDING_MISMATCH', 'TURN_BINDING_MISMATCH',
      'UNSUPPORTED_BACKEND_ACTIVITY', 'UNSUPPORTED_PHASE'
    )) OR
    (state = 'ABANDONED' AND failure_code IN (
      'EXTERNAL_MAINTENANCE_AUTHORIZATION_FAILED',
      'CANCELLED_BEFORE_EXTERNAL_INVOCATION', 'EXTERNAL_WORKER_CREATION_FAILED',
      'INVALID_EXTERNAL_WORKER_OBSERVATION', 'EXTERNAL_OBSERVATION_ADMISSION_FAILED',
      'RECOVERY_ABANDONED_ACTIVE_DISPATCH'
    )) OR
    (state NOT IN ('COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED') AND
      failure_code IS NULL)
  ),
  CHECK (
    (state = 'COMPLETED' AND result_event_id IS NOT NULL) OR
    (state = 'FAILED' AND (
      (failure_code = 'BACKEND_TURN_FAILED' AND result_event_id IS NOT NULL) OR
      (failure_code <> 'BACKEND_TURN_FAILED' AND result_event_id IS NULL)
    )) OR
    (state NOT IN ('COMPLETED', 'FAILED') AND result_event_id IS NULL)
  )
) STRICT;

INSERT INTO external_execution_records_v2(
  id, schema_version, version, state, goal_id, goal_revision, workflow_id,
  workflow_version_at_authorization, phase, phase_version, attempt_id,
  worker_session_id, dispatch_claim_digest, context_manifest_id,
  context_manifest_digest, context_package_digest, execution_profile_id,
  execution_profile_digest, policy_bundle_id, policy_bundle_digest, backend_kind,
  binary_identity_digest, binary_protocol_schema_digest, execution_config_digest,
  managed_requirements_digest, instruction_source_manifest_digest,
  controlled_state_root_identity, process_launch_nonce, thread_json,
  continuity_policy, compaction_policy, retention_policy, fallback_policy,
  interruption_policy, candidate_workspace_lease_id, candidate_workspace_lease_digest,
  candidate_workspace_cwd_identity, phase_dispatch_entry_digest, source_authority_json,
  authorized_at, intent_digest, process_identity_json, backend_session_ref,
  backend_operation_ref, compaction_count, turn_interrupt_count, failure_code,
  result_event_id, updated_at, terminal_at, last_observation_id, audit_sequence, record_digest
)
SELECT
  id, schema_version, version, state, goal_id, goal_revision, workflow_id,
  workflow_version_at_authorization, phase, phase_version, attempt_id,
  worker_session_id, dispatch_claim_digest, context_manifest_id,
  context_manifest_digest, context_package_digest, execution_profile_id,
  execution_profile_digest, policy_bundle_id, policy_bundle_digest, backend_kind,
  binary_identity_digest, binary_protocol_schema_digest, execution_config_digest,
  managed_requirements_digest, instruction_source_manifest_digest,
  controlled_state_root_identity, process_launch_nonce, thread_json,
  continuity_policy, compaction_policy, retention_policy, fallback_policy,
  interruption_policy, candidate_workspace_lease_id, candidate_workspace_lease_digest,
  candidate_workspace_cwd_identity, NULL, NULL, authorized_at, intent_digest,
  process_identity_json, backend_session_ref, backend_operation_ref, compaction_count,
  turn_interrupt_count, failure_code, result_event_id, updated_at, terminal_at,
  last_observation_id, audit_sequence, record_digest
FROM external_execution_records;

DROP TABLE external_execution_records;
ALTER TABLE external_execution_records_v2 RENAME TO external_execution_records;

CREATE INDEX external_execution_records_workflow_idx
  ON external_execution_records(workflow_id, authorized_at, id);

CREATE TRIGGER external_execution_observations_insert_guard
BEFORE INSERT ON external_execution_observations
WHEN NOT (
  EXISTS (
    SELECT 1 FROM external_execution_records AS execution
     WHERE execution.id = NEW.external_execution_id
       AND execution.intent_digest = NEW.intent_digest
       AND execution.version = NEW.expected_record_version
       AND execution.state NOT IN ('COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED')
       AND NEW.observed_at >= execution.updated_at
       AND NEW.compaction_count >= execution.compaction_count
       AND NEW.turn_interrupt_count >= execution.turn_interrupt_count
       AND (
         (NEW.state = 'PROCESS_OBSERVED' AND execution.process_identity_json IS NULL AND
           json_extract(NEW.process_identity_json, '$.launchNonce') =
             execution.process_launch_nonce AND
           json_extract(NEW.process_identity_json, '$.executableIdentityDigest') =
             execution.binary_identity_digest AND
           json_extract(NEW.process_identity_json, '$.controlledStateRootIdentity') =
             execution.controlled_state_root_identity) OR
         (NEW.state <> 'PROCESS_OBSERVED' AND NEW.process_identity_json IS NULL)
       )
       AND (
         (execution.state = 'AUTHORIZED' AND
           NEW.state IN ('PROCESS_OBSERVED', 'FAILED', 'INTERRUPTED')) OR
         (execution.state = 'PROCESS_OBSERVED' AND
           NEW.state IN ('SESSION_OBSERVED', 'FAILED', 'INTERRUPTED')) OR
         (execution.state = 'SESSION_OBSERVED' AND
           NEW.state IN ('OPERATION_RUNNING', 'FAILED', 'INTERRUPTED')) OR
         (execution.state = 'OPERATION_RUNNING' AND
           NEW.state IN ('COMPLETED', 'FAILED', 'INTERRUPTED'))
       )
       AND (execution.backend_session_ref IS NULL OR NEW.backend_session_ref IS NULL OR
         execution.backend_session_ref = NEW.backend_session_ref)
       AND (execution.backend_operation_ref IS NULL OR NEW.backend_operation_ref IS NULL OR
         execution.backend_operation_ref = NEW.backend_operation_ref)
       AND (NEW.state <> 'SESSION_OBSERVED' OR NEW.backend_session_ref IS NOT NULL)
       AND (NEW.state <> 'OPERATION_RUNNING' OR
         (NEW.backend_session_ref IS NOT NULL AND NEW.backend_operation_ref IS NOT NULL))
       AND (
         (NEW.state = 'COMPLETED' AND NEW.result_event_id IS NOT NULL) OR
         (NEW.state = 'FAILED' AND (
           (NEW.failure_code = 'BACKEND_TURN_FAILED' AND NEW.result_event_id IS NOT NULL) OR
           (NEW.failure_code <> 'BACKEND_TURN_FAILED' AND NEW.result_event_id IS NULL)
         )) OR
         (NEW.state = 'INTERRUPTED' AND NEW.result_event_id IS NULL) OR
         (NEW.state NOT IN ('COMPLETED', 'FAILED', 'INTERRUPTED') AND
           NEW.result_event_id IS NULL)
       )
       AND (
         (execution.compaction_policy = 'FAIL_ON_OBSERVATION' AND NEW.compaction_count = 0) OR
         (execution.compaction_policy = 'MANUAL_BEFORE_OPERATION' AND
           NEW.compaction_count IN (0, 1) AND
           (NEW.compaction_count = 0 OR EXISTS (
             SELECT 1 FROM external_maintenance_intents AS maintenance
              WHERE maintenance.external_execution_id = execution.id
                AND maintenance.sequence = 1
                AND maintenance.state = 'OBSERVED'
           )))
       )
  ) AND EXISTS (
    SELECT 1 FROM audit_events AS audit
     WHERE audit.aggregate_type = 'EXTERNAL_EXECUTION_OBSERVATION'
       AND audit.aggregate_id = NEW.id
       AND audit.event_type = 'EXTERNAL_EXECUTION_OBSERVED'
       AND audit.actor_type = 'RUNTIME'
       AND audit.before_version = NEW.expected_record_version
       AND audit.after_version = NEW.expected_record_version + 1
       AND audit.payload_digest = NEW.observation_digest
       AND audit.occurred_at = NEW.observed_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'External execution observation lacks current intent authority');
END;

CREATE TRIGGER external_maintenance_intents_insert_guard
BEFORE INSERT ON external_maintenance_intents
WHEN NOT (
  NEW.state = 'AUTHORIZED' AND NEW.sequence = 1 AND
  NEW.observed_at IS NULL AND NEW.failure_code IS NULL AND
  EXISTS (
    SELECT 1 FROM external_execution_records AS execution
     WHERE execution.id = NEW.external_execution_id
       AND execution.compaction_policy = 'MANUAL_BEFORE_OPERATION'
       AND execution.state NOT IN ('COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED')
       AND NEW.authorized_at >= execution.updated_at
  ) AND EXISTS (
    SELECT 1 FROM audit_events AS audit
     WHERE audit.sequence = NEW.audit_sequence
       AND audit.aggregate_type = 'EXTERNAL_MAINTENANCE'
       AND audit.aggregate_id = NEW.id
       AND audit.event_type = 'EXTERNAL_MAINTENANCE_AUTHORIZED'
       AND audit.actor_type = 'RUNTIME'
       AND audit.before_version IS NULL
       AND audit.after_version = 1
       AND audit.payload_digest = NEW.record_digest
       AND audit.occurred_at = NEW.authorized_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'External maintenance authorization lacks current Runtime authority');
END;

CREATE TRIGGER external_execution_records_insert_guard
BEFORE INSERT ON external_execution_records
WHEN NOT (
  NEW.version = 1 AND NEW.state = 'AUTHORIZED' AND NEW.updated_at = NEW.authorized_at AND
  NEW.terminal_at IS NULL AND NEW.backend_session_ref IS NULL AND
  NEW.backend_operation_ref IS NULL AND NEW.process_identity_json IS NULL AND
  NEW.compaction_count = 0 AND NEW.turn_interrupt_count = 0 AND
  NEW.failure_code IS NULL AND NEW.result_event_id IS NULL AND
  NEW.last_observation_id IS NULL AND
  json_extract(NEW.thread_json, '$.kind') = 'FRESH' AND
  (SELECT count(*) FROM json_each(NEW.thread_json)) = 1 AND
  EXISTS (
    SELECT 1
      FROM worker_dispatch_claims AS claim
      JOIN context_manifests AS context ON context.id = claim.context_manifest_id
      JOIN workflow_execution_profile_bindings AS profile
        ON profile.workflow_id = claim.workflow_id
      JOIN workflow_policy_bindings AS policy ON policy.workflow_id = claim.workflow_id
      JOIN external_execution_profile_extensions AS extension
        ON extension.profile_id = claim.execution_profile_id
     WHERE claim.attempt_id = NEW.attempt_id
       AND claim.workflow_id = NEW.workflow_id
       AND claim.workflow_version = NEW.workflow_version_at_authorization
       AND claim.worker_session_id = NEW.worker_session_id
       AND claim.context_manifest_id = NEW.context_manifest_id
       AND claim.context_manifest_digest = NEW.context_manifest_digest
       AND claim.package_digest = NEW.context_package_digest
       AND claim.execution_profile_id = NEW.execution_profile_id
       AND claim.execution_profile_digest = NEW.execution_profile_digest
       AND context.goal_id = NEW.goal_id
       AND context.goal_revision = NEW.goal_revision
       AND context.phase = NEW.phase
       AND context.policy_bundle_id = NEW.policy_bundle_id
       AND context.policy_bundle_digest = NEW.policy_bundle_digest
       AND profile.profile_digest = NEW.execution_profile_digest
       AND policy.policy_bundle_id = NEW.policy_bundle_id
       AND policy.policy_bundle_digest = NEW.policy_bundle_digest
       AND (
         (NEW.schema_version = 1 AND
           json_extract(extension.external_execution_json, '$.schemaVersion') IN (1, 2)) OR
         (NEW.schema_version = 2 AND
           json_extract(extension.external_execution_json, '$.schemaVersion') = 3 AND
           (SELECT count(*) FROM json_each(NEW.source_authority_json)) = 4 AND
           EXISTS (
             SELECT 1
               FROM json_each(extension.external_execution_json, '$.phaseDispatch') AS dispatch
              WHERE json_extract(dispatch.value, '$.phase') = NEW.phase
                AND json_extract(dispatch.value, '$.executionConfigDigest') =
                  NEW.execution_config_digest
                AND json_extract(dispatch.value, '$.instructionSourceManifestDigest') =
                  NEW.instruction_source_manifest_digest
                AND json_extract(dispatch.value, '$.continuityPolicy') = NEW.continuity_policy
                AND json_extract(dispatch.value, '$.compactionPolicy') = NEW.compaction_policy
                AND json_extract(dispatch.value, '$.fallbackPolicy') = NEW.fallback_policy
                AND json_extract(dispatch.value, '$.sourceAuthorityKind') =
                  json_extract(NEW.source_authority_json, '$.kind')
           ) AND (
             (
               json_extract(NEW.source_authority_json, '$.kind') = 'PROJECT_READ' AND
               EXISTS (
                 SELECT 1
                   FROM project_source_read_authorities AS source
                   JOIN project_read_context_manifest_extensions AS binding
                     ON binding.context_manifest_id = NEW.context_manifest_id
                  WHERE source.id = json_extract(
                    NEW.source_authority_json, '$.projectReadAuthorityId'
                  )
                    AND source.record_digest = json_extract(
                      NEW.source_authority_json, '$.projectReadAuthorityRecordDigest'
                    )
                    AND source.snapshot_leaf_realpath = json_extract(
                      NEW.source_authority_json, '$.snapshotCwdIdentity'
                    )
                    AND source.id = binding.project_read_authority_id
                    AND source.record_digest = binding.project_read_authority_record_digest
                    AND source.attempt_id = NEW.attempt_id
                    AND source.workflow_id = NEW.workflow_id
                    AND source.workflow_version = NEW.workflow_version_at_authorization
                    AND source.phase = NEW.phase
                    AND source.execution_profile_id = NEW.execution_profile_id
                    AND source.execution_profile_digest = NEW.execution_profile_digest
                    AND json_extract(source.canonical_json, '$.phaseDispatchEntryDigest') =
                      NEW.phase_dispatch_entry_digest
               )
             ) OR (
               json_extract(NEW.source_authority_json, '$.kind') = 'CANDIDATE' AND
               context.phase = 'IMPLEMENT' AND context.candidate_generation_id IS NOT NULL AND
               context.candidate_digest IS NOT NULL
             )
           ))
       )
  ) AND EXISTS (
    SELECT 1 FROM audit_events AS audit
     WHERE audit.sequence = NEW.audit_sequence
       AND audit.aggregate_type = 'EXTERNAL_EXECUTION'
       AND audit.aggregate_id = NEW.id
       AND audit.event_type = 'EXTERNAL_EXECUTION_AUTHORIZED'
       AND audit.actor_type = 'RUNTIME'
       AND audit.before_version IS NULL
       AND audit.after_version = 1
       AND audit.payload_digest = NEW.record_digest
       AND audit.occurred_at = NEW.authorized_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'External execution authorization lacks exact dispatch authority');
END;

CREATE TRIGGER external_execution_records_update_guard
BEFORE UPDATE ON external_execution_records
WHEN NOT (
  NEW.version = OLD.version + 1 AND
  NEW.id = OLD.id AND NEW.schema_version = OLD.schema_version AND
  NEW.goal_id = OLD.goal_id AND NEW.goal_revision = OLD.goal_revision AND
  NEW.workflow_id = OLD.workflow_id AND
  NEW.workflow_version_at_authorization = OLD.workflow_version_at_authorization AND
  NEW.phase = OLD.phase AND NEW.phase_version = OLD.phase_version AND
  NEW.attempt_id = OLD.attempt_id AND NEW.worker_session_id = OLD.worker_session_id AND
  NEW.dispatch_claim_digest = OLD.dispatch_claim_digest AND
  NEW.context_manifest_id = OLD.context_manifest_id AND
  NEW.context_manifest_digest = OLD.context_manifest_digest AND
  NEW.context_package_digest = OLD.context_package_digest AND
  NEW.execution_profile_id = OLD.execution_profile_id AND
  NEW.execution_profile_digest = OLD.execution_profile_digest AND
  NEW.policy_bundle_id = OLD.policy_bundle_id AND
  NEW.policy_bundle_digest = OLD.policy_bundle_digest AND
  NEW.backend_kind = OLD.backend_kind AND
  NEW.binary_identity_digest = OLD.binary_identity_digest AND
  NEW.binary_protocol_schema_digest = OLD.binary_protocol_schema_digest AND
  NEW.execution_config_digest = OLD.execution_config_digest AND
  NEW.managed_requirements_digest = OLD.managed_requirements_digest AND
  NEW.instruction_source_manifest_digest = OLD.instruction_source_manifest_digest AND
  NEW.controlled_state_root_identity = OLD.controlled_state_root_identity AND
  NEW.process_launch_nonce = OLD.process_launch_nonce AND
  NEW.thread_json = OLD.thread_json AND NEW.continuity_policy = OLD.continuity_policy AND
  NEW.compaction_policy = OLD.compaction_policy AND
  NEW.retention_policy = OLD.retention_policy AND
  NEW.fallback_policy = OLD.fallback_policy AND
  NEW.interruption_policy = OLD.interruption_policy AND
  NEW.candidate_workspace_lease_id IS OLD.candidate_workspace_lease_id AND
  NEW.candidate_workspace_lease_digest IS OLD.candidate_workspace_lease_digest AND
  NEW.candidate_workspace_cwd_identity IS OLD.candidate_workspace_cwd_identity AND
  NEW.phase_dispatch_entry_digest IS OLD.phase_dispatch_entry_digest AND
  NEW.source_authority_json IS OLD.source_authority_json AND
  NEW.authorized_at = OLD.authorized_at AND NEW.intent_digest = OLD.intent_digest AND
  OLD.state NOT IN ('COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED') AND
  (
    (OLD.state = 'AUTHORIZED' AND NEW.state = 'PROCESS_OBSERVED' AND
      OLD.process_identity_json IS NULL AND NEW.process_identity_json IS NOT NULL) OR
    (NEW.process_identity_json IS OLD.process_identity_json)
  ) AND
  (
    (OLD.state = 'AUTHORIZED' AND NEW.state IN ('PROCESS_OBSERVED', 'FAILED', 'INTERRUPTED', 'ABANDONED')) OR
    (OLD.state = 'PROCESS_OBSERVED' AND NEW.state IN ('SESSION_OBSERVED', 'FAILED', 'INTERRUPTED', 'ABANDONED')) OR
    (OLD.state = 'SESSION_OBSERVED' AND NEW.state IN ('OPERATION_RUNNING', 'FAILED', 'INTERRUPTED', 'ABANDONED')) OR
    (OLD.state = 'OPERATION_RUNNING' AND NEW.state IN ('COMPLETED', 'FAILED', 'INTERRUPTED', 'ABANDONED'))
  ) AND NEW.updated_at >= OLD.updated_at AND NEW.audit_sequence > OLD.audit_sequence AND
  (
    NEW.state NOT IN ('COMPLETED', 'INTERRUPTED', 'FAILED', 'ABANDONED') OR
    NOT EXISTS (
      SELECT 1 FROM external_maintenance_intents AS maintenance
       WHERE maintenance.external_execution_id = OLD.id
         AND maintenance.state = 'AUTHORIZED'
    )
  ) AND EXISTS (
    SELECT 1 FROM audit_events AS audit
     WHERE audit.sequence = NEW.audit_sequence
       AND audit.aggregate_type = 'EXTERNAL_EXECUTION'
       AND audit.aggregate_id = NEW.id
       AND audit.actor_type = 'RUNTIME'
       AND audit.before_version = OLD.version
       AND audit.after_version = NEW.version
       AND audit.payload_digest = NEW.record_digest
       AND audit.occurred_at = NEW.updated_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'External execution update violates lifecycle authority');
END;

CREATE TRIGGER external_execution_records_no_delete
BEFORE DELETE ON external_execution_records
BEGIN
  SELECT RAISE(ABORT, 'External execution records cannot be deleted');
END;
