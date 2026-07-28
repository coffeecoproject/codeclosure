CREATE TABLE acceptance_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

-- The initial schema reserved these names before any Runtime path owned them.
-- Retaining such rows would bless caller-authored placeholder authority.
INSERT INTO acceptance_migration_guard(valid)
SELECT 0
WHERE EXISTS (SELECT 1 FROM pending_issues)
   OR EXISTS (SELECT 1 FROM acceptance_input_manifests)
   OR EXISTS (SELECT 1 FROM acceptance_decisions)
   OR EXISTS (
     SELECT 1 FROM candidate_generations
     WHERE state IN ('REJECTED', 'ACCEPTED')
   )
   OR EXISTS (
     SELECT 1 FROM workflows
     WHERE phase = 'CLOSEOUT' OR run_status = 'CLOSED'
   )
   OR EXISTS (SELECT 1 FROM goals WHERE status = 'CLOSED');

DROP TABLE acceptance_migration_guard;

DROP TRIGGER IF EXISTS acceptance_decisions_no_delete;
DROP TRIGGER IF EXISTS acceptance_decisions_no_update;
DROP TRIGGER IF EXISTS acceptance_input_manifests_no_delete;
DROP TRIGGER IF EXISTS acceptance_input_manifests_no_update;

DROP TABLE acceptance_decisions;
DROP TABLE acceptance_input_manifests;
DROP TABLE pending_issues;

CREATE TABLE pending_issues (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (
    goal_revision >= 1 AND goal_revision <= 9007199254740991
  ),
  candidate_generation_id TEXT REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  classification TEXT NOT NULL CHECK (
    classification IN (
      'TECHNICAL_FINDING', 'SCOPE_CONFLICT', 'EXTERNAL_DEPENDENCY', 'DECISION_REQUIRED'
    )
  ),
  severity TEXT NOT NULL CHECK (severity IN ('BLOCKING', 'NON_BLOCKING')),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),
  repairability TEXT NOT NULL CHECK (
    repairability IN ('REPAIRABLE', 'BLOCKED', 'NEEDS_DECISION')
  ),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  CHECK (
    (status = 'OPEN' AND resolved_at IS NULL) OR
    (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_at >= created_at)
  ),
  CHECK (
    (classification = 'DECISION_REQUIRED' AND repairability = 'NEEDS_DECISION') OR
    (classification <> 'DECISION_REQUIRED' AND repairability <> 'NEEDS_DECISION')
  )
) STRICT;

