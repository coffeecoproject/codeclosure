CREATE TABLE acceptance_repair_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

-- ADR 0019 refuses to infer an exact consumed decision, manifest, Check set,
-- Obligation set, and command from the structural child relationship retained
-- by older schemas.
INSERT INTO acceptance_repair_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1 FROM candidate_generations WHERE state = 'REJECTED'
);

DROP TABLE acceptance_repair_migration_guard;

CREATE TABLE acceptance_repairs (
  rejected_candidate_generation_id TEXT PRIMARY KEY
    REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (
    goal_revision >= 1 AND goal_revision <= 9007199254740991
  ),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL CHECK (
    workflow_version >= 1 AND workflow_version <= 9007199254740991
  ),
  acceptance_decision_id TEXT NOT NULL,
  acceptance_decision_digest TEXT NOT NULL,
  input_manifest_digest TEXT NOT NULL
    REFERENCES acceptance_input_manifests(manifest_digest) ON DELETE RESTRICT,
  rejected_candidate_version INTEGER NOT NULL CHECK (
    rejected_candidate_version >= 1 AND
    rejected_candidate_version <= 9007199254740991
  ),
  rejected_candidate_digest TEXT NOT NULL,
  repair_candidate_generation_id TEXT NOT NULL UNIQUE
    REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  repair_candidate_sequence INTEGER NOT NULL CHECK (
    repair_candidate_sequence >= 2 AND
    repair_candidate_sequence <= 9007199254740991
  ),
  repair_candidate_base_digest TEXT NOT NULL,
  freeze_check_id TEXT NOT NULL,
  freeze_check_version TEXT NOT NULL CHECK (length(trim(freeze_check_version)) > 0),
  verification_check_id TEXT NOT NULL,
  verification_check_version TEXT NOT NULL CHECK (
    length(trim(verification_check_version)) > 0
  ),
  verification_obligation_ids_json TEXT NOT NULL CHECK (
    json_valid(verification_obligation_ids_json) AND
    json_type(verification_obligation_ids_json) = 'array' AND
    json_array_length(verification_obligation_ids_json) > 0
  ),
  evidence_set_digest TEXT NOT NULL REFERENCES evidence_sets(digest) ON DELETE RESTRICT,
  policy_bundle_id TEXT NOT NULL REFERENCES policy_bundles(id) ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  repaired_at TEXT NOT NULL,
  repair_digest TEXT NOT NULL UNIQUE,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (acceptance_decision_id, acceptance_decision_digest)
    REFERENCES acceptance_decisions(id, decision_digest) ON DELETE RESTRICT,
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT,
  FOREIGN KEY (freeze_check_id, freeze_check_version)
    REFERENCES check_specifications(id, version) ON DELETE RESTRICT,
  FOREIGN KEY (verification_check_id, verification_check_version)
    REFERENCES check_specifications(id, version) ON DELETE RESTRICT,
  CHECK (rejected_candidate_generation_id <> repair_candidate_generation_id),
  CHECK (freeze_check_id <> verification_check_id),
  CHECK (
    length(acceptance_decision_digest) = 71 AND
    substr(acceptance_decision_digest, 1, 7) = 'sha256:'
  ),
  CHECK (length(input_manifest_digest) = 71 AND substr(input_manifest_digest, 1, 7) = 'sha256:'),
  CHECK (
    length(rejected_candidate_digest) = 71 AND
    substr(rejected_candidate_digest, 1, 7) = 'sha256:'
  ),
  CHECK (
    length(repair_candidate_base_digest) = 71 AND
    substr(repair_candidate_base_digest, 1, 7) = 'sha256:' AND
    repair_candidate_base_digest = rejected_candidate_digest
  ),
  CHECK (length(evidence_set_digest) = 71 AND substr(evidence_set_digest, 1, 7) = 'sha256:'),
  CHECK (length(policy_bundle_digest) = 71 AND substr(policy_bundle_digest, 1, 7) = 'sha256:'),
  CHECK (length(repair_digest) = 71 AND substr(repair_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE INDEX acceptance_repairs_workflow_version_idx
  ON acceptance_repairs(workflow_id, workflow_version, rejected_candidate_generation_id);

CREATE TRIGGER acceptance_repairs_insert_guard
BEFORE INSERT ON acceptance_repairs
WHEN COALESCE(
  length(NEW.repaired_at) = 24
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.repaired_at) = NEW.repaired_at
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.verification_obligation_ids_json)
    WHERE type <> 'text'
  )
  AND (
    SELECT COUNT(*) FROM json_each(NEW.verification_obligation_ids_json)
  ) = (
    SELECT COUNT(DISTINCT value) FROM json_each(NEW.verification_obligation_ids_json)
  )
  AND EXISTS (
    SELECT 1
    FROM workflows AS workflow
    JOIN goals AS goal ON goal.id = workflow.goal_id
    JOIN acceptance_decisions AS decision ON decision.id = NEW.acceptance_decision_id
    JOIN acceptance_input_manifests AS manifest
      ON manifest.manifest_digest = NEW.input_manifest_digest
    JOIN candidate_generations AS rejected
      ON rejected.id = NEW.rejected_candidate_generation_id
    JOIN candidate_generations AS repair
      ON repair.id = NEW.repair_candidate_generation_id
    JOIN candidates AS candidate ON candidate.id = rejected.candidate_id
    JOIN check_specifications AS freeze_check ON freeze_check.id = NEW.freeze_check_id
    JOIN check_specifications AS verification_check
      ON verification_check.id = NEW.verification_check_id
    WHERE workflow.id = NEW.workflow_id
      AND workflow.goal_id = NEW.goal_id
      AND workflow.goal_revision = NEW.goal_revision
      AND workflow.version = NEW.workflow_version
      AND workflow.phase = 'IMPLEMENT'
      AND workflow.run_status = 'READY'
      AND workflow.active_candidate_generation_id = NEW.repair_candidate_generation_id
      AND workflow.updated_at = NEW.repaired_at
      AND goal.revision = NEW.goal_revision
      AND goal.status = 'ACTIVE'
      AND decision.decision_digest = NEW.acceptance_decision_digest
      AND decision.outcome = 'REJECT_REPAIRABLE'
      AND decision.issued_at <= NEW.repaired_at
      AND decision.input_manifest_digest = NEW.input_manifest_digest
      AND decision.policy_bundle_digest = NEW.policy_bundle_digest
      AND manifest.goal_id = NEW.goal_id
      AND manifest.goal_revision = NEW.goal_revision
      AND manifest.workflow_id = NEW.workflow_id
      AND manifest.workflow_version + 1 = NEW.workflow_version
      AND manifest.candidate_generation_id = NEW.rejected_candidate_generation_id
      AND manifest.candidate_digest = NEW.rejected_candidate_digest
      AND manifest.evidence_set_digest = NEW.evidence_set_digest
      AND manifest.policy_bundle_id = NEW.policy_bundle_id
      AND manifest.policy_bundle_digest = NEW.policy_bundle_digest
      AND candidate.goal_id = NEW.goal_id
      AND rejected.workflow_id = NEW.workflow_id
      AND rejected.state = 'REJECTED'
      AND rejected.version = NEW.rejected_candidate_version
      AND rejected.frozen_digest = NEW.rejected_candidate_digest
      AND rejected.updated_at = NEW.repaired_at
      AND repair.candidate_id = rejected.candidate_id
      AND repair.workflow_id = NEW.workflow_id
      AND repair.parent_generation_id = rejected.id
      AND repair.sequence = NEW.repair_candidate_sequence
      AND repair.sequence = rejected.sequence + 1
      AND repair.state = 'MUTABLE'
      AND repair.version = 1
      AND repair.base_digest = NEW.repair_candidate_base_digest
      AND repair.created_at = NEW.repaired_at
      AND repair.updated_at = NEW.repaired_at
      AND freeze_check.version = NEW.freeze_check_version
      AND json_extract(freeze_check.canonical_json, '$.kind') = 'CANDIDATE_FREEZE'
      AND json_extract(freeze_check.canonical_json, '$.inputRefs[0]') = repair.id
      AND verification_check.version = NEW.verification_check_version
      AND json_extract(verification_check.canonical_json, '$.kind') = 'FAKE_VERIFICATION'
      AND json_extract(verification_check.canonical_json, '$.inputRefs[0]') = repair.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.verification_obligation_ids_json) AS expected
    WHERE NOT EXISTS (
      SELECT 1 FROM verification_obligations AS obligation
      WHERE obligation.id = expected.value
        AND obligation.goal_id = NEW.goal_id
        AND obligation.goal_revision = NEW.goal_revision
        AND obligation.candidate_generation_id = NEW.repair_candidate_generation_id
        AND obligation.check_spec_ref =
          NEW.verification_check_id || '@' || NEW.verification_check_version
        AND obligation.created_at = NEW.repaired_at
    )
  )
  AND (
    SELECT COUNT(*) FROM verification_obligations
    WHERE candidate_generation_id = NEW.repair_candidate_generation_id
  ) = json_array_length(NEW.verification_obligation_ids_json)
  AND EXISTS (
    SELECT 1 FROM audit_events AS repair_audit
    WHERE repair_audit.aggregate_type = 'ACCEPTANCE_REPAIR'
      AND repair_audit.aggregate_id = NEW.rejected_candidate_generation_id
      AND repair_audit.event_type = 'ACCEPTANCE_REPAIR_RECORDED'
      AND repair_audit.actor_type = 'RUNTIME'
      AND repair_audit.command_id IS NOT NULL
      AND repair_audit.payload_digest = NEW.repair_digest
      AND repair_audit.occurred_at = NEW.repaired_at
      AND EXISTS (
        SELECT 1 FROM audit_events AS rejected_audit
        WHERE rejected_audit.aggregate_type = 'CANDIDATE_GENERATION'
          AND rejected_audit.aggregate_id = NEW.rejected_candidate_generation_id
          AND rejected_audit.event_type = 'CANDIDATE_STATE_CHANGED'
          AND rejected_audit.actor_type = 'RUNTIME'
          AND rejected_audit.command_id = repair_audit.command_id
          AND rejected_audit.before_version = NEW.rejected_candidate_version - 1
          AND rejected_audit.after_version = NEW.rejected_candidate_version
          AND rejected_audit.payload_digest = NEW.repair_digest
          AND rejected_audit.occurred_at = NEW.repaired_at
          AND rejected_audit.correlation_id IS repair_audit.correlation_id
          AND rejected_audit.causation_id IS repair_audit.causation_id
      )
      AND EXISTS (
        SELECT 1 FROM audit_events AS generation_audit
        WHERE generation_audit.aggregate_type = 'CANDIDATE_GENERATION'
          AND generation_audit.aggregate_id = NEW.repair_candidate_generation_id
          AND generation_audit.event_type = 'CANDIDATE_GENERATION_CREATED'
          AND generation_audit.actor_type = 'RUNTIME'
          AND generation_audit.command_id = repair_audit.command_id
          AND generation_audit.before_version IS NULL
          AND generation_audit.after_version = 1
          AND generation_audit.payload_digest = NEW.repair_digest
          AND generation_audit.occurred_at = NEW.repaired_at
          AND generation_audit.correlation_id IS repair_audit.correlation_id
          AND generation_audit.causation_id IS repair_audit.causation_id
      )
      AND EXISTS (
        SELECT 1 FROM audit_events AS workflow_audit
        WHERE workflow_audit.aggregate_type = 'WORKFLOW'
          AND workflow_audit.aggregate_id = NEW.workflow_id
          AND workflow_audit.event_type = 'WORKFLOW_PHASE_TRANSITIONED'
          AND workflow_audit.actor_type = 'RUNTIME'
          AND workflow_audit.command_id = repair_audit.command_id
          AND workflow_audit.before_version = NEW.workflow_version - 1
          AND workflow_audit.after_version = NEW.workflow_version
          AND workflow_audit.payload_digest = NEW.repair_digest
          AND workflow_audit.occurred_at = NEW.repaired_at
          AND workflow_audit.correlation_id IS repair_audit.correlation_id
          AND workflow_audit.causation_id IS repair_audit.causation_id
      )
      AND EXISTS (
        SELECT 1 FROM audit_events AS freeze_audit
        WHERE freeze_audit.aggregate_type = 'CHECK_SPECIFICATION'
          AND freeze_audit.aggregate_id = NEW.freeze_check_id
          AND freeze_audit.event_type = 'CHECK_SPECIFICATION_RECORDED'
          AND freeze_audit.actor_type = 'RUNTIME'
          AND freeze_audit.command_id = repair_audit.command_id
          AND freeze_audit.payload_digest = NEW.repair_digest
          AND freeze_audit.occurred_at = NEW.repaired_at
          AND freeze_audit.correlation_id IS repair_audit.correlation_id
          AND freeze_audit.causation_id IS repair_audit.causation_id
      )
      AND EXISTS (
        SELECT 1 FROM audit_events AS verification_audit
        WHERE verification_audit.aggregate_type = 'CHECK_SPECIFICATION'
          AND verification_audit.aggregate_id = NEW.verification_check_id
          AND verification_audit.event_type = 'CHECK_SPECIFICATION_RECORDED'
          AND verification_audit.actor_type = 'RUNTIME'
          AND verification_audit.command_id = repair_audit.command_id
          AND verification_audit.payload_digest = NEW.repair_digest
          AND verification_audit.occurred_at = NEW.repaired_at
          AND verification_audit.correlation_id IS repair_audit.correlation_id
          AND verification_audit.causation_id IS repair_audit.causation_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.verification_obligation_ids_json) AS expected_audit
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_events AS obligation_audit
          WHERE obligation_audit.aggregate_type = 'VERIFICATION_OBLIGATION'
            AND obligation_audit.aggregate_id = expected_audit.value
            AND obligation_audit.event_type = 'VERIFICATION_OBLIGATION_RECORDED'
            AND obligation_audit.actor_type = 'RUNTIME'
            AND obligation_audit.command_id = repair_audit.command_id
            AND obligation_audit.payload_digest = NEW.repair_digest
            AND obligation_audit.occurred_at = NEW.repaired_at
            AND obligation_audit.correlation_id IS repair_audit.correlation_id
            AND obligation_audit.causation_id IS repair_audit.causation_id
        )
      )
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Acceptance repair');
END;

CREATE TRIGGER acceptance_repairs_no_update
BEFORE UPDATE ON acceptance_repairs
BEGIN
  SELECT RAISE(ABORT, 'Acceptance repairs are immutable');
END;

CREATE TRIGGER acceptance_repairs_no_delete
BEFORE DELETE ON acceptance_repairs
BEGIN
  SELECT RAISE(ABORT, 'Acceptance repairs cannot be deleted');
END;
