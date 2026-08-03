-- M2.5 Slice 2: complete pre-Goal Intake authority storage. Complex closed
-- records retain their owning codec JSON while relational columns provide
-- identity, lifecycle, uniqueness, and cross-authority backstops.

CREATE TABLE intent_admission_policies (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  policy_version TEXT NOT NULL CHECK (length(trim(policy_version)) > 0),
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  policy_digest TEXT NOT NULL UNIQUE CHECK (
    length(policy_digest) = 71 AND substr(policy_digest, 1, 7) = 'sha256:' AND
    substr(policy_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  installed_at TEXT NOT NULL CHECK (
    length(installed_at) = 24 AND installed_at GLOB '????-??-??T??:??:??.???Z' AND
    strftime('%Y-%m-%dT%H:%M:%fZ', installed_at) = installed_at
  ),
  install_audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  payload_digest TEXT NOT NULL CHECK (payload_digest = policy_digest),
  UNIQUE (id, policy_digest),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.version') = policy_version),
  CHECK (json_extract(record_json, '$.digest') = policy_digest)
) STRICT;

CREATE TABLE raw_requests (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL CHECK (
    length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z' AND
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
  ),
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.createdAt') = created_at),
  FOREIGN KEY (intake_run_id) REFERENCES intake_runs(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE raw_request_revisions (
  raw_request_id TEXT NOT NULL REFERENCES raw_requests(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  intake_run_id TEXT NOT NULL,
  parent_revision INTEGER CHECK (
    parent_revision IS NULL OR
    (parent_revision >= 1 AND parent_revision <= 9007199254740991)
  ),
  principal_ref TEXT NOT NULL CHECK (length(trim(principal_ref)) > 0),
  interaction_action TEXT NOT NULL CHECK (
    interaction_action IN ('GOVERNED_EXECUTION', 'ANSWER_ONLY', 'MATERIALIZE_ONLY')
  ),
  declared_project_path TEXT,
  declared_project_identity_digest TEXT,
  admitted_content_digest TEXT NOT NULL,
  raw_request_digest TEXT NOT NULL UNIQUE,
  submitted_at TEXT NOT NULL,
  answered_question_id TEXT,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  PRIMARY KEY (raw_request_id, revision),
  UNIQUE (raw_request_id, revision, raw_request_digest),
  FOREIGN KEY (intake_run_id) REFERENCES intake_runs(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (raw_request_id, parent_revision)
    REFERENCES raw_request_revisions(raw_request_id, revision) ON DELETE RESTRICT,
  CHECK (
    (revision = 1 AND parent_revision IS NULL AND answered_question_id IS NULL) OR
    (revision > 1 AND parent_revision = revision - 1 AND answered_question_id IS NOT NULL)
  ),
  CHECK (
    (declared_project_path IS NULL AND declared_project_identity_digest IS NULL) OR
    (declared_project_path IS NOT NULL AND length(trim(declared_project_path)) > 0 AND
      declared_project_identity_digest IS NOT NULL)
  ),
  CHECK (length(raw_request_digest) = 71 AND substr(raw_request_digest, 1, 7) = 'sha256:'),
  CHECK (length(admitted_content_digest) = 71 AND substr(admitted_content_digest, 1, 7) = 'sha256:'),
  CHECK (length(submitted_at) = 24 AND submitted_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (json_extract(record_json, '$.rawRequestId') = raw_request_id),
  CHECK (json_extract(record_json, '$.revision') = revision),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.rawRequestDigest') = raw_request_digest)
) STRICT;

CREATE TABLE intake_runs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  version INTEGER NOT NULL CHECK (version >= 1 AND version <= 9007199254740991),
  principal_ref TEXT NOT NULL CHECK (length(trim(principal_ref)) > 0),
  status TEXT NOT NULL CHECK (
    status IN ('ANALYZING', 'NEEDS_CLARIFICATION', 'MATERIALIZED', 'NO_EXECUTION', 'FAILED')
  ),
  project_path TEXT,
  project_identity_digest TEXT,
  active_raw_request_id TEXT NOT NULL,
  active_raw_request_revision INTEGER NOT NULL,
  active_raw_request_digest TEXT NOT NULL,
  active_projection_id TEXT,
  active_projection_revision INTEGER,
  active_projection_digest TEXT,
  active_question_id TEXT,
  terminal_decision_id TEXT,
  answer_only_response_id TEXT,
  terminal_failure_id TEXT,
  goal_materialization_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  UNIQUE (id, version),
  FOREIGN KEY (active_raw_request_id, active_raw_request_revision, active_raw_request_digest)
    REFERENCES raw_request_revisions(raw_request_id, revision, raw_request_digest)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (project_path IS NULL AND project_identity_digest IS NULL) OR
    (project_path IS NOT NULL AND length(trim(project_path)) > 0 AND
      project_identity_digest IS NOT NULL)
  ),
  CHECK (
    (active_projection_id IS NULL AND active_projection_revision IS NULL AND
      active_projection_digest IS NULL) OR
    (active_projection_id IS NOT NULL AND active_projection_revision IS NOT NULL AND
      active_projection_digest IS NOT NULL)
  ),
  CHECK (
    (status = 'ANALYZING' AND active_question_id IS NULL AND terminal_decision_id IS NULL AND
      answer_only_response_id IS NULL AND terminal_failure_id IS NULL AND
      goal_materialization_id IS NULL) OR
    (status = 'NEEDS_CLARIFICATION' AND active_question_id IS NOT NULL AND
      terminal_decision_id IS NULL AND answer_only_response_id IS NULL AND
      terminal_failure_id IS NULL AND goal_materialization_id IS NULL) OR
    (status = 'MATERIALIZED' AND active_question_id IS NULL AND terminal_decision_id IS NOT NULL AND
      answer_only_response_id IS NULL AND terminal_failure_id IS NULL AND
      goal_materialization_id IS NOT NULL) OR
    (status = 'NO_EXECUTION' AND active_question_id IS NULL AND terminal_decision_id IS NOT NULL AND
      terminal_failure_id IS NULL AND goal_materialization_id IS NULL) OR
    (status = 'FAILED' AND active_question_id IS NULL AND terminal_decision_id IS NULL AND
      answer_only_response_id IS NULL AND terminal_failure_id IS NOT NULL AND
      goal_materialization_id IS NULL)
  ),
  CHECK (length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (length(updated_at) = 24 AND updated_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (updated_at >= created_at),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.version') = version),
  CHECK (json_extract(record_json, '$.status') = status)
) STRICT;

CREATE TABLE intake_manifests (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  operation TEXT NOT NULL CHECK (operation IN ('INTENT_ANALYSIS', 'ANSWER_ONLY')),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  package_digest TEXT NOT NULL,
  manifest_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  UNIQUE (id, manifest_digest),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.operation') = operation),
  CHECK (json_extract(record_json, '$.manifestDigest') = manifest_digest)
) STRICT;

CREATE TABLE intent_analysis_proposals (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  raw_request_revision INTEGER NOT NULL,
  raw_request_digest TEXT NOT NULL,
  proposal_digest TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  UNIQUE (id, proposal_digest),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.proposalDigest') = proposal_digest)
) STRICT;

CREATE TABLE source_bindings (
  binding_digest TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  authority_class TEXT NOT NULL CHECK (
    authority_class IN ('USER_STATED', 'POLICY_DERIVED', 'PROJECT_OBSERVED', 'MODEL_PROPOSED', 'UNRESOLVED')
  ),
  source_record_ref TEXT NOT NULL CHECK (length(trim(source_record_ref)) > 0),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  source_digest TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  CHECK (json_extract(record_json, '$.bindingDigest') = binding_digest),
  CHECK (json_extract(record_json, '$.authorityClass') = authority_class)
) STRICT;

CREATE TABLE intent_projection_revisions (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  parent_revision INTEGER,
  proposal_id TEXT NOT NULL REFERENCES intent_analysis_proposals(id) ON DELETE RESTRICT,
  proposal_digest TEXT NOT NULL,
  projection_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  PRIMARY KEY (id, revision),
  UNIQUE (id, revision, projection_digest),
  FOREIGN KEY (id, parent_revision)
    REFERENCES intent_projection_revisions(id, revision) ON DELETE RESTRICT,
  CHECK (
    (revision = 1 AND parent_revision IS NULL) OR
    (revision > 1 AND parent_revision = revision - 1)
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.revision') = revision),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.projectionDigest') = projection_digest)
) STRICT;

CREATE TABLE projection_source_bindings (
  projection_id TEXT NOT NULL,
  projection_revision INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  binding_digest TEXT NOT NULL REFERENCES source_bindings(binding_digest) ON DELETE RESTRICT,
  PRIMARY KEY (projection_id, projection_revision, position),
  UNIQUE (projection_id, projection_revision, binding_digest),
  FOREIGN KEY (projection_id, projection_revision)
    REFERENCES intent_projection_revisions(id, revision) ON DELETE RESTRICT
) STRICT;

CREATE TABLE material_ambiguity_sets (
  ambiguity_set_digest TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  projection_id TEXT NOT NULL,
  projection_revision INTEGER NOT NULL,
  projection_digest TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  FOREIGN KEY (projection_id, projection_revision, projection_digest)
    REFERENCES intent_projection_revisions(id, revision, projection_digest) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.ambiguitySetDigest') = ambiguity_set_digest),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id)
) STRICT;

CREATE TABLE material_ambiguities (
  id TEXT PRIMARY KEY,
  ambiguity_set_digest TEXT NOT NULL REFERENCES material_ambiguity_sets(ambiguity_set_digest) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('UNRESOLVED', 'RESOLVED')),
  resolved_by_raw_request_revision INTEGER,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  CHECK (
    (status = 'UNRESOLVED' AND resolved_by_raw_request_revision IS NULL) OR
    (status = 'RESOLVED' AND resolved_by_raw_request_revision IS NOT NULL)
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.status') = status),
  UNIQUE (ambiguity_set_digest, position)
) STRICT;

CREATE TABLE clarification_question_specs (
  question_spec_digest TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  ambiguity_ref TEXT NOT NULL REFERENCES material_ambiguities(id) ON DELETE RESTRICT,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  CHECK (json_extract(record_json, '$.questionSpecDigest') = question_spec_digest),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.ambiguityRef') = ambiguity_ref)
) STRICT;

CREATE TABLE intent_admission_decisions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  intake_run_version INTEGER NOT NULL CHECK (intake_run_version >= 1),
  principal_ref TEXT NOT NULL,
  interaction_action TEXT NOT NULL CHECK (
    interaction_action IN ('GOVERNED_EXECUTION', 'ANSWER_ONLY', 'MATERIALIZE_ONLY')
  ),
  decision_kind TEXT NOT NULL CHECK (
    decision_kind IN ('PRE_ANALYSIS_NO_EXECUTION', 'PROJECTED_NO_EXECUTION', 'CLARIFY', 'MATERIALIZE')
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('MATERIALIZE', 'CLARIFY', 'NO_EXECUTION')),
  reason_code TEXT NOT NULL,
  execution_disposition TEXT NOT NULL CHECK (
    execution_disposition IN ('NONE', 'LEAVE_READY', 'AUTHORIZE_START')
  ),
  admission_policy_id TEXT NOT NULL,
  admission_policy_digest TEXT NOT NULL,
  projection_id TEXT,
  projection_revision INTEGER,
  projection_digest TEXT,
  question_spec_digest TEXT,
  abandonment_question_id TEXT,
  abandonment_command_id TEXT,
  project_path TEXT,
  project_identity_digest TEXT,
  decision_digest TEXT NOT NULL UNIQUE,
  decided_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  UNIQUE (id, decision_digest),
  FOREIGN KEY (admission_policy_id, admission_policy_digest)
    REFERENCES intent_admission_policies(id, policy_digest) ON DELETE RESTRICT,
  FOREIGN KEY (projection_id, projection_revision, projection_digest)
    REFERENCES intent_projection_revisions(id, revision, projection_digest) ON DELETE RESTRICT,
  FOREIGN KEY (question_spec_digest)
    REFERENCES clarification_question_specs(question_spec_digest) ON DELETE RESTRICT,
  CHECK (
    (decision_kind = 'PRE_ANALYSIS_NO_EXECUTION' AND projection_id IS NULL AND
      projection_revision IS NULL AND projection_digest IS NULL) OR
    (decision_kind <> 'PRE_ANALYSIS_NO_EXECUTION' AND projection_id IS NOT NULL AND
      projection_revision IS NOT NULL AND projection_digest IS NOT NULL)
  ),
  CHECK (
    (outcome = 'NO_EXECUTION' AND execution_disposition = 'NONE') OR
    (outcome = 'CLARIFY' AND execution_disposition = 'NONE' AND
      decision_kind = 'CLARIFY' AND question_spec_digest IS NOT NULL) OR
    (outcome = 'MATERIALIZE' AND decision_kind = 'MATERIALIZE' AND
      execution_disposition IN ('LEAVE_READY', 'AUTHORIZE_START'))
  ),
  CHECK (
    (project_path IS NULL AND project_identity_digest IS NULL) OR
    (project_path IS NOT NULL AND project_identity_digest IS NOT NULL)
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.kind') = decision_kind),
  CHECK (json_extract(record_json, '$.decisionDigest') = decision_digest)
) STRICT;

CREATE TABLE clarification_questions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  decision_id TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  ambiguity_ref TEXT NOT NULL REFERENCES material_ambiguities(id) ON DELETE RESTRICT,
  question_spec_digest TEXT NOT NULL REFERENCES clarification_question_specs(question_spec_digest) ON DELETE RESTRICT,
  question_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  UNIQUE (id, question_digest),
  FOREIGN KEY (decision_id, decision_digest)
    REFERENCES intent_admission_decisions(id, decision_digest) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.questionSpecDigest') = question_spec_digest),
  CHECK (json_extract(record_json, '$.questionDigest') = question_digest)
) STRICT;

CREATE TABLE clarification_answer_bindings (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  question_id TEXT NOT NULL UNIQUE REFERENCES clarification_questions(id) ON DELETE RESTRICT,
  question_spec_digest TEXT NOT NULL,
  question_digest TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  raw_request_id TEXT NOT NULL,
  raw_request_revision INTEGER NOT NULL,
  raw_request_digest TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  canonical_command_input_digest TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  answer_binding_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  FOREIGN KEY (question_id, question_digest)
    REFERENCES clarification_questions(id, question_digest) ON DELETE RESTRICT,
  FOREIGN KEY (decision_id, decision_digest)
    REFERENCES intent_admission_decisions(id, decision_digest) ON DELETE RESTRICT,
  FOREIGN KEY (raw_request_id, raw_request_revision, raw_request_digest)
    REFERENCES raw_request_revisions(raw_request_id, revision, raw_request_digest) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.answerBindingDigest') = answer_binding_digest)
) STRICT;

CREATE TABLE answer_only_responses (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  response_kind TEXT NOT NULL CHECK (response_kind IN ('ANSWER_RETURNED', 'ANSWER_FAILED')),
  decision_id TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  response_digest TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  FOREIGN KEY (decision_id, decision_digest)
    REFERENCES intent_admission_decisions(id, decision_digest) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.kind') = response_kind),
  CHECK (json_extract(record_json, '$.responseDigest') = response_digest)
) STRICT;

CREATE TABLE intake_failure_records (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  command_id TEXT NOT NULL UNIQUE,
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  intake_run_version INTEGER NOT NULL CHECK (intake_run_version >= 1),
  failed_operation TEXT NOT NULL CHECK (
    failed_operation IN ('INTENT_ANALYSIS', 'PROJECT_OBSERVATION', 'ADMISSION_PREPARATION')
  ),
  reason_code TEXT NOT NULL,
  failure_digest TEXT NOT NULL UNIQUE,
  failed_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.commandId') = command_id),
  CHECK (json_extract(record_json, '$.failureDigest') = failure_digest)
) STRICT;

CREATE TABLE intake_command_reservations (
  command_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  operation_kind TEXT NOT NULL CHECK (
    operation_kind IN ('INTENT_ANALYSIS', 'ANSWER_ONLY', 'CLARIFICATION_ANALYSIS', 'ABANDON_CLARIFICATION', 'IMMEDIATE_NO_EXECUTION')
  ),
  principal_ref TEXT NOT NULL,
  raw_request_id TEXT NOT NULL REFERENCES raw_requests(id) ON DELETE RESTRICT,
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  canonical_command_input_digest TEXT NOT NULL,
  expected_intake_run_version INTEGER,
  observed_intake_run_version INTEGER NOT NULL CHECK (observed_intake_run_version >= 1),
  operation_id TEXT NOT NULL UNIQUE,
  manifest_id TEXT,
  manifest_digest TEXT,
  reservation_digest TEXT NOT NULL UNIQUE,
  reserved_at TEXT NOT NULL,
  has_abandonment_binding INTEGER NOT NULL CHECK (has_abandonment_binding IN (0, 1)),
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  UNIQUE (command_id, reservation_digest),
  FOREIGN KEY (manifest_id, manifest_digest)
    REFERENCES intake_manifests(id, manifest_digest) ON DELETE RESTRICT,
  CHECK (
    (operation_kind IN ('INTENT_ANALYSIS', 'ANSWER_ONLY', 'CLARIFICATION_ANALYSIS') AND
      manifest_id IS NOT NULL AND manifest_digest IS NOT NULL) OR
    (operation_kind IN ('ABANDON_CLARIFICATION', 'IMMEDIATE_NO_EXECUTION') AND
      manifest_id IS NULL AND manifest_digest IS NULL)
  ),
  CHECK (
    operation_kind NOT IN ('CLARIFICATION_ANALYSIS', 'ABANDON_CLARIFICATION') OR
    expected_intake_run_version IS NOT NULL
  ),
  CHECK (
    (operation_kind = 'ABANDON_CLARIFICATION') OR has_abandonment_binding = 0
  ),
  CHECK (json_extract(record_json, '$.commandId') = command_id),
  CHECK (json_extract(record_json, '$.operationKind') = operation_kind),
  CHECK (json_extract(record_json, '$.reservationDigest') = reservation_digest)
) STRICT;

CREATE TABLE intake_command_outcomes (
  command_id TEXT PRIMARY KEY REFERENCES intake_command_reservations(command_id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL CHECK (disposition IN ('APPLIED', 'REJECTED', 'FAILED')),
  canonical_command_input_digest TEXT NOT NULL,
  reservation_digest TEXT NOT NULL UNIQUE,
  observed_intake_run_version INTEGER NOT NULL CHECK (observed_intake_run_version >= 1),
  result_kind TEXT NOT NULL CHECK (
    result_kind IN ('CLARIFICATION_REQUIRED', 'NO_EXECUTION', 'MATERIALIZED', 'REJECTED', 'FAILED')
  ),
  result_digest TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  outcome_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  FOREIGN KEY (command_id, reservation_digest)
    REFERENCES intake_command_reservations(command_id, reservation_digest) ON DELETE RESTRICT,
  CHECK (
    (disposition = 'APPLIED' AND result_kind IN ('CLARIFICATION_REQUIRED', 'NO_EXECUTION', 'MATERIALIZED')) OR
    (disposition = 'REJECTED' AND result_kind = 'REJECTED') OR
    (disposition = 'FAILED' AND result_kind = 'FAILED')
  ),
  CHECK (json_extract(record_json, '$.commandId') = command_id),
  CHECK (json_extract(record_json, '$.disposition') = disposition),
  CHECK (json_extract(record_json, '$.reservationDigest') = reservation_digest),
  CHECK (json_extract(record_json, '$.outcomeDigest') = outcome_digest)
) STRICT;

CREATE TABLE goal_materializations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  intake_run_id TEXT NOT NULL UNIQUE REFERENCES intake_runs(id) ON DELETE RESTRICT,
  decision_id TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  projection_id TEXT NOT NULL,
  projection_revision INTEGER NOT NULL,
  projection_digest TEXT NOT NULL UNIQUE,
  project_path TEXT NOT NULL,
  project_identity_digest TEXT NOT NULL,
  goal_id TEXT NOT NULL UNIQUE REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (goal_revision = 1),
  workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL CHECK (workflow_version >= 1),
  materialized_at TEXT NOT NULL,
  materialization_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  UNIQUE (id, materialization_digest),
  FOREIGN KEY (decision_id, decision_digest)
    REFERENCES intent_admission_decisions(id, decision_digest) ON DELETE RESTRICT,
  FOREIGN KEY (projection_id, projection_revision, projection_digest)
    REFERENCES intent_projection_revisions(id, revision, projection_digest) ON DELETE RESTRICT,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.goalId') = goal_id),
  CHECK (json_extract(record_json, '$.workflowId') = workflow_id),
  CHECK (json_extract(record_json, '$.materializationDigest') = materialization_digest)
) STRICT;

CREATE TABLE goal_start_authorizations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  materialization_id TEXT NOT NULL UNIQUE REFERENCES goal_materializations(id) ON DELETE RESTRICT,
  materialization_digest TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (goal_revision = 1),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL CHECK (workflow_version >= 1),
  start_command_id TEXT NOT NULL UNIQUE,
  policy_bundle_id TEXT NOT NULL REFERENCES policy_bundles(id) ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  execution_profile_id TEXT NOT NULL REFERENCES execution_profiles(id) ON DELETE RESTRICT,
  execution_profile_digest TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  authorization_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  FOREIGN KEY (materialization_id, materialization_digest)
    REFERENCES goal_materializations(id, materialization_digest) ON DELETE RESTRICT,
  FOREIGN KEY (decision_id, decision_digest)
    REFERENCES intent_admission_decisions(id, decision_digest) ON DELETE RESTRICT,
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT,
  FOREIGN KEY (execution_profile_id, execution_profile_digest)
    REFERENCES execution_profiles(id, profile_digest) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.startCommandId') = start_command_id),
  CHECK (json_extract(record_json, '$.authorizationDigest') = authorization_digest)
) STRICT;

CREATE TABLE intake_audit_events (
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  command_id TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (intake_run_id, position),
  FOREIGN KEY (command_id) REFERENCES intake_command_reservations(command_id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX intake_runs_active_question_unique
  ON intake_runs(active_question_id) WHERE active_question_id IS NOT NULL;
CREATE INDEX raw_request_revisions_intake_idx
  ON raw_request_revisions(intake_run_id, revision);
CREATE INDEX intake_reservations_run_idx
  ON intake_command_reservations(intake_run_id, reserved_at, command_id);
CREATE INDEX intake_outcomes_run_idx
  ON intake_command_outcomes(intake_run_id, completed_at, command_id);
CREATE INDEX intake_decisions_run_idx
  ON intent_admission_decisions(intake_run_id, intake_run_version, id);

CREATE TRIGGER intake_runs_active_question_guard
BEFORE INSERT ON intake_runs
WHEN NEW.active_question_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM clarification_questions AS question
   WHERE question.id = NEW.active_question_id
     AND question.intake_run_id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'active Intake Question does not match retained authority');
END;

CREATE TRIGGER intake_runs_active_question_update_guard
BEFORE UPDATE ON intake_runs
WHEN NEW.active_question_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM clarification_questions AS question
   WHERE question.id = NEW.active_question_id
     AND question.intake_run_id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'active Intake Question does not match retained authority');
END;

CREATE TRIGGER intake_runs_versioned_update_guard
BEFORE UPDATE ON intake_runs
WHEN
  NEW.id <> OLD.id OR
  NEW.schema_version <> OLD.schema_version OR
  NEW.principal_ref <> OLD.principal_ref OR
  NEW.created_at <> OLD.created_at OR
  NEW.version <> OLD.version + 1 OR
  NEW.updated_at < OLD.updated_at OR
  NEW.active_raw_request_id <> OLD.active_raw_request_id OR
  NEW.active_raw_request_revision < OLD.active_raw_request_revision OR
  NEW.active_raw_request_revision > OLD.active_raw_request_revision + 1 OR
  (OLD.project_path IS NOT NULL AND
    (NEW.project_path IS NOT OLD.project_path OR
      NEW.project_identity_digest IS NOT OLD.project_identity_digest)) OR
  (OLD.active_projection_id IS NOT NULL AND
    (NEW.active_projection_id IS NOT OLD.active_projection_id OR
      NEW.active_projection_revision < OLD.active_projection_revision)) OR
  OLD.status IN ('MATERIALIZED', 'NO_EXECUTION', 'FAILED')
BEGIN
  SELECT RAISE(ABORT, 'invalid versioned Intake Run update');
END;

CREATE TRIGGER intake_command_outcomes_exact_reservation_guard
BEFORE INSERT ON intake_command_outcomes
WHEN NOT EXISTS (
  SELECT 1 FROM intake_command_reservations AS reservation
   WHERE reservation.command_id = NEW.command_id
     AND reservation.intake_run_id = NEW.intake_run_id
     AND reservation.canonical_command_input_digest = NEW.canonical_command_input_digest
     AND reservation.reservation_digest = NEW.reservation_digest
     AND reservation.observed_intake_run_version = NEW.observed_intake_run_version
     AND NEW.completed_at >= reservation.reserved_at
)
BEGIN
  SELECT RAISE(ABORT, 'Intake outcome does not match its exact reservation');
END;

CREATE TRIGGER intake_abandonment_outcome_guard
BEFORE INSERT ON intake_command_outcomes
WHEN EXISTS (
  SELECT 1 FROM intake_command_reservations AS reservation
   WHERE reservation.command_id = NEW.command_id
     AND reservation.operation_kind = 'ABANDON_CLARIFICATION'
) AND NOT (
  (NEW.disposition = 'APPLIED' AND NEW.result_kind = 'NO_EXECUTION' AND
    (SELECT has_abandonment_binding FROM intake_command_reservations WHERE command_id = NEW.command_id) = 1) OR
  (NEW.disposition = 'REJECTED' AND NEW.result_kind = 'REJECTED' AND
    (SELECT has_abandonment_binding FROM intake_command_reservations WHERE command_id = NEW.command_id) = 0)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid abandonment reservation/outcome shape');
END;

CREATE TRIGGER clarification_answer_binding_question_guard
BEFORE INSERT ON clarification_answer_bindings
WHEN NOT EXISTS (
  SELECT 1 FROM clarification_questions AS question
   WHERE question.id = NEW.question_id
     AND question.intake_run_id = NEW.intake_run_id
     AND question.question_spec_digest = NEW.question_spec_digest
     AND question.question_digest = NEW.question_digest
     AND question.decision_id = NEW.decision_id
     AND question.decision_digest = NEW.decision_digest
)
BEGIN
  SELECT RAISE(ABORT, 'Clarification Answer Binding does not match its Question');
END;

CREATE TRIGGER goal_materializations_authority_guard
BEFORE INSERT ON goal_materializations
WHEN NOT EXISTS (
  SELECT 1
    FROM intent_admission_decisions AS decision
    JOIN goals AS goal ON goal.id = NEW.goal_id
    JOIN workflows AS workflow ON workflow.id = NEW.workflow_id
   WHERE decision.id = NEW.decision_id
     AND decision.decision_digest = NEW.decision_digest
     AND decision.intake_run_id = NEW.intake_run_id
     AND decision.decision_kind = 'MATERIALIZE'
     AND decision.outcome = 'MATERIALIZE'
     AND decision.projection_id = NEW.projection_id
     AND decision.projection_revision = NEW.projection_revision
     AND decision.projection_digest = NEW.projection_digest
     AND goal.revision = NEW.goal_revision
     AND goal.project_path = NEW.project_path
     AND workflow.goal_id = NEW.goal_id
     AND workflow.goal_revision = NEW.goal_revision
     AND workflow.version = NEW.workflow_version
     AND workflow.phase = 'DISCOVERY'
     AND workflow.run_status = 'READY'
)
BEGIN
  SELECT RAISE(ABORT, 'Goal Materialization does not match Intake/Goal/Workflow authority');
END;

CREATE TRIGGER goal_start_authorizations_disposition_guard
BEFORE INSERT ON goal_start_authorizations
WHEN NOT EXISTS (
  SELECT 1
    FROM goal_materializations AS materialization
    JOIN intent_admission_decisions AS decision ON decision.id = NEW.decision_id
   WHERE materialization.id = NEW.materialization_id
     AND materialization.materialization_digest = NEW.materialization_digest
     AND materialization.decision_id = NEW.decision_id
     AND materialization.decision_digest = NEW.decision_digest
     AND materialization.goal_id = NEW.goal_id
     AND materialization.goal_revision = NEW.goal_revision
     AND materialization.workflow_id = NEW.workflow_id
     AND materialization.workflow_version = NEW.workflow_version
     AND decision.execution_disposition = 'AUTHORIZE_START'
)
BEGIN
  SELECT RAISE(ABORT, 'Goal Start Authorization lacks exact governed Materialization authority');
END;

CREATE TRIGGER intake_runs_no_delete BEFORE DELETE ON intake_runs
BEGIN SELECT RAISE(ABORT, 'Intake Runs cannot be deleted'); END;
CREATE TRIGGER raw_requests_no_update BEFORE UPDATE ON raw_requests
BEGIN SELECT RAISE(ABORT, 'Raw Requests are immutable'); END;
CREATE TRIGGER raw_requests_no_delete BEFORE DELETE ON raw_requests
BEGIN SELECT RAISE(ABORT, 'Raw Requests are immutable'); END;
CREATE TRIGGER raw_request_revisions_no_update BEFORE UPDATE ON raw_request_revisions
BEGIN SELECT RAISE(ABORT, 'Raw Request revisions are immutable'); END;
CREATE TRIGGER raw_request_revisions_no_delete BEFORE DELETE ON raw_request_revisions
BEGIN SELECT RAISE(ABORT, 'Raw Request revisions are immutable'); END;

-- Every remaining Intake record is append-only. IntakeRun is the sole mutable
-- current-state row and is updated only by versioned Store transactions.
CREATE TRIGGER intent_admission_policies_no_update BEFORE UPDATE ON intent_admission_policies
BEGIN SELECT RAISE(ABORT, 'Admission Policies are immutable'); END;
CREATE TRIGGER intent_admission_policies_no_delete BEFORE DELETE ON intent_admission_policies
BEGIN SELECT RAISE(ABORT, 'Admission Policies are immutable'); END;
CREATE TRIGGER intake_manifests_no_update BEFORE UPDATE ON intake_manifests
BEGIN SELECT RAISE(ABORT, 'Intake Manifests are immutable'); END;
CREATE TRIGGER intake_manifests_no_delete BEFORE DELETE ON intake_manifests
BEGIN SELECT RAISE(ABORT, 'Intake Manifests are immutable'); END;
CREATE TRIGGER intent_analysis_proposals_no_update BEFORE UPDATE ON intent_analysis_proposals
BEGIN SELECT RAISE(ABORT, 'Intent Analysis Proposals are immutable'); END;
CREATE TRIGGER intent_analysis_proposals_no_delete BEFORE DELETE ON intent_analysis_proposals
BEGIN SELECT RAISE(ABORT, 'Intent Analysis Proposals are immutable'); END;
CREATE TRIGGER source_bindings_no_update BEFORE UPDATE ON source_bindings
BEGIN SELECT RAISE(ABORT, 'Source Bindings are immutable'); END;
CREATE TRIGGER source_bindings_no_delete BEFORE DELETE ON source_bindings
BEGIN SELECT RAISE(ABORT, 'Source Bindings are immutable'); END;
CREATE TRIGGER intent_projection_revisions_no_update BEFORE UPDATE ON intent_projection_revisions
BEGIN SELECT RAISE(ABORT, 'Intent Projection revisions are immutable'); END;
CREATE TRIGGER intent_projection_revisions_no_delete BEFORE DELETE ON intent_projection_revisions
BEGIN SELECT RAISE(ABORT, 'Intent Projection revisions are immutable'); END;
CREATE TRIGGER projection_source_bindings_no_update BEFORE UPDATE ON projection_source_bindings
BEGIN SELECT RAISE(ABORT, 'Projection Source Binding membership is immutable'); END;
CREATE TRIGGER projection_source_bindings_no_delete BEFORE DELETE ON projection_source_bindings
BEGIN SELECT RAISE(ABORT, 'Projection Source Binding membership is immutable'); END;
CREATE TRIGGER material_ambiguity_sets_no_update BEFORE UPDATE ON material_ambiguity_sets
BEGIN SELECT RAISE(ABORT, 'Material Ambiguity sets are immutable'); END;
CREATE TRIGGER material_ambiguity_sets_no_delete BEFORE DELETE ON material_ambiguity_sets
BEGIN SELECT RAISE(ABORT, 'Material Ambiguity sets are immutable'); END;
CREATE TRIGGER material_ambiguities_no_update BEFORE UPDATE ON material_ambiguities
BEGIN SELECT RAISE(ABORT, 'Material Ambiguities are immutable'); END;
CREATE TRIGGER material_ambiguities_no_delete BEFORE DELETE ON material_ambiguities
BEGIN SELECT RAISE(ABORT, 'Material Ambiguities are immutable'); END;
CREATE TRIGGER clarification_question_specs_no_update BEFORE UPDATE ON clarification_question_specs
BEGIN SELECT RAISE(ABORT, 'Clarification Question Specs are immutable'); END;
CREATE TRIGGER clarification_question_specs_no_delete BEFORE DELETE ON clarification_question_specs
BEGIN SELECT RAISE(ABORT, 'Clarification Question Specs are immutable'); END;
CREATE TRIGGER intent_admission_decisions_no_update BEFORE UPDATE ON intent_admission_decisions
BEGIN SELECT RAISE(ABORT, 'Intent Admission Decisions are immutable'); END;
CREATE TRIGGER intent_admission_decisions_no_delete BEFORE DELETE ON intent_admission_decisions
BEGIN SELECT RAISE(ABORT, 'Intent Admission Decisions are immutable'); END;
CREATE TRIGGER clarification_questions_no_update BEFORE UPDATE ON clarification_questions
BEGIN SELECT RAISE(ABORT, 'Clarification Questions are immutable'); END;
CREATE TRIGGER clarification_questions_no_delete BEFORE DELETE ON clarification_questions
BEGIN SELECT RAISE(ABORT, 'Clarification Questions are immutable'); END;
CREATE TRIGGER clarification_answer_bindings_no_update BEFORE UPDATE ON clarification_answer_bindings
BEGIN SELECT RAISE(ABORT, 'Clarification Answer Bindings are immutable'); END;
CREATE TRIGGER clarification_answer_bindings_no_delete BEFORE DELETE ON clarification_answer_bindings
BEGIN SELECT RAISE(ABORT, 'Clarification Answer Bindings are immutable'); END;
CREATE TRIGGER answer_only_responses_no_update BEFORE UPDATE ON answer_only_responses
BEGIN SELECT RAISE(ABORT, 'Answer-only Responses are immutable'); END;
CREATE TRIGGER answer_only_responses_no_delete BEFORE DELETE ON answer_only_responses
BEGIN SELECT RAISE(ABORT, 'Answer-only Responses are immutable'); END;
CREATE TRIGGER intake_failure_records_no_update BEFORE UPDATE ON intake_failure_records
BEGIN SELECT RAISE(ABORT, 'Intake Failure Records are immutable'); END;
CREATE TRIGGER intake_failure_records_no_delete BEFORE DELETE ON intake_failure_records
BEGIN SELECT RAISE(ABORT, 'Intake Failure Records are immutable'); END;
CREATE TRIGGER intake_command_reservations_no_update BEFORE UPDATE ON intake_command_reservations
BEGIN SELECT RAISE(ABORT, 'Intake command reservations are immutable'); END;
CREATE TRIGGER intake_command_reservations_no_delete BEFORE DELETE ON intake_command_reservations
BEGIN SELECT RAISE(ABORT, 'Intake command reservations are immutable'); END;
CREATE TRIGGER intake_command_outcomes_no_update BEFORE UPDATE ON intake_command_outcomes
BEGIN SELECT RAISE(ABORT, 'Intake command outcomes are immutable'); END;
CREATE TRIGGER intake_command_outcomes_no_delete BEFORE DELETE ON intake_command_outcomes
BEGIN SELECT RAISE(ABORT, 'Intake command outcomes are immutable'); END;
CREATE TRIGGER goal_materializations_no_update BEFORE UPDATE ON goal_materializations
BEGIN SELECT RAISE(ABORT, 'Goal Materializations are immutable'); END;
CREATE TRIGGER goal_materializations_no_delete BEFORE DELETE ON goal_materializations
BEGIN SELECT RAISE(ABORT, 'Goal Materializations are immutable'); END;
CREATE TRIGGER goal_start_authorizations_no_update BEFORE UPDATE ON goal_start_authorizations
BEGIN SELECT RAISE(ABORT, 'Goal Start Authorizations are immutable'); END;
CREATE TRIGGER goal_start_authorizations_no_delete BEFORE DELETE ON goal_start_authorizations
BEGIN SELECT RAISE(ABORT, 'Goal Start Authorizations are immutable'); END;
CREATE TRIGGER intake_audit_events_no_update BEFORE UPDATE ON intake_audit_events
BEGIN SELECT RAISE(ABORT, 'Intake audit relationships are immutable'); END;
CREATE TRIGGER intake_audit_events_no_delete BEFORE DELETE ON intake_audit_events
BEGIN SELECT RAISE(ABORT, 'Intake audit relationships are immutable'); END;