CREATE TABLE acceptance_input_manifests (
  manifest_digest TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (
    goal_revision >= 1 AND goal_revision <= 9007199254740991
  ),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL CHECK (
    workflow_version >= 1 AND workflow_version <= 9007199254740991
  ),
  phase TEXT NOT NULL CHECK (phase = 'FINAL_VERIFY'),
  fact_snapshot_digest TEXT NOT NULL,
  decision_set_digest TEXT NOT NULL,
  scenario_set_digest TEXT NOT NULL,
  candidate_generation_id TEXT NOT NULL REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  candidate_digest TEXT NOT NULL,
  evidence_set_digest TEXT NOT NULL REFERENCES evidence_sets(digest) ON DELETE RESTRICT,
  pending_issue_set_digest TEXT NOT NULL,
  policy_bundle_id TEXT NOT NULL REFERENCES policy_bundles(id) ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (manifest_digest, policy_bundle_digest),
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT,
  CHECK (length(manifest_digest) = 71 AND substr(manifest_digest, 1, 7) = 'sha256:'),
  CHECK (length(fact_snapshot_digest) = 71 AND substr(fact_snapshot_digest, 1, 7) = 'sha256:'),
  CHECK (length(decision_set_digest) = 71 AND substr(decision_set_digest, 1, 7) = 'sha256:'),
  CHECK (length(scenario_set_digest) = 71 AND substr(scenario_set_digest, 1, 7) = 'sha256:'),
  CHECK (length(candidate_digest) = 71 AND substr(candidate_digest, 1, 7) = 'sha256:'),
  CHECK (length(evidence_set_digest) = 71 AND substr(evidence_set_digest, 1, 7) = 'sha256:'),
  CHECK (length(pending_issue_set_digest) = 71 AND substr(pending_issue_set_digest, 1, 7) = 'sha256:'),
  CHECK (length(policy_bundle_digest) = 71 AND substr(policy_bundle_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE TABLE acceptance_decisions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  input_manifest_digest TEXT NOT NULL REFERENCES acceptance_input_manifests(manifest_digest)
    ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('ACCEPT', 'REJECT_REPAIRABLE', 'REJECT_BLOCKED', 'NEEDS_DECISION', 'ENGINE_ERROR')
  ),
  dominant_reason_code TEXT NOT NULL CHECK (length(trim(dominant_reason_code)) > 0),
  rule_results_json TEXT NOT NULL CHECK (json_valid(rule_results_json)),
  engine_version TEXT NOT NULL CHECK (length(trim(engine_version)) > 0),
  issued_at TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  UNIQUE (id, decision_digest),
  FOREIGN KEY (input_manifest_digest, policy_bundle_digest)
    REFERENCES acceptance_input_manifests(manifest_digest, policy_bundle_digest)
    ON DELETE RESTRICT,
  CHECK (length(decision_digest) = 71 AND substr(decision_digest, 1, 7) = 'sha256:'),
  CHECK (length(policy_bundle_digest) = 71 AND substr(policy_bundle_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE TABLE workflow_closeouts (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL UNIQUE REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (
    goal_revision >= 1 AND goal_revision <= 9007199254740991
  ),
  workflow_version INTEGER NOT NULL CHECK (
    workflow_version >= 1 AND workflow_version <= 9007199254740991
  ),
  acceptance_decision_id TEXT NOT NULL,
  acceptance_decision_digest TEXT NOT NULL,
  input_manifest_digest TEXT NOT NULL REFERENCES acceptance_input_manifests(manifest_digest)
    ON DELETE RESTRICT,
  candidate_generation_id TEXT NOT NULL REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  candidate_digest TEXT NOT NULL,
  evidence_set_digest TEXT NOT NULL REFERENCES evidence_sets(digest) ON DELETE RESTRICT,
  policy_bundle_id TEXT NOT NULL REFERENCES policy_bundles(id) ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (acceptance_decision_id, acceptance_decision_digest)
    REFERENCES acceptance_decisions(id, decision_digest) ON DELETE RESTRICT,
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT,
  CHECK (
    length(acceptance_decision_digest) = 71 AND
    substr(acceptance_decision_digest, 1, 7) = 'sha256:'
  ),
  CHECK (length(input_manifest_digest) = 71 AND substr(input_manifest_digest, 1, 7) = 'sha256:'),
  CHECK (length(candidate_digest) = 71 AND substr(candidate_digest, 1, 7) = 'sha256:'),
  CHECK (length(evidence_set_digest) = 71 AND substr(evidence_set_digest, 1, 7) = 'sha256:'),
  CHECK (length(policy_bundle_digest) = 71 AND substr(policy_bundle_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE INDEX pending_issues_goal_revision_status_idx
  ON pending_issues(goal_id, goal_revision, status, id);
CREATE INDEX acceptance_manifests_workflow_version_idx
  ON acceptance_input_manifests(workflow_id, workflow_version, manifest_digest);
CREATE INDEX acceptance_decisions_manifest_idx
  ON acceptance_decisions(input_manifest_digest, engine_version, id);

CREATE TRIGGER pending_issues_insert_guard
BEFORE INSERT ON pending_issues
WHEN COALESCE(
  length(NEW.id) BETWEEN 7 AND 134
  AND substr(NEW.id, 1, 6) = 'issue_'
  AND substr(NEW.id, 7) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 7, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND length(NEW.created_at) = 24
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) = NEW.created_at
  AND (NEW.resolved_at IS NULL OR (
    length(NEW.resolved_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.resolved_at) = NEW.resolved_at
  ))
  AND json_type(NEW.source_refs_json) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.source_refs_json)
    WHERE type <> 'text' OR length(trim(value)) = 0
  )
  AND (SELECT COUNT(*) FROM json_each(NEW.source_refs_json)) =
      (SELECT COUNT(DISTINCT value) FROM json_each(NEW.source_refs_json))
  AND (
    NEW.candidate_generation_id IS NULL OR EXISTS (
      SELECT 1
      FROM candidate_generations AS generation
      JOIN candidates AS candidate ON candidate.id = generation.candidate_id
      WHERE generation.id = NEW.candidate_generation_id
        AND candidate.goal_id = NEW.goal_id
    )
  )
  AND EXISTS (
    SELECT 1 FROM audit_events
    WHERE aggregate_type = 'PENDING_ISSUE'
      AND aggregate_id = NEW.id
      AND event_type = 'PENDING_ISSUE_RECORDED'
      AND actor_type = 'RUNTIME'
      AND occurred_at = NEW.created_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Pending Issue');
END;

CREATE TRIGGER pending_issues_update_guard
BEFORE UPDATE ON pending_issues
WHEN COALESCE(
  NEW.id = OLD.id
  AND NEW.goal_id = OLD.goal_id
  AND NEW.goal_revision = OLD.goal_revision
  AND NEW.candidate_generation_id IS OLD.candidate_generation_id
  AND NEW.classification = OLD.classification
  AND NEW.severity = OLD.severity
  AND NEW.description = OLD.description
  AND NEW.source_refs_json = OLD.source_refs_json
  AND NEW.repairability = OLD.repairability
  AND OLD.status = 'OPEN'
  AND NEW.status = 'RESOLVED'
  AND OLD.resolved_at IS NULL
  AND NEW.resolved_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM audit_events
    WHERE aggregate_type = 'PENDING_ISSUE'
      AND aggregate_id = NEW.id
      AND event_type = 'PENDING_ISSUE_RESOLVED'
      AND actor_type = 'RUNTIME'
      AND occurred_at = NEW.resolved_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'Pending Issue resolution lacks exact authority');
END;

CREATE TRIGGER pending_issues_no_delete
BEFORE DELETE ON pending_issues
BEGIN
  SELECT RAISE(ABORT, 'Pending Issues cannot be deleted');
END;

CREATE TRIGGER acceptance_input_manifests_insert_guard
BEFORE INSERT ON acceptance_input_manifests
WHEN COALESCE(
  length(NEW.created_at) = 24
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) = NEW.created_at
  AND EXISTS (
    SELECT 1
    FROM workflows AS workflow
    JOIN goals AS goal ON goal.id = workflow.goal_id
    JOIN candidate_generations AS generation
      ON generation.id = NEW.candidate_generation_id
    JOIN candidates AS candidate ON candidate.id = generation.candidate_id
    JOIN evidence_sets AS evidence_set ON evidence_set.digest = NEW.evidence_set_digest
    JOIN policy_bundles AS policy
      ON policy.id = NEW.policy_bundle_id
     AND policy.bundle_digest = NEW.policy_bundle_digest
    WHERE workflow.id = NEW.workflow_id
      AND workflow.goal_id = NEW.goal_id
      AND workflow.goal_revision = NEW.goal_revision
      AND workflow.version = NEW.workflow_version
      AND workflow.phase = 'FINAL_VERIFY'
      AND workflow.run_status = 'READY'
      AND workflow.active_candidate_generation_id = NEW.candidate_generation_id
      AND workflow.updated_at <= NEW.created_at
      AND goal.revision = NEW.goal_revision
      AND candidate.goal_id = NEW.goal_id
      AND generation.workflow_id = NEW.workflow_id
      AND generation.state = 'FROZEN'
      AND generation.frozen_digest = NEW.candidate_digest
      AND generation.updated_at <= NEW.created_at
      AND evidence_set.goal_id = NEW.goal_id
      AND evidence_set.goal_revision = NEW.goal_revision
      AND evidence_set.candidate_generation_id = NEW.candidate_generation_id
      AND evidence_set.candidate_digest = NEW.candidate_digest
      AND policy.installed_at <= NEW.created_at
  )
  AND EXISTS (
    SELECT 1 FROM audit_events
    WHERE aggregate_type = 'ACCEPTANCE_INPUT_MANIFEST'
      AND aggregate_id = NEW.manifest_digest
      AND event_type = 'ACCEPTANCE_INPUT_MANIFEST_RECORDED'
      AND actor_type = 'RUNTIME'
      AND command_id IS NOT NULL
      AND payload_digest = NEW.manifest_digest
      AND occurred_at = NEW.created_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Acceptance Input Manifest');
END;

CREATE TRIGGER acceptance_input_manifests_no_update
BEFORE UPDATE ON acceptance_input_manifests
BEGIN
  SELECT RAISE(ABORT, 'Acceptance Input Manifests are immutable');
END;

CREATE TRIGGER acceptance_input_manifests_no_delete
BEFORE DELETE ON acceptance_input_manifests
BEGIN
  SELECT RAISE(ABORT, 'Acceptance Input Manifests cannot be deleted');
END;

CREATE TRIGGER acceptance_decisions_insert_guard
BEFORE INSERT ON acceptance_decisions
WHEN COALESCE(
  length(NEW.id) BETWEEN 12 AND 139
  AND substr(NEW.id, 1, 11) = 'acceptance_'
  AND substr(NEW.id, 12) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 12, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND length(NEW.issued_at) = 24
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.issued_at) = NEW.issued_at
  AND json_type(NEW.rule_results_json) = 'array'
  AND json_array_length(NEW.rule_results_json) > 0
  AND EXISTS (
    SELECT 1 FROM acceptance_input_manifests AS manifest
    WHERE manifest.manifest_digest = NEW.input_manifest_digest
      AND manifest.policy_bundle_digest = NEW.policy_bundle_digest
      AND NEW.issued_at >= manifest.created_at
  )
  AND EXISTS (
    SELECT 1 FROM audit_events
    WHERE aggregate_type = 'ACCEPTANCE_DECISION'
      AND aggregate_id = NEW.id
      AND event_type = 'ACCEPTANCE_DECISION_ISSUED'
      AND actor_type = 'RUNTIME'
      AND command_id IS NOT NULL
      AND payload_digest = NEW.decision_digest
      AND occurred_at = NEW.issued_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Acceptance Decision');
END;

CREATE TRIGGER acceptance_decisions_no_update
BEFORE UPDATE ON acceptance_decisions
BEGIN
  SELECT RAISE(ABORT, 'Acceptance Decisions are immutable');
END;

CREATE TRIGGER acceptance_decisions_no_delete
BEFORE DELETE ON acceptance_decisions
BEGIN
  SELECT RAISE(ABORT, 'Acceptance Decisions cannot be deleted');
END;

CREATE TRIGGER workflow_closeouts_insert_guard
BEFORE INSERT ON workflow_closeouts
WHEN COALESCE(
  length(NEW.closed_at) = 24
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.closed_at) = NEW.closed_at
  AND EXISTS (
    SELECT 1
    FROM workflows AS workflow
    JOIN goals AS goal ON goal.id = workflow.goal_id
    JOIN candidate_generations AS generation
      ON generation.id = NEW.candidate_generation_id
    JOIN candidates AS candidate ON candidate.id = generation.candidate_id
    JOIN acceptance_decisions AS decision ON decision.id = NEW.acceptance_decision_id
    JOIN acceptance_input_manifests AS manifest
      ON manifest.manifest_digest = NEW.input_manifest_digest
    WHERE workflow.id = NEW.workflow_id
      AND workflow.goal_id = NEW.goal_id
      AND workflow.goal_revision = NEW.goal_revision
      AND workflow.version = NEW.workflow_version
      AND workflow.phase = 'CLOSEOUT'
      AND workflow.run_status = 'CLOSED'
      AND workflow.updated_at = NEW.closed_at
      AND goal.status = 'CLOSED'
      AND goal.updated_at = NEW.closed_at
      AND candidate.goal_id = NEW.goal_id
      AND generation.workflow_id = NEW.workflow_id
      AND generation.state = 'ACCEPTED'
      AND generation.frozen_digest = NEW.candidate_digest
      AND generation.updated_at = NEW.closed_at
      AND decision.decision_digest = NEW.acceptance_decision_digest
      AND decision.outcome = 'ACCEPT'
      AND decision.issued_at <= NEW.closed_at
      AND decision.input_manifest_digest = NEW.input_manifest_digest
      AND manifest.goal_id = NEW.goal_id
      AND manifest.goal_revision = NEW.goal_revision
      AND manifest.workflow_id = NEW.workflow_id
      AND manifest.workflow_version + 1 = NEW.workflow_version
      AND manifest.candidate_generation_id = NEW.candidate_generation_id
      AND manifest.candidate_digest = NEW.candidate_digest
      AND manifest.evidence_set_digest = NEW.evidence_set_digest
      AND manifest.policy_bundle_id = NEW.policy_bundle_id
      AND manifest.policy_bundle_digest = NEW.policy_bundle_digest
  )
  AND EXISTS (
    SELECT 1 FROM audit_events
    WHERE aggregate_type = 'WORKFLOW_CLOSEOUT'
      AND aggregate_id = NEW.workflow_id
      AND event_type = 'WORKFLOW_CLOSEOUT_RECORDED'
      AND actor_type = 'RUNTIME'
      AND command_id IS NOT NULL
      AND occurred_at = NEW.closed_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Workflow closeout');
END;

CREATE TRIGGER workflow_closeouts_no_update
BEFORE UPDATE ON workflow_closeouts
BEGIN
  SELECT RAISE(ABORT, 'Workflow closeouts are immutable');
END;

CREATE TRIGGER workflow_closeouts_no_delete
BEFORE DELETE ON workflow_closeouts
BEGIN
  SELECT RAISE(ABORT, 'Workflow closeouts cannot be deleted');
END;
