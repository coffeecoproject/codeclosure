CREATE TABLE execution_profile_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

CREATE TRIGGER execution_profile_migration_guard_reject
BEFORE INSERT ON execution_profile_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(ABORT, 'legacy-unbound-execution-authority');
END;

-- Slice 7 cannot infer which adapter composition produced pre-profile
-- execution history. Unstarted Goal/Workflow authority is safe to retain; any
-- execution authority makes this migration fail atomically.
INSERT INTO execution_profile_migration_guard(valid)
SELECT 0
WHERE EXISTS (SELECT 1 FROM attempts)
   OR EXISTS (SELECT 1 FROM context_manifests)
   OR EXISTS (SELECT 1 FROM worker_dispatch_claims)
   OR EXISTS (SELECT 1 FROM worker_event_receipts)
   OR EXISTS (SELECT 1 FROM candidates)
   OR EXISTS (SELECT 1 FROM candidate_generations)
   OR EXISTS (SELECT 1 FROM check_specifications)
   OR EXISTS (SELECT 1 FROM verification_obligations)
   OR EXISTS (SELECT 1 FROM evidence_records)
   OR EXISTS (SELECT 1 FROM evidence_sets)
   OR EXISTS (SELECT 1 FROM acceptance_input_manifests)
   OR EXISTS (SELECT 1 FROM acceptance_decisions)
   OR EXISTS (SELECT 1 FROM workflow_closeouts)
   OR EXISTS (SELECT 1 FROM acceptance_repairs);

DROP TRIGGER execution_profile_migration_guard_reject;
DROP TABLE execution_profile_migration_guard;

