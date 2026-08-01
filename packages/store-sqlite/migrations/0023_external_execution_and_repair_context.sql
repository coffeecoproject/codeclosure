-- Slice 6 uses compatibility extension tables so the immutable M1 Profile-v1
-- and Context-v2 rows retain their exact stored schema and digest meanings.

-- Context v3 is stored as the immutable v2 base row plus a v3 extension. The
-- base source guard therefore admits only the additional compiler-owned repair
-- entry kinds, with their exact authority classes, for IMPLEMENT Manifests.
DROP TRIGGER context_manifests_m1_source_insert_guard;

CREATE TRIGGER context_manifests_m1_source_insert_guard
BEFORE INSERT ON context_manifests
WHEN COALESCE(
  json_type(NEW.entries_json) = 'array'
  AND json_type(NEW.omission_decisions_json) = 'array'
  AND json_array_length(NEW.omission_decisions_json) = 0
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(NEW.entries_json) AS entry
    WHERE COALESCE(
      json_type(entry.value) = 'object'
      AND json_type(entry.value, '$.kind') = 'text'
      AND json_type(entry.value, '$.authorityClass') = 'text'
      AND (
        (
          json_extract(entry.value, '$.kind') IN ('GOAL', 'SUCCESS_CRITERION')
          AND json_extract(entry.value, '$.authorityClass') = 'GOAL_AUTHORITY'
        )
        OR (
          json_extract(entry.value, '$.kind') = 'CANDIDATE'
          AND json_extract(entry.value, '$.authorityClass') = 'PROJECT_OBSERVATION'
        )
        OR (
          NEW.phase = 'IMPLEMENT'
          AND json_extract(entry.value, '$.kind') IN (
            'ACCEPTANCE_REPAIR', 'ACCEPTANCE_DECISION', 'ACCEPTANCE_INPUT_MANIFEST',
            'CANDIDATE_RELATIONSHIP', 'PRESERVATION_CONSTRAINT'
          )
          AND json_extract(entry.value, '$.authorityClass') = 'RUNTIME_DECISION'
        )
        OR (
          NEW.phase = 'IMPLEMENT'
          AND json_extract(entry.value, '$.kind') IN (
            'EVIDENCE_SET', 'EVIDENCE', 'EVIDENCE_ELIGIBILITY'
          )
          AND json_extract(entry.value, '$.authorityClass') = 'EVIDENCE_AUTHORITY'
        )
        OR (
          NEW.phase = 'IMPLEMENT'
          AND json_extract(entry.value, '$.kind') = 'PRIOR_ATTEMPT_FEEDBACK'
          AND json_extract(entry.value, '$.authorityClass') = 'NON_AUTHORITATIVE_WORKING'
        )
      ),
      0
    ) = 0
  )
  AND (
    (
      NEW.phase IN ('DISCOVERY', 'PLAN')
      AND NEW.candidate_generation_id IS NULL
      AND NEW.candidate_digest IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.entries_json)
        WHERE json_extract(value, '$.kind') = 'CANDIDATE'
      )
    )
    OR (
      NEW.phase = 'IMPLEMENT'
      AND EXISTS (
        SELECT 1
        FROM candidate_generations AS generation
        JOIN candidates AS candidate ON candidate.id = generation.candidate_id
        JOIN workflows AS workflow ON workflow.id = generation.workflow_id
        WHERE generation.id = NEW.candidate_generation_id
          AND generation.state = 'MUTABLE'
          AND generation.base_digest = NEW.candidate_digest
          AND workflow.id = NEW.workflow_id
          AND workflow.goal_id = NEW.goal_id
          AND workflow.goal_revision = NEW.goal_revision
          AND workflow.version = NEW.workflow_version
          AND workflow.active_candidate_generation_id = generation.id
          AND candidate.goal_id = workflow.goal_id
          AND (
            SELECT count(*)
            FROM json_each(NEW.entries_json)
            WHERE json_extract(value, '$.kind') = 'CANDIDATE'
          ) = 1
          AND (
            SELECT count(*)
            FROM json_each(NEW.entries_json)
            WHERE json_extract(value, '$.kind') = 'CANDIDATE'
              AND json_extract(value, '$.authorityClass') = 'PROJECT_OBSERVATION'
              AND json_extract(value, '$.sourceRef') = generation.id
              AND json_extract(value, '$.sourceRevision') = CAST(workflow.version AS TEXT)
              AND json_extract(value, '$.sourceDigest') = generation.base_digest
          ) = 1
      )
    )
  ),
  0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'M1 Context source authority is not exact and current');
