CREATE TABLE workflow_policy_binding_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

CREATE TRIGGER workflow_policy_binding_migration_guard_reject
BEFORE INSERT ON workflow_policy_binding_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(ABORT, 'legacy-unbound-policy-authority');
END;

-- The exact Policy used by historical execution cannot be reconstructed from
-- whichever Policy happens to be installed now. Retain unstarted authority,
-- but refuse an ambiguous upgrade atomically.
INSERT INTO workflow_policy_binding_migration_guard(valid)
SELECT 0
WHERE EXISTS (SELECT 1 FROM attempts)
   OR EXISTS (SELECT 1 FROM workflow_execution_profile_bindings)
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
   OR EXISTS (SELECT 1 FROM acceptance_repairs)
   OR EXISTS (SELECT 1 FROM recovery_reconciliations);

DROP TRIGGER workflow_policy_binding_migration_guard_reject;
DROP TABLE workflow_policy_binding_migration_guard;

CREATE TABLE workflow_policy_bindings (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  policy_bundle_id TEXT NOT NULL,
  policy_bundle_version TEXT NOT NULL CHECK (length(trim(policy_bundle_version)) > 0),
  policy_bundle_digest TEXT NOT NULL,
  start_command_id TEXT NOT NULL UNIQUE
    REFERENCES processed_commands(command_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  bound_at TEXT NOT NULL,
  binding_digest TEXT NOT NULL UNIQUE CHECK (
    length(binding_digest) = 71
    AND substr(binding_digest, 1, 7) = 'sha256:'
    AND substr(binding_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  UNIQUE (workflow_id, policy_bundle_id, policy_bundle_digest),
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER workflow_policy_bindings_insert_guard
BEFORE INSERT ON workflow_policy_bindings
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
      JOIN policy_bundles AS policy
        ON policy.id = NEW.policy_bundle_id
       AND policy.bundle_digest = NEW.policy_bundle_digest
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
       AND policy.policy_version = NEW.policy_bundle_version
       AND policy.installed_at <= NEW.bound_at
  )
  AND EXISTS (
    SELECT 1
      FROM audit_events AS audit
     WHERE audit.aggregate_type = 'WORKFLOW_POLICY_BINDING'
       AND audit.aggregate_id = NEW.workflow_id
       AND audit.event_type = 'WORKFLOW_POLICY_BOUND'
       AND audit.actor_type = 'RUNTIME'
       AND audit.command_id = NEW.start_command_id
       AND audit.before_version = 1
       AND audit.after_version = 2
       AND audit.payload_digest = NEW.binding_digest
       AND audit.occurred_at = NEW.bound_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid Workflow Policy binding');
END;

CREATE TRIGGER workflow_policy_bindings_no_update
BEFORE UPDATE ON workflow_policy_bindings
BEGIN
  SELECT RAISE(ABORT, 'Workflow Policy bindings are immutable');
END;

CREATE TRIGGER workflow_policy_bindings_no_delete
BEFORE DELETE ON workflow_policy_bindings
BEGIN
  SELECT RAISE(ABORT, 'Workflow Policy bindings cannot be deleted');
END;

CREATE TRIGGER context_manifests_workflow_policy_binding_guard
BEFORE INSERT ON context_manifests
WHEN NOT EXISTS (
  SELECT 1
    FROM workflow_policy_bindings AS binding
   WHERE binding.workflow_id = NEW.workflow_id
     AND binding.goal_id = NEW.goal_id
     AND binding.policy_bundle_id = NEW.policy_bundle_id
     AND binding.policy_bundle_digest = NEW.policy_bundle_digest
     AND binding.bound_at <= NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'Context Manifest changed its Workflow Policy binding');
END;

CREATE TRIGGER evidence_records_workflow_policy_binding_guard
BEFORE INSERT ON evidence_records
WHEN NOT EXISTS (
  SELECT 1
    FROM workflow_policy_bindings AS binding
   WHERE binding.workflow_id = NEW.workflow_id
     AND binding.goal_id = NEW.goal_id
     AND binding.policy_bundle_id = NEW.policy_bundle_id
     AND binding.policy_bundle_digest = NEW.policy_bundle_digest
     AND binding.bound_at <= NEW.recorded_at
)
BEGIN
  SELECT RAISE(ABORT, 'Evidence changed its Workflow Policy binding');
END;

CREATE TRIGGER acceptance_input_manifests_workflow_policy_binding_guard
BEFORE INSERT ON acceptance_input_manifests
WHEN NOT EXISTS (
  SELECT 1
    FROM workflow_policy_bindings AS binding
   WHERE binding.workflow_id = NEW.workflow_id
     AND binding.goal_id = NEW.goal_id
     AND binding.policy_bundle_id = NEW.policy_bundle_id
     AND binding.policy_bundle_digest = NEW.policy_bundle_digest
     AND binding.bound_at <= NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'Acceptance input changed its Workflow Policy binding');
END;

CREATE TRIGGER workflow_closeouts_workflow_policy_binding_guard
BEFORE INSERT ON workflow_closeouts
WHEN NOT EXISTS (
  SELECT 1
    FROM workflow_policy_bindings AS binding
   WHERE binding.workflow_id = NEW.workflow_id
     AND binding.goal_id = NEW.goal_id
     AND binding.policy_bundle_id = NEW.policy_bundle_id
     AND binding.policy_bundle_digest = NEW.policy_bundle_digest
     AND binding.bound_at <= NEW.closed_at
)
BEGIN
  SELECT RAISE(ABORT, 'Closeout changed its Workflow Policy binding');
END;

CREATE TRIGGER acceptance_repairs_workflow_policy_binding_guard
BEFORE INSERT ON acceptance_repairs
WHEN NOT EXISTS (
  SELECT 1
    FROM workflow_policy_bindings AS binding
   WHERE binding.workflow_id = NEW.workflow_id
     AND binding.goal_id = NEW.goal_id
     AND binding.policy_bundle_id = NEW.policy_bundle_id
     AND binding.policy_bundle_digest = NEW.policy_bundle_digest
     AND binding.bound_at <= NEW.repaired_at
)
BEGIN
  SELECT RAISE(ABORT, 'Acceptance repair changed its Workflow Policy binding');
END;

CREATE TRIGGER recovery_reconciliations_workflow_policy_binding_guard
BEFORE INSERT ON recovery_reconciliations
WHEN NOT EXISTS (
  SELECT 1
    FROM workflow_policy_bindings AS binding
   WHERE binding.workflow_id = NEW.workflow_id
     AND binding.goal_id = NEW.goal_id
     AND binding.bound_at <= NEW.inspected_at
)
BEGIN
  SELECT RAISE(ABORT, 'Recovery has no Workflow Policy binding');
END;
