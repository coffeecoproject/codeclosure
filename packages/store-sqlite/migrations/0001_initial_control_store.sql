CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  objective TEXT NOT NULL CHECK (length(trim(objective)) > 0),
  project_path TEXT NOT NULL CHECK (length(trim(project_path)) > 0),
  allowed_paths_json TEXT NOT NULL CHECK (json_valid(allowed_paths_json)),
  non_goals_json TEXT NOT NULL CHECK (json_valid(non_goals_json)),
  status TEXT NOT NULL CHECK (
    status IN ('ACTIVE', 'WAITING_FOR_INPUT', 'BLOCKED', 'CANCELLED', 'CLOSED')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, revision)
) STRICT;

CREATE TABLE goal_criteria (
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  id TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  PRIMARY KEY (goal_id, position)
) STRICT;

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL UNIQUE REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (goal_revision >= 1),
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
  run_status TEXT NOT NULL CHECK (
    run_status IN (
      'READY',
      'RUNNING',
      'WAITING_FOR_INPUT',
      'BLOCKED',
      'FAILED',
      'CANCELLED',
      'CLOSED'
    )
  ),
  version INTEGER NOT NULL CHECK (version >= 1),
  active_attempt_id TEXT REFERENCES attempts(id) DEFERRABLE INITIALLY DEFERRED,
  active_candidate_generation_id TEXT REFERENCES candidate_generations(id)
    DEFERRABLE INITIALLY DEFERRED,
  suspended_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, goal_revision),
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  CHECK (
    (phase = 'CLOSEOUT' AND run_status = 'CLOSED') OR
    (phase <> 'CLOSEOUT' AND run_status <> 'CLOSED')
  ),
  CHECK (
    phase NOT IN ('IMPLEMENT', 'SOURCE_FREEZE', 'EVIDENCE_BUILD', 'FINAL_VERIFY', 'CLOSEOUT') OR
    active_candidate_generation_id IS NOT NULL
  )
) STRICT;

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
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
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  context_manifest_id TEXT REFERENCES context_manifests(id) DEFERRABLE INITIALLY DEFERRED,
  capability_grant_json TEXT NOT NULL CHECK (json_valid(capability_grant_json)),
  worker_session_ref TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('RUNNING', 'RESULT_RECORDED', 'FAILED', 'INTERRUPTED')
  ),
  failure_class TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE (workflow_id, sequence)
) STRICT;

CREATE TABLE candidate_generations (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  parent_generation_id TEXT REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  workspace_identity TEXT NOT NULL CHECK (length(trim(workspace_identity)) > 0),
  state TEXT NOT NULL CHECK (
    state IN ('MUTABLE', 'FREEZING', 'FROZEN', 'INVALIDATED', 'REJECTED', 'ACCEPTED')
  ),
  base_digest TEXT NOT NULL,
  frozen_digest TEXT,
  invalidation_reason TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  frozen_at TEXT,
  UNIQUE (candidate_id, sequence),
  CHECK (length(base_digest) = 71 AND substr(base_digest, 1, 7) = 'sha256:'),
  CHECK (
    frozen_digest IS NULL OR
    (length(frozen_digest) = 71 AND substr(frozen_digest, 1, 7) = 'sha256:')
  )
) STRICT;

CREATE TABLE context_manifests (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  compiler_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (goal_revision >= 1),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL CHECK (workflow_version >= 1),
  phase TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE RESTRICT,
  candidate_generation_id TEXT REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  candidate_digest TEXT,
  policy_bundle_id TEXT NOT NULL,
  policy_bundle_digest TEXT NOT NULL,
  capability_grant_digest TEXT NOT NULL,
  response_contract_digest TEXT NOT NULL,
  entries_json TEXT NOT NULL CHECK (json_valid(entries_json)),
  omission_decisions_json TEXT NOT NULL CHECK (json_valid(omission_decisions_json)),
  package_digest TEXT NOT NULL,
  manifest_digest TEXT NOT NULL UNIQUE,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT
) STRICT;

CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  status TEXT NOT NULL CHECK (
    status IN ('CONFIRMED', 'OBSERVED', 'PROPOSED', 'DISPUTED', 'INVALIDATED', 'UNKNOWN')
  ),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  valid_from TEXT NOT NULL,
  invalidated_at TEXT
) STRICT;

CREATE TABLE human_decisions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  question_ref TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  answer_json TEXT NOT NULL CHECK (json_valid(answer_json)),
  decided_at TEXT NOT NULL,
  invalidated_at TEXT
) STRICT;

