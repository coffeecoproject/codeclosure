-- Recovery reconciliation reason codes are persisted authority. Preserve the
-- accepted 0016 migration and rebuild only this immutable table so an existing
-- database can record the fail-closed local-verification continuity barrier.

DROP TRIGGER recovery_reconciliations_insert_authority_guard;
DROP TRIGGER recovery_reconciliations_no_update;
DROP TRIGGER recovery_reconciliations_no_delete;
DROP TRIGGER recovery_reconciliations_workflow_policy_binding_guard;
DROP INDEX recovery_reconciliations_workflow_idx;

ALTER TABLE recovery_reconciliations
  RENAME TO recovery_reconciliations_before_local_verification_barrier;

CREATE TABLE recovery_reconciliations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (
    goal_revision >= 1 AND goal_revision <= 9007199254740991
  ),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  phase TEXT NOT NULL CHECK (
    phase IN (
      'DISCOVERY',
      'PLAN',
      'IMPLEMENT',
      'SOURCE_FREEZE',
      'EVIDENCE_BUILD',
      'FINAL_VERIFY',
      'CLOSEOUT'
    )
  ),
  inspected_workflow_version INTEGER NOT NULL CHECK (
    inspected_workflow_version >= 1 AND
    inspected_workflow_version <= 9007199254740990
  ),
  resulting_workflow_version INTEGER NOT NULL CHECK (
    resulting_workflow_version = inspected_workflow_version + 1
  ),
  source_attempt_id TEXT REFERENCES attempts(id) ON DELETE RESTRICT,
  dispatch_claim_digest TEXT,
  last_audit_sequence INTEGER NOT NULL REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  expected_project_identity TEXT NOT NULL CHECK (
    length(trim(expected_project_identity)) > 0
  ),
  observed_project_identity TEXT CHECK (
    observed_project_identity IS NULL OR length(trim(observed_project_identity)) > 0
  ),
  candidate_generation_id TEXT REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  candidate_base_identity TEXT,
  expected_candidate_digest TEXT,
  observed_candidate_digest TEXT,
  execution_profile_id TEXT NOT NULL REFERENCES execution_profiles(id) ON DELETE RESTRICT,
  execution_profile_digest TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('STARTUP', 'RESUME')),
  disposition TEXT NOT NULL CHECK (
    disposition IN ('SAFE_SAME_PHASE', 'SAFE_EARLIER_PHASE', 'BLOCKED')
  ),
  safe_resume_phase TEXT CHECK (
    safe_resume_phase IS NULL OR safe_resume_phase IN (
      'DISCOVERY',
      'PLAN',
      'IMPLEMENT',
      'SOURCE_FREEZE',
      'EVIDENCE_BUILD',
      'FINAL_VERIFY'
    )
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
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
      'UNSUPPORTED_RECOVERY_PHASE'
    )
  ),
  observation_refs_json TEXT NOT NULL CHECK (
    json_valid(observation_refs_json) AND
    json_type(observation_refs_json) = 'array' AND
    json_array_length(observation_refs_json) > 0
  ),
  inspector_version TEXT NOT NULL CHECK (length(trim(inspector_version)) > 0),
  recovery_policy_version TEXT NOT NULL CHECK (length(trim(recovery_policy_version)) > 0),
  inspected_at TEXT NOT NULL,
  reconciliation_digest TEXT NOT NULL UNIQUE,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (execution_profile_id, execution_profile_digest)
    REFERENCES execution_profiles(id, profile_digest) ON DELETE RESTRICT,
  CHECK (
    source_attempt_id IS NOT NULL
  ),
  CHECK (
    length(id) BETWEEN 10 AND 137 AND
    substr(id, 1, 9) = 'recovery_' AND
    substr(id, 10) NOT GLOB '*[^a-z0-9-]*' AND
    substr(id, 10, 1) GLOB '[a-z0-9]' AND
    substr(id, -1, 1) GLOB '[a-z0-9]'
  ),
  CHECK (
    dispatch_claim_digest IS NULL OR (
      length(dispatch_claim_digest) = 71 AND
      substr(dispatch_claim_digest, 1, 7) = 'sha256:' AND
      substr(dispatch_claim_digest, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    (candidate_generation_id IS NULL AND candidate_base_identity IS NULL AND
      expected_candidate_digest IS NULL AND observed_candidate_digest IS NULL)
    OR
    (candidate_generation_id IS NOT NULL AND
      candidate_base_identity IS NOT NULL AND
      length(trim(candidate_base_identity)) > 0 AND
      expected_candidate_digest IS NOT NULL)
  ),
  CHECK (
    expected_candidate_digest IS NULL OR (
      length(expected_candidate_digest) = 71 AND
      substr(expected_candidate_digest, 1, 7) = 'sha256:' AND
      substr(expected_candidate_digest, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    observed_candidate_digest IS NULL OR (
      length(observed_candidate_digest) = 71 AND
      substr(observed_candidate_digest, 1, 7) = 'sha256:' AND
      substr(observed_candidate_digest, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    length(execution_profile_digest) = 71 AND
    substr(execution_profile_digest, 1, 7) = 'sha256:' AND
    substr(execution_profile_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(reconciliation_digest) = 71 AND
    substr(reconciliation_digest, 1, 7) = 'sha256:' AND
    substr(reconciliation_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    length(inspected_at) = 24 AND
    inspected_at GLOB '????-??-??T??:??:??.???Z' AND
    strftime('%Y-%m-%dT%H:%M:%fZ', inspected_at) = inspected_at
  ),
  CHECK (
    (disposition = 'BLOCKED' AND safe_resume_phase IS NULL AND
      reason_code <> 'EXACT_AUTHORITY_MATCH')
    OR
    (disposition = 'SAFE_SAME_PHASE' AND safe_resume_phase = phase AND
      reason_code = 'EXACT_AUTHORITY_MATCH')
    OR
    (disposition = 'SAFE_EARLIER_PHASE' AND safe_resume_phase IS NOT NULL AND
      CASE safe_resume_phase
        WHEN 'DISCOVERY' THEN 1
        WHEN 'PLAN' THEN 2
        WHEN 'IMPLEMENT' THEN 3
        WHEN 'SOURCE_FREEZE' THEN 4
        WHEN 'EVIDENCE_BUILD' THEN 5
        WHEN 'FINAL_VERIFY' THEN 6
      END < CASE phase
        WHEN 'DISCOVERY' THEN 1
        WHEN 'PLAN' THEN 2
        WHEN 'IMPLEMENT' THEN 3
        WHEN 'SOURCE_FREEZE' THEN 4
        WHEN 'EVIDENCE_BUILD' THEN 5
        WHEN 'FINAL_VERIFY' THEN 6
        WHEN 'CLOSEOUT' THEN 7
      END AND reason_code = 'EXACT_AUTHORITY_MATCH')
  ),
  CHECK (
    disposition = 'BLOCKED'
    OR (
      observed_project_identity = expected_project_identity AND
      (
        expected_candidate_digest IS NULL OR
        observed_candidate_digest = expected_candidate_digest
      )
    )
  )
) STRICT;

INSERT INTO recovery_reconciliations (
  id,
  schema_version,
  goal_id,
  goal_revision,
  workflow_id,
  phase,
  inspected_workflow_version,
  resulting_workflow_version,
  source_attempt_id,
  dispatch_claim_digest,
  last_audit_sequence,
  expected_project_identity,
  observed_project_identity,
  candidate_generation_id,
  candidate_base_identity,
  expected_candidate_digest,
  observed_candidate_digest,
  execution_profile_id,
  execution_profile_digest,
  purpose,
  disposition,
  safe_resume_phase,
  reason_code,
  observation_refs_json,
  inspector_version,
  recovery_policy_version,
  inspected_at,
  reconciliation_digest
)
SELECT
  id,
  schema_version,
  goal_id,
  goal_revision,
  workflow_id,
  phase,
  inspected_workflow_version,
  resulting_workflow_version,
  source_attempt_id,
  dispatch_claim_digest,
  last_audit_sequence,
  expected_project_identity,
  observed_project_identity,
  candidate_generation_id,
  candidate_base_identity,
  expected_candidate_digest,
  observed_candidate_digest,
  execution_profile_id,
  execution_profile_digest,
  purpose,
  disposition,
  safe_resume_phase,
  reason_code,
  observation_refs_json,
  inspector_version,
  recovery_policy_version,
  inspected_at,
  reconciliation_digest
FROM recovery_reconciliations_before_local_verification_barrier;

DROP TABLE recovery_reconciliations_before_local_verification_barrier;

CREATE INDEX recovery_reconciliations_workflow_idx
  ON recovery_reconciliations(workflow_id, resulting_workflow_version DESC, id);

CREATE TRIGGER recovery_reconciliations_insert_authority_guard
BEFORE INSERT ON recovery_reconciliations
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM workflows AS workflow
        JOIN goals AS goal ON goal.id = workflow.goal_id
        JOIN workflow_execution_profile_bindings AS binding
          ON binding.workflow_id = workflow.id
       WHERE workflow.id = NEW.workflow_id
         AND workflow.goal_id = NEW.goal_id
         AND workflow.goal_revision = NEW.goal_revision
         AND workflow.phase = NEW.phase
         AND workflow.version = NEW.inspected_workflow_version
         AND goal.revision = NEW.goal_revision
         AND binding.goal_id = NEW.goal_id
         AND binding.profile_id = NEW.execution_profile_id
         AND binding.profile_digest = NEW.execution_profile_digest
         AND NEW.inspected_at >= workflow.updated_at
    )
    THEN RAISE(ABORT, 'Recovery reconciliation does not match current Workflow authority')
  END;

  SELECT CASE
    WHEN NEW.source_attempt_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM attempts AS attempt
       WHERE attempt.id = NEW.source_attempt_id
         AND attempt.workflow_id = NEW.workflow_id
         AND attempt.phase = NEW.phase
    )
    THEN RAISE(ABORT, 'Recovery source Attempt belongs to another Workflow authority')
  END;

  SELECT CASE
    WHEN NOT (
      (
        NEW.candidate_generation_id IS NULL AND
        NOT EXISTS (
          SELECT 1
            FROM workflows AS workflow
           WHERE workflow.id = NEW.workflow_id
             AND workflow.active_candidate_generation_id IS NOT NULL
        )
      )
      OR EXISTS (
        SELECT 1
          FROM workflows AS workflow
          JOIN candidate_generations AS generation
            ON generation.id = workflow.active_candidate_generation_id
          JOIN candidates AS candidate ON candidate.id = generation.candidate_id
         WHERE workflow.id = NEW.workflow_id
           AND generation.id = NEW.candidate_generation_id
           AND candidate.goal_id = NEW.goal_id
           AND candidate.base_project_identity = NEW.candidate_base_identity
           AND NEW.expected_candidate_digest =
             COALESCE(generation.frozen_digest, generation.base_digest)
      )
    )
    THEN RAISE(ABORT, 'Recovery Candidate does not match current Workflow authority')
  END;

  SELECT CASE
    WHEN NEW.candidate_generation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM candidate_generations AS generation
        JOIN candidates AS candidate ON candidate.id = generation.candidate_id
       WHERE generation.id = NEW.candidate_generation_id
         AND generation.workflow_id = NEW.workflow_id
         AND candidate.goal_id = NEW.goal_id
         AND candidate.base_project_identity = NEW.candidate_base_identity
    )
    THEN RAISE(ABORT, 'Recovery Candidate belongs to another Workflow authority')
  END;

  SELECT CASE
    WHEN NEW.last_audit_sequence <> (SELECT COALESCE(MAX(sequence), 0) FROM audit_events)
    THEN RAISE(ABORT, 'Recovery reconciliation Audit watermark is stale')
  END;

  SELECT CASE
    WHEN NEW.purpose = 'STARTUP' AND NOT EXISTS (
      SELECT 1
        FROM workflows AS workflow
        JOIN attempts AS attempt ON attempt.id = workflow.active_attempt_id
       WHERE workflow.id = NEW.workflow_id
         AND workflow.run_status = 'RUNNING'
         AND attempt.id = NEW.source_attempt_id
         AND attempt.status = 'RUNNING'
         AND NEW.inspected_at >= attempt.started_at
    )
    THEN RAISE(ABORT, 'Startup recovery requires the exact active RUNNING Attempt')
  END;

  SELECT CASE
    WHEN NEW.purpose = 'RESUME' AND NOT EXISTS (
      SELECT 1
        FROM workflows AS workflow
       WHERE workflow.id = NEW.workflow_id
         AND workflow.run_status = 'BLOCKED'
         AND workflow.active_attempt_id IS NULL
         AND EXISTS (
           SELECT 1
             FROM attempts AS attempt
            WHERE attempt.id = NEW.source_attempt_id
              AND attempt.workflow_id = workflow.id
              AND attempt.status <> 'RUNNING'
              AND attempt.ended_at <= NEW.inspected_at
         )
    )
    THEN RAISE(ABORT, 'Resume recovery requires a blocked quiescent Workflow')
  END;
END;

CREATE TRIGGER recovery_reconciliations_no_update
BEFORE UPDATE ON recovery_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'Recovery reconciliations are immutable');
END;

CREATE TRIGGER recovery_reconciliations_no_delete
BEFORE DELETE ON recovery_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'Recovery reconciliations are immutable');
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