END;

-- A v2 external dispatch can fail before a durable dispatch claim exists. Such
-- failures still terminate the Context-bound Attempt, but only through these
-- Runtime-owned closed reasons and their exact failure class. The existing M1
-- mappings remain unchanged.
DROP TRIGGER attempts_m1_worker_failure_mapping_guard;

CREATE TRIGGER attempts_m1_worker_failure_mapping_guard
BEFORE UPDATE OF status, failure_class, termination_reason ON attempts
WHEN OLD.status = 'RUNNING'
  AND (
    NEW.context_manifest_id IS NOT NULL
    OR NEW.worker_session_ref IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM context_manifests AS context_manifest
      WHERE context_manifest.attempt_id = NEW.id
    )
  )
  AND NEW.status = 'FAILED'
  AND NOT (
    (
      NEW.termination_reason = 'WORKER_BACKEND_FAILURE'
      AND NEW.failure_class = 'TRANSIENT_BACKEND'
    )
    OR (
      NEW.termination_reason IN (
        'WORKER_PORT_INVOCATION_FAILED',
        'EXTERNAL_WORKER_PREPARATION_FAILED',
        'EXTERNAL_DISPATCH_AUTHORIZATION_FAILED'
      )
      AND NEW.failure_class = 'ABRUPT_TERMINATION'
    )
    OR (
      NEW.termination_reason IN (
        'WORKER_PORT_NON_ASYNC_STREAM',
        'WORKER_STREAM_NO_TERMINAL_EVENT',
        'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT'
      )
      AND NEW.failure_class = 'PROTOCOL_ERROR'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Worker failure reason has no exact M1 failure mapping');
END;

CREATE TABLE external_backend_capability_records (
  record_digest TEXT PRIMARY KEY CHECK (
    length(record_digest) = 71 AND substr(record_digest, 1, 7) = 'sha256:' AND
    substr(record_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  backend_kind TEXT NOT NULL CHECK (length(trim(backend_kind)) > 0),
  binary_identity_digest TEXT NOT NULL,
  protocol_schema_digest TEXT NOT NULL,
  configuration_profile_digest TEXT NOT NULL,
  capability_entries_json TEXT NOT NULL CHECK (
    json_valid(capability_entries_json) AND json_type(capability_entries_json) = 'array' AND
    json_array_length(capability_entries_json) > 0
  ),
  observed_at TEXT NOT NULL,
  UNIQUE (
    backend_kind, binary_identity_digest, protocol_schema_digest,
    configuration_profile_digest
  )
) STRICT;

CREATE TRIGGER external_backend_capability_records_insert_guard
BEFORE INSERT ON external_backend_capability_records
WHEN NOT EXISTS (
  SELECT 1 FROM audit_events AS audit
   WHERE audit.aggregate_type = 'EXTERNAL_BACKEND_CAPABILITY'
     AND audit.aggregate_id = NEW.record_digest
     AND audit.event_type = 'EXTERNAL_BACKEND_CAPABILITY_INSTALLED'
     AND audit.actor_type = 'RUNTIME'
     AND audit.payload_digest = NEW.record_digest
     AND audit.occurred_at = NEW.observed_at
)
BEGIN
  SELECT RAISE(ABORT, 'External backend capability record requires its Runtime audit');
END;

CREATE TRIGGER external_backend_capability_records_no_update
BEFORE UPDATE ON external_backend_capability_records
BEGIN
  SELECT RAISE(ABORT, 'External backend capability records are immutable');
END;

CREATE TRIGGER external_backend_capability_records_no_delete
BEFORE DELETE ON external_backend_capability_records
BEGIN
  SELECT RAISE(ABORT, 'External backend capability records cannot be deleted');
END;

CREATE TABLE external_execution_profile_extensions (
  profile_id TEXT PRIMARY KEY REFERENCES execution_profiles(id) ON DELETE RESTRICT,
  logical_schema_version INTEGER NOT NULL CHECK (logical_schema_version = 2),
  capability_record_digest TEXT NOT NULL
    REFERENCES external_backend_capability_records(record_digest) ON DELETE RESTRICT,
  external_execution_json TEXT NOT NULL CHECK (
    json_valid(external_execution_json) AND json_type(external_execution_json) = 'object'
  )
) STRICT;

CREATE TRIGGER external_execution_profile_extensions_insert_guard
BEFORE INSERT ON external_execution_profile_extensions
WHEN NOT EXISTS (
  SELECT 1 FROM execution_profiles AS profile
   WHERE profile.id = NEW.profile_id
     AND profile.schema_version = 1
     AND json_extract(NEW.external_execution_json, '$.schemaVersion') = 1
     AND json_extract(NEW.external_execution_json, '$.capabilityRecordDigest') =
       NEW.capability_record_digest
)
BEGIN
  SELECT RAISE(ABORT, 'External Execution Profile extension has no compatible base authority');
END;

CREATE TRIGGER external_execution_profile_extensions_no_update
BEFORE UPDATE ON external_execution_profile_extensions
BEGIN
  SELECT RAISE(ABORT, 'External Execution Profile extensions are immutable');
END;

CREATE TRIGGER external_execution_profile_extensions_no_delete
BEFORE DELETE ON external_execution_profile_extensions
BEGIN
  SELECT RAISE(ABORT, 'External Execution Profile extensions cannot be deleted');
END;

CREATE TABLE repair_context_manifest_extensions (
  context_manifest_id TEXT PRIMARY KEY REFERENCES context_manifests(id) ON DELETE RESTRICT,
  logical_schema_version INTEGER NOT NULL CHECK (logical_schema_version = 3),
  repair_context_digest TEXT NOT NULL CHECK (
    length(repair_context_digest) = 71 AND
    substr(repair_context_digest, 1, 7) = 'sha256:' AND
    substr(repair_context_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  prior_attempt_feedback_digest TEXT NOT NULL CHECK (
    length(prior_attempt_feedback_digest) = 71 AND
    substr(prior_attempt_feedback_digest, 1, 7) = 'sha256:' AND
    substr(prior_attempt_feedback_digest, 8) NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

CREATE TRIGGER repair_context_manifest_extensions_insert_guard
BEFORE INSERT ON repair_context_manifest_extensions
WHEN NOT EXISTS (
  SELECT 1 FROM context_manifests AS context
   WHERE context.id = NEW.context_manifest_id
     AND context.schema_version = 2
     AND context.phase = 'IMPLEMENT'
     AND context.candidate_generation_id IS NOT NULL
     AND context.candidate_digest IS NOT NULL
     AND (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'ACCEPTANCE_REPAIR'
     ) = 1
     AND (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'ACCEPTANCE_DECISION'
     ) = 1
     AND (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'ACCEPTANCE_INPUT_MANIFEST'
     ) = 1
     AND (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'EVIDENCE_SET'
     ) = 1
     AND (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'CANDIDATE_RELATIONSHIP'
     ) = 1
     AND (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'PRIOR_ATTEMPT_FEEDBACK'
     ) = 1
     AND (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'EVIDENCE'
     ) >= 1
     AND (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'EVIDENCE'
     ) = (
       SELECT count(*) FROM json_each(context.entries_json)
       WHERE json_extract(value, '$.kind') = 'EVIDENCE_ELIGIBILITY'
     )
)
BEGIN
  SELECT RAISE(ABORT, 'Repair Context extension has no compatible base Manifest');
END;

CREATE TRIGGER repair_context_manifest_extensions_no_update
BEFORE UPDATE ON repair_context_manifest_extensions
BEGIN
  SELECT RAISE(ABORT, 'Repair Context Manifest extensions are immutable');
END;

CREATE TRIGGER repair_context_manifest_extensions_no_delete
BEFORE DELETE ON repair_context_manifest_extensions
BEGIN
  SELECT RAISE(ABORT, 'Repair Context Manifest extensions cannot be deleted');
END;

CREATE TABLE external_execution_records (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
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
    (candidate_workspace_lease_id IS NULL AND candidate_workspace_lease_digest IS NULL AND
      candidate_workspace_cwd_identity IS NULL AND phase <> 'IMPLEMENT') OR
    (candidate_workspace_lease_id IS NOT NULL AND candidate_workspace_lease_digest IS NOT NULL AND
      candidate_workspace_cwd_identity IS NOT NULL AND phase = 'IMPLEMENT')
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

CREATE INDEX external_execution_records_workflow_idx
  ON external_execution_records(workflow_id, authorized_at, id);

CREATE TRIGGER external_execution_records_insert_guard
BEFORE INSERT ON external_execution_records
WHEN NOT (
  NEW.version = 1 AND NEW.state = 'AUTHORIZED' AND NEW.updated_at = NEW.authorized_at AND
  NEW.terminal_at IS NULL AND NEW.backend_session_ref IS NULL AND
  NEW.backend_operation_ref IS NULL AND NEW.process_identity_json IS NULL AND
  NEW.compaction_count = 0 AND
  NEW.turn_interrupt_count = 0 AND NEW.failure_code IS NULL AND
  NEW.result_event_id IS NULL AND NEW.last_observation_id IS NULL AND
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
  ) AND
  EXISTS (
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

CREATE TABLE external_execution_observations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  external_execution_id TEXT NOT NULL
    REFERENCES external_execution_records(id) ON DELETE RESTRICT,
  intent_digest TEXT NOT NULL,
  expected_record_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'PROCESS_OBSERVED', 'SESSION_OBSERVED', 'OPERATION_RUNNING',
    'COMPLETED', 'INTERRUPTED', 'FAILED'
  )),
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
  observed_at TEXT NOT NULL,
  observation_digest TEXT NOT NULL UNIQUE,
  CHECK (
    (state = 'PROCESS_OBSERVED' AND process_identity_json IS NOT NULL) OR
    (state <> 'PROCESS_OBSERVED' AND process_identity_json IS NULL)
  ),
  CHECK (
    (state IN ('PROCESS_OBSERVED', 'SESSION_OBSERVED', 'OPERATION_RUNNING', 'COMPLETED') AND
      failure_code IS NULL) OR
    (state IN ('INTERRUPTED', 'FAILED') AND failure_code IN (
      'ADAPTER_REUSED', 'BACKEND_TURN_FAILED', 'CLEAN_SHUTDOWN_FAILED',
      'CLIENT_FAILURE', 'COMPACTION_POLICY_VIOLATION', 'DECLINED_APPROVAL_REQUEST',
      'EFFECTIVE_INPUT_MISMATCH', 'HOST_CANCELLED', 'INVALID_DIRECTIVE',
      'INVALID_REQUEST_BINDING', 'INVALID_TERMINAL_PAYLOAD',
      'INVALID_WORKSPACE_LEASE', 'NO_TERMINAL_PAYLOAD',
      'THREAD_BINDING_MISMATCH', 'TURN_BINDING_MISMATCH',
      'UNSUPPORTED_BACKEND_ACTIVITY', 'UNSUPPORTED_PHASE'
    ))
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

CREATE INDEX external_execution_observations_execution_idx
  ON external_execution_observations(external_execution_id, expected_record_version, id);

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

CREATE TRIGGER external_execution_observations_no_update
BEFORE UPDATE ON external_execution_observations
BEGIN
  SELECT RAISE(ABORT, 'External execution observations are immutable');
END;

CREATE TRIGGER external_execution_observations_no_delete
BEFORE DELETE ON external_execution_observations
BEGIN
  SELECT RAISE(ABORT, 'External execution observations cannot be deleted');
END;

CREATE TABLE external_maintenance_intents (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  external_execution_id TEXT NOT NULL
    REFERENCES external_execution_records(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence >= 1 AND sequence <= 9007199254740991),
  kind TEXT NOT NULL CHECK (kind = 'WORKING_CONTEXT_COMPACTION'),
  state TEXT NOT NULL CHECK (state IN ('AUTHORIZED', 'OBSERVED', 'FAILED', 'ABANDONED')),
  authorized_at TEXT NOT NULL,
  observed_at TEXT,
  failure_code TEXT,
  intent_digest TEXT NOT NULL UNIQUE,
  record_digest TEXT NOT NULL UNIQUE,
  audit_sequence INTEGER NOT NULL REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  UNIQUE (external_execution_id, sequence),
  CHECK (
    (state IN ('AUTHORIZED', 'OBSERVED') AND failure_code IS NULL) OR
    (state IN ('FAILED', 'ABANDONED') AND failure_code IN (
      'ADAPTER_REUSED', 'BACKEND_TURN_FAILED', 'CLEAN_SHUTDOWN_FAILED',
      'CLIENT_FAILURE', 'COMPACTION_POLICY_VIOLATION', 'DECLINED_APPROVAL_REQUEST',
      'EFFECTIVE_INPUT_MISMATCH', 'HOST_CANCELLED', 'INVALID_DIRECTIVE',
      'INVALID_REQUEST_BINDING', 'INVALID_TERMINAL_PAYLOAD',
      'INVALID_WORKSPACE_LEASE', 'NO_TERMINAL_PAYLOAD',
      'THREAD_BINDING_MISMATCH', 'TURN_BINDING_MISMATCH',
      'UNSUPPORTED_BACKEND_ACTIVITY', 'UNSUPPORTED_PHASE',
      'CANCELLED_BEFORE_EXTERNAL_INVOCATION', 'EXTERNAL_WORKER_CREATION_FAILED',
      'EXTERNAL_WORKER_CANCELLED', 'INVALID_EXTERNAL_WORKER_OBSERVATION',
      'EXTERNAL_MAINTENANCE_NOT_OBSERVED', 'EXTERNAL_OBSERVATION_ADMISSION_FAILED',
      'RECOVERY_ABANDONED_ACTIVE_DISPATCH'
    ))
  )
) STRICT;

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

CREATE TRIGGER external_maintenance_intents_update_guard
BEFORE UPDATE ON external_maintenance_intents
WHEN NOT (
  OLD.state = 'AUTHORIZED' AND
  NEW.state IN ('OBSERVED', 'FAILED', 'ABANDONED') AND
  NEW.id = OLD.id AND NEW.schema_version = OLD.schema_version AND
  NEW.external_execution_id = OLD.external_execution_id AND
  NEW.sequence = OLD.sequence AND NEW.kind = OLD.kind AND
  NEW.authorized_at = OLD.authorized_at AND NEW.intent_digest = OLD.intent_digest AND
  NEW.observed_at IS NOT NULL AND NEW.observed_at >= OLD.authorized_at AND
  ((NEW.state = 'OBSERVED' AND NEW.failure_code IS NULL) OR
   (NEW.state IN ('FAILED', 'ABANDONED') AND length(trim(NEW.failure_code)) > 0)) AND
  EXISTS (
    SELECT 1 FROM audit_events AS audit
     WHERE audit.sequence = NEW.audit_sequence
       AND audit.aggregate_type = 'EXTERNAL_MAINTENANCE'
       AND audit.aggregate_id = NEW.id
       AND audit.event_type = 'EXTERNAL_MAINTENANCE_COMPLETED'
       AND audit.actor_type = 'RUNTIME'
       AND audit.before_version = 1
       AND audit.after_version = 2
       AND audit.payload_digest = NEW.record_digest
       AND audit.occurred_at = NEW.observed_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'External maintenance update violates durable lifecycle authority');
END;

CREATE TRIGGER external_maintenance_intents_no_delete
BEFORE DELETE ON external_maintenance_intents
BEGIN
  SELECT RAISE(ABORT, 'External maintenance intents cannot be deleted');
END;