CREATE TABLE policy_bundles (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  policy_version TEXT NOT NULL,
  checker_identities_json TEXT NOT NULL CHECK (json_valid(checker_identities_json)),
  canonical_content_json TEXT NOT NULL CHECK (json_valid(canonical_content_json)),
  bundle_digest TEXT NOT NULL UNIQUE,
  installed_at TEXT NOT NULL,
  UNIQUE (id, bundle_digest)
) STRICT;

CREATE TABLE verification_obligations (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  source_criterion_refs_json TEXT NOT NULL CHECK (json_valid(source_criterion_refs_json)),
  scenario_refs_json TEXT NOT NULL CHECK (json_valid(scenario_refs_json)),
  check_spec_ref TEXT NOT NULL,
  required_evidence_kind TEXT NOT NULL,
  strength TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE evidence_records (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  kind TEXT NOT NULL,
  producer_type TEXT NOT NULL,
  producer_identity TEXT NOT NULL,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (goal_revision >= 1),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE RESTRICT,
  candidate_generation_id TEXT NOT NULL REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  candidate_digest TEXT NOT NULL,
  fact_snapshot_digest TEXT,
  policy_bundle_digest TEXT NOT NULL,
  check_spec_json TEXT NOT NULL CHECK (json_valid(check_spec_json)),
  environment_identity_json TEXT CHECK (
    environment_identity_json IS NULL OR json_valid(environment_identity_json)
  ),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  observation_json TEXT NOT NULL CHECK (json_valid(observation_json)),
  payload_refs_json TEXT NOT NULL CHECK (json_valid(payload_refs_json)),
  observation_digest TEXT NOT NULL,
  result_status TEXT NOT NULL CHECK (
    result_status IN ('OBSERVED', 'PASS', 'FAIL', 'RUNNER_ERROR', 'TIMEOUT')
  ),
  recorded_at TEXT NOT NULL,
  record_digest TEXT NOT NULL UNIQUE,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT
) STRICT;

CREATE TABLE evidence_eligibility (
  evidence_id TEXT NOT NULL REFERENCES evidence_records(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  state TEXT NOT NULL CHECK (state IN ('ELIGIBLE', 'INELIGIBLE')),
  reason_code TEXT,
  source_ref TEXT,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (evidence_id, version),
  CHECK (state = 'INELIGIBLE' OR (reason_code IS NULL AND source_ref IS NULL))
) STRICT;

CREATE TABLE pending_issues (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  candidate_generation_id TEXT REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  classification TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),
  repairability TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE TABLE acceptance_input_manifests (
  manifest_digest TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (goal_revision >= 1),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL CHECK (workflow_version >= 1),
  phase TEXT NOT NULL CHECK (phase = 'FINAL_VERIFY'),
  fact_snapshot_digest TEXT NOT NULL,
  decision_set_digest TEXT NOT NULL,
  scenario_set_digest TEXT NOT NULL,
  candidate_generation_id TEXT NOT NULL REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  candidate_digest TEXT NOT NULL,
  evidence_set_digest TEXT NOT NULL,
  pending_issue_set_digest TEXT NOT NULL,
  policy_bundle_id TEXT NOT NULL REFERENCES policy_bundles(id) ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (manifest_digest, policy_bundle_digest),
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT
) STRICT;

CREATE TABLE acceptance_decisions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  input_manifest_digest TEXT NOT NULL REFERENCES acceptance_input_manifests(manifest_digest)
    ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('ACCEPT', 'REJECT_REPAIRABLE', 'REJECT_BLOCKED', 'NEEDS_DECISION', 'ENGINE_ERROR')
  ),
  dominant_reason_code TEXT NOT NULL,
  rule_results_json TEXT NOT NULL CHECK (json_valid(rule_results_json)),
  engine_version TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  decision_digest TEXT NOT NULL UNIQUE,
  FOREIGN KEY (input_manifest_digest, policy_bundle_digest)
    REFERENCES acceptance_input_manifests(manifest_digest, policy_bundle_digest)
    ON DELETE RESTRICT
) STRICT;

CREATE TABLE processed_commands (
  command_id TEXT PRIMARY KEY,
  input_digest TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json)),
  completed_at TEXT NOT NULL
) STRICT;

CREATE TABLE audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  command_id TEXT,
  before_version INTEGER,
  after_version INTEGER,
  correlation_id TEXT,
  causation_id TEXT,
  payload_digest TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  CHECK (before_version IS NULL OR before_version >= 1),
  CHECK (after_version IS NULL OR after_version >= 1)
) STRICT;

CREATE INDEX workflows_phase_status_idx ON workflows(phase, run_status);
CREATE INDEX attempts_workflow_status_idx ON attempts(workflow_id, status);
CREATE INDEX candidate_generations_workflow_state_idx
  ON candidate_generations(workflow_id, state);
CREATE INDEX evidence_records_candidate_idx
  ON evidence_records(candidate_generation_id, candidate_digest);