CREATE TABLE execution_profiles (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  profile_version TEXT NOT NULL CHECK (length(trim(profile_version)) > 0),
  canonical_content_json TEXT NOT NULL CHECK (json_type(canonical_content_json) = 'object'),
  profile_digest TEXT NOT NULL UNIQUE CHECK (
    length(profile_digest) = 71
    AND substr(profile_digest, 1, 7) = 'sha256:'
    AND substr(profile_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  installed_at TEXT NOT NULL,
  UNIQUE (id, profile_digest)
) STRICT;

CREATE TABLE workflow_execution_profile_bindings (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL CHECK (length(trim(profile_version)) > 0),
  profile_digest TEXT NOT NULL,
  start_command_id TEXT NOT NULL UNIQUE
    REFERENCES processed_commands(command_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  bound_at TEXT NOT NULL,
  binding_digest TEXT NOT NULL UNIQUE CHECK (
    length(binding_digest) = 71
    AND substr(binding_digest, 1, 7) = 'sha256:'
    AND substr(binding_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  UNIQUE (workflow_id, profile_id, profile_digest),
  FOREIGN KEY (profile_id, profile_digest)
    REFERENCES execution_profiles(id, profile_digest) ON DELETE RESTRICT
) STRICT;

ALTER TABLE context_manifests
ADD COLUMN execution_profile_id TEXT REFERENCES execution_profiles(id) ON DELETE RESTRICT;

ALTER TABLE context_manifests
ADD COLUMN execution_profile_digest TEXT;

-- The legacy table fixes schema_version to 1. The migration guard above proves
-- it is empty, so recreate it rather than relabeling the new profile-bound
-- claim format as the old protocol.
DROP TRIGGER worker_dispatch_claims_insert_guard;
DROP TABLE worker_dispatch_claims;

CREATE TABLE worker_dispatch_claims (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL CHECK (
    workflow_version >= 1 AND workflow_version <= 9007199254740991
  ),
  worker_session_id TEXT NOT NULL,
  context_manifest_id TEXT NOT NULL UNIQUE REFERENCES context_manifests(id) ON DELETE RESTRICT,
  context_manifest_digest TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  execution_profile_id TEXT NOT NULL REFERENCES execution_profiles(id) ON DELETE RESTRICT,
  execution_profile_digest TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  FOREIGN KEY (execution_profile_id, execution_profile_digest)
    REFERENCES execution_profiles(id, profile_digest) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER execution_profiles_insert_guard
BEFORE INSERT ON execution_profiles
WHEN NOT (
  NEW.schema_version = 1
  AND length(NEW.id) BETWEEN 9 AND 136
  AND substr(NEW.id, 1, 8) = 'profile_'
  AND substr(NEW.id, 9) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 9, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND length(trim(NEW.profile_version)) > 0
  AND json_type(NEW.canonical_content_json) = 'object'
  AND length(NEW.profile_digest) = 71
  AND substr(NEW.profile_digest, 1, 7) = 'sha256:'
  AND substr(NEW.profile_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.installed_at) = 24
  AND NEW.installed_at GLOB '????-??-??T??:??:??.???Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.installed_at) = NEW.installed_at
  AND EXISTS (
    SELECT 1
    FROM audit_events AS audit
    WHERE audit.aggregate_type = 'EXECUTION_PROFILE'
      AND audit.aggregate_id = NEW.id
      AND audit.event_type = 'EXECUTION_PROFILE_INSTALLED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.command_id IS NULL
      AND audit.before_version IS NULL
      AND audit.after_version IS NULL
      AND audit.payload_digest = NEW.profile_digest
      AND audit.occurred_at = NEW.installed_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Execution Profile authority');
END;

CREATE TRIGGER execution_profiles_no_update
BEFORE UPDATE ON execution_profiles
BEGIN
  SELECT RAISE(ABORT, 'Execution Profiles are immutable');
END;

CREATE TRIGGER execution_profiles_no_delete
BEFORE DELETE ON execution_profiles
BEGIN
  SELECT RAISE(ABORT, 'Execution Profiles cannot be deleted');
END;

CREATE TRIGGER workflow_execution_profile_bindings_insert_guard
BEFORE INSERT ON workflow_execution_profile_bindings
WHEN NOT (
  NEW.schema_version = 1
  AND length(NEW.bound_at) = 24
  AND NEW.bound_at GLOB '????-??-??T??:??:??.???Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.bound_at) = NEW.bound_at
  AND EXISTS (
    SELECT 1
    FROM workflows AS workflow
    JOIN goals AS goal ON goal.id = workflow.goal_id
    JOIN attempts AS attempt ON attempt.id = workflow.active_attempt_id
    JOIN processed_commands AS command ON command.command_id = NEW.start_command_id
    JOIN execution_profiles AS profile
      ON profile.id = NEW.profile_id AND profile.profile_digest = NEW.profile_digest
    WHERE workflow.id = NEW.workflow_id
      AND workflow.goal_id = NEW.goal_id
      AND workflow.goal_revision = goal.revision
      AND workflow.phase = 'DISCOVERY'
      AND workflow.run_status = 'RUNNING'
      AND workflow.version = 2
      AND workflow.updated_at = NEW.bound_at
      AND goal.status = 'ACTIVE'
      AND attempt.workflow_id = workflow.id
      AND attempt.phase = 'DISCOVERY'
      AND attempt.sequence = 1
      AND attempt.status = 'RUNNING'
      AND attempt.started_at = NEW.bound_at
      AND command.aggregate_type = 'GOAL'
      AND command.aggregate_id = NEW.goal_id
      AND command.completed_at = NEW.bound_at
      AND profile.profile_version = NEW.profile_version
      AND profile.installed_at <= NEW.bound_at
  )
  AND EXISTS (
    SELECT 1
    FROM audit_events AS audit
    WHERE audit.aggregate_type = 'EXECUTION_PROFILE_BINDING'
      AND audit.aggregate_id = NEW.workflow_id
      AND audit.event_type = 'EXECUTION_PROFILE_BOUND'
      AND audit.actor_type = 'RUNTIME'
      AND audit.command_id = NEW.start_command_id
      AND audit.before_version = 1
      AND audit.after_version = 2
      AND audit.payload_digest = NEW.binding_digest
      AND audit.occurred_at = NEW.bound_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid Workflow Execution Profile binding');
END;

CREATE TRIGGER workflow_execution_profile_bindings_no_update
BEFORE UPDATE ON workflow_execution_profile_bindings
BEGIN
  SELECT RAISE(ABORT, 'Workflow Execution Profile bindings are immutable');
END;

CREATE TRIGGER workflow_execution_profile_bindings_no_delete
BEFORE DELETE ON workflow_execution_profile_bindings
BEGIN
  SELECT RAISE(ABORT, 'Workflow Execution Profile bindings cannot be deleted');
END;

DROP TRIGGER context_manifests_slice4_insert_guard;

CREATE TRIGGER context_manifests_slice4_insert_guard
BEFORE INSERT ON context_manifests
WHEN NOT (
  NEW.schema_version = 2
  AND length(trim(NEW.compiler_version)) > 0
  AND NEW.phase IN ('DISCOVERY', 'PLAN', 'IMPLEMENT')
  AND json_type(NEW.entries_json) = 'array'
  AND json_type(NEW.omission_decisions_json) = 'array'
  AND length(NEW.id) BETWEEN 9 AND 136
  AND substr(NEW.id, 1, 8) = 'context_'
  AND substr(NEW.id, 9) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 9, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND length(NEW.created_at) = 24
  AND NEW.created_at GLOB '????-??-??T??:??:??.???Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) = NEW.created_at
  AND (NEW.candidate_generation_id IS NULL) = (NEW.candidate_digest IS NULL)
  AND length(NEW.execution_profile_id) BETWEEN 9 AND 136
  AND substr(NEW.execution_profile_id, 1, 8) = 'profile_'
  AND length(NEW.execution_profile_digest) = 71
  AND substr(NEW.execution_profile_digest, 1, 7) = 'sha256:'
  AND substr(NEW.execution_profile_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.policy_bundle_digest) = 71
  AND substr(NEW.policy_bundle_digest, 1, 7) = 'sha256:'
  AND substr(NEW.policy_bundle_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.capability_grant_digest) = 71
  AND substr(NEW.capability_grant_digest, 1, 7) = 'sha256:'
  AND substr(NEW.capability_grant_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.response_contract_digest) = 71
  AND substr(NEW.response_contract_digest, 1, 7) = 'sha256:'
  AND substr(NEW.response_contract_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.package_digest) = 71
  AND substr(NEW.package_digest, 1, 7) = 'sha256:'
  AND substr(NEW.package_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.manifest_digest) = 71
  AND substr(NEW.manifest_digest, 1, 7) = 'sha256:'
  AND substr(NEW.manifest_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND EXISTS (
    SELECT 1
    FROM attempts AS attempt
    JOIN workflows AS workflow ON workflow.id = attempt.workflow_id
    JOIN workflow_execution_profile_bindings AS binding
      ON binding.workflow_id = workflow.id
    WHERE attempt.id = NEW.attempt_id
      AND attempt.context_manifest_id = NEW.id
      AND attempt.worker_session_ref IS NOT NULL
      AND NEW.workflow_id = workflow.id
      AND NEW.goal_id = workflow.goal_id
      AND NEW.goal_revision = workflow.goal_revision
      AND NEW.phase = attempt.phase
      AND NEW.phase = workflow.phase
      AND NEW.workflow_version = workflow.version
      AND NEW.execution_profile_id = binding.profile_id
      AND NEW.execution_profile_digest = binding.profile_digest
      AND NEW.created_at >= attempt.started_at
      AND NEW.created_at >= binding.bound_at
      AND (
        (workflow.active_candidate_generation_id IS NULL
          AND NEW.candidate_generation_id IS NULL)
        OR workflow.active_candidate_generation_id = NEW.candidate_generation_id
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid Context Manifest authority binding');
END;

CREATE TRIGGER worker_dispatch_claims_insert_guard
BEFORE INSERT ON worker_dispatch_claims
WHEN NOT (
  NEW.schema_version = 2
  AND length(NEW.worker_session_id) BETWEEN 8 AND 135
  AND substr(NEW.worker_session_id, 1, 7) = 'worker_'
  AND substr(NEW.worker_session_id, 8) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.worker_session_id, 8, 1) GLOB '[a-z0-9]'
  AND substr(NEW.worker_session_id, -1, 1) GLOB '[a-z0-9]'
  AND length(NEW.context_manifest_digest) = 71
  AND substr(NEW.context_manifest_digest, 1, 7) = 'sha256:'
  AND substr(NEW.context_manifest_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.package_digest) = 71
  AND substr(NEW.package_digest, 1, 7) = 'sha256:'
  AND substr(NEW.package_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.execution_profile_id) BETWEEN 9 AND 136
  AND substr(NEW.execution_profile_id, 1, 8) = 'profile_'
  AND length(NEW.execution_profile_digest) = 71
  AND substr(NEW.execution_profile_digest, 1, 7) = 'sha256:'
  AND substr(NEW.execution_profile_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.claimed_at) = 24
  AND NEW.claimed_at GLOB '????-??-??T??:??:??.???Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.claimed_at) = NEW.claimed_at
  AND EXISTS (
    SELECT 1
    FROM workflows AS workflow
    JOIN attempts AS attempt ON attempt.id = NEW.attempt_id
    JOIN context_manifests AS context ON context.id = NEW.context_manifest_id
    JOIN workflow_execution_profile_bindings AS binding
      ON binding.workflow_id = workflow.id
    WHERE workflow.id = NEW.workflow_id
      AND workflow.version = NEW.workflow_version
      AND workflow.run_status = 'RUNNING'
      AND workflow.active_attempt_id = NEW.attempt_id
      AND attempt.workflow_id = workflow.id
      AND attempt.status = 'RUNNING'
      AND attempt.worker_session_ref = NEW.worker_session_id
      AND attempt.context_manifest_id = context.id
      AND context.workflow_id = workflow.id
      AND context.workflow_version = workflow.version
      AND context.manifest_digest = NEW.context_manifest_digest
      AND context.package_digest = NEW.package_digest
      AND context.execution_profile_id = NEW.execution_profile_id
      AND context.execution_profile_digest = NEW.execution_profile_digest
      AND binding.profile_id = NEW.execution_profile_id
      AND binding.profile_digest = NEW.execution_profile_digest
      AND NEW.claimed_at >= workflow.updated_at
      AND NEW.claimed_at >= binding.bound_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Worker dispatch is not eligible');
END;

CREATE TRIGGER worker_dispatch_claims_no_update
BEFORE UPDATE ON worker_dispatch_claims
BEGIN
  SELECT RAISE(ABORT, 'Worker dispatch claims are immutable');
END;

CREATE TRIGGER worker_dispatch_claims_no_delete
BEFORE DELETE ON worker_dispatch_claims
BEGIN
  SELECT RAISE(ABORT, 'Worker dispatch claims cannot be deleted');
END;