CREATE INDEX evidence_eligibility_current_idx
  ON evidence_eligibility(evidence_id, version DESC);
CREATE INDEX pending_issues_goal_status_idx ON pending_issues(goal_id, status);
CREATE INDEX audit_events_aggregate_idx
  ON audit_events(aggregate_type, aggregate_id, sequence);
CREATE INDEX audit_events_command_idx ON audit_events(command_id, sequence);

CREATE TRIGGER evidence_eligibility_insert_guard
BEFORE INSERT ON evidence_eligibility
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM evidence_eligibility WHERE evidence_id = NEW.evidence_id
    ) AND (NEW.version <> 1 OR NEW.state <> 'ELIGIBLE')
    THEN RAISE(ABORT, 'first evidence eligibility must be ELIGIBLE version 1')
    WHEN EXISTS (
      SELECT 1 FROM evidence_eligibility WHERE evidence_id = NEW.evidence_id
    ) AND (
      NEW.version <> (
        SELECT max(version) + 1
        FROM evidence_eligibility
        WHERE evidence_id = NEW.evidence_id
      ) OR NEW.state <> 'INELIGIBLE' OR (
        SELECT state
        FROM evidence_eligibility
        WHERE evidence_id = NEW.evidence_id
        ORDER BY version DESC
        LIMIT 1
      ) <> 'ELIGIBLE'
    )
    THEN RAISE(ABORT, 'evidence eligibility may only move ELIGIBLE to INELIGIBLE')
  END;
END;

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are immutable');
END;

CREATE TRIGGER schema_migrations_no_update
BEFORE UPDATE ON schema_migrations
BEGIN
  SELECT RAISE(ABORT, 'applied migrations are immutable');
END;

CREATE TRIGGER schema_migrations_no_delete
BEFORE DELETE ON schema_migrations
BEGIN
  SELECT RAISE(ABORT, 'applied migrations are immutable');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are immutable');
END;

CREATE TRIGGER processed_commands_no_update
BEFORE UPDATE ON processed_commands
BEGIN
  SELECT RAISE(ABORT, 'processed commands are immutable');
END;

CREATE TRIGGER processed_commands_no_delete
BEFORE DELETE ON processed_commands
BEGIN
  SELECT RAISE(ABORT, 'processed commands are immutable');
END;

CREATE TRIGGER evidence_records_no_update
BEFORE UPDATE ON evidence_records
BEGIN
  SELECT RAISE(ABORT, 'evidence records are immutable');
END;

CREATE TRIGGER context_manifests_no_update
BEFORE UPDATE ON context_manifests
BEGIN
  SELECT RAISE(ABORT, 'context manifests are immutable');
END;

CREATE TRIGGER context_manifests_no_delete
BEFORE DELETE ON context_manifests
BEGIN
  SELECT RAISE(ABORT, 'context manifests are immutable');
END;

CREATE TRIGGER evidence_records_no_delete
BEFORE DELETE ON evidence_records
BEGIN
  SELECT RAISE(ABORT, 'evidence records are immutable');
END;

CREATE TRIGGER evidence_eligibility_no_update
BEFORE UPDATE ON evidence_eligibility
BEGIN
  SELECT RAISE(ABORT, 'evidence eligibility history is append-only');
END;

CREATE TRIGGER evidence_eligibility_no_delete
BEFORE DELETE ON evidence_eligibility
BEGIN
  SELECT RAISE(ABORT, 'evidence eligibility history is append-only');
END;

CREATE TRIGGER policy_bundles_no_update
BEFORE UPDATE ON policy_bundles
BEGIN
  SELECT RAISE(ABORT, 'policy bundles are immutable');
END;

CREATE TRIGGER policy_bundles_no_delete
BEFORE DELETE ON policy_bundles
BEGIN
  SELECT RAISE(ABORT, 'policy bundles are immutable');
END;

CREATE TRIGGER acceptance_input_manifests_no_update
BEFORE UPDATE ON acceptance_input_manifests
BEGIN
  SELECT RAISE(ABORT, 'acceptance input manifests are immutable');
END;

CREATE TRIGGER acceptance_input_manifests_no_delete
BEFORE DELETE ON acceptance_input_manifests
BEGIN
  SELECT RAISE(ABORT, 'acceptance input manifests are immutable');
END;

CREATE TRIGGER acceptance_decisions_no_update
BEFORE UPDATE ON acceptance_decisions
BEGIN
  SELECT RAISE(ABORT, 'acceptance decisions are immutable');
END;

CREATE TRIGGER acceptance_decisions_no_delete
BEFORE DELETE ON acceptance_decisions
BEGIN
  SELECT RAISE(ABORT, 'acceptance decisions are immutable');
END;
