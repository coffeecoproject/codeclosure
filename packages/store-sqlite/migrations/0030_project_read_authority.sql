-- M2.5.1 Slice 3 candidate-free project-read authority. Historical physical
-- Context rows and logical Context v2/v3/v4 extension meanings remain exact.

CREATE TABLE project_source_read_authorities (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('DISCOVERY', 'PLAN')),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE RESTRICT,
  normalized_project_root TEXT NOT NULL,
  source_tree_projection_digest TEXT NOT NULL,
  git_state_projection_digest TEXT NOT NULL,
  snapshot_id TEXT NOT NULL UNIQUE,
  workspace_root_identity TEXT NOT NULL,
  snapshot_leaf_realpath TEXT NOT NULL UNIQUE,
  ownership_marker_digest TEXT NOT NULL,
  policy_bundle_id TEXT NOT NULL,
  policy_bundle_digest TEXT NOT NULL,
  execution_profile_id TEXT NOT NULL,
  execution_profile_digest TEXT NOT NULL,
  capability_grant_digest TEXT NOT NULL,
  response_contract_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  canonical_json TEXT NOT NULL CHECK (
    json_valid(canonical_json) AND json_type(canonical_json) = 'object'
  ),
  record_digest TEXT NOT NULL UNIQUE,
  audit_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  UNIQUE (id, record_digest),
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (policy_bundle_id, policy_bundle_digest)
    REFERENCES policy_bundles(id, bundle_digest) ON DELETE RESTRICT,
  FOREIGN KEY (execution_profile_id, execution_profile_digest)
    REFERENCES execution_profiles(id, profile_digest) ON DELETE RESTRICT,
  CHECK (length(record_digest) = 71 AND substr(record_digest, 1, 7) = 'sha256:'),
  CHECK (
    length(source_tree_projection_digest) = 71 AND
    substr(source_tree_projection_digest, 1, 7) = 'sha256:'
  ),
  CHECK (
    length(git_state_projection_digest) = 71 AND
    substr(git_state_projection_digest, 1, 7) = 'sha256:'
  )
) STRICT;

CREATE TRIGGER project_source_read_authorities_insert_guard
BEFORE INSERT ON project_source_read_authorities
WHEN COALESCE(
  json_extract(NEW.canonical_json, '$.schemaVersion') = 1
  AND json_extract(NEW.canonical_json, '$.id') = NEW.id
  AND json_extract(NEW.canonical_json, '$.goalId') = NEW.goal_id
  AND json_extract(NEW.canonical_json, '$.goalRevision') = NEW.goal_revision
  AND json_extract(NEW.canonical_json, '$.workflowId') = NEW.workflow_id
  AND json_extract(NEW.canonical_json, '$.workflowVersion') = NEW.workflow_version
  AND json_extract(NEW.canonical_json, '$.phase') = NEW.phase
  AND json_extract(NEW.canonical_json, '$.attemptId') = NEW.attempt_id
  AND json_extract(NEW.canonical_json, '$.normalizedProjectRoot') = NEW.normalized_project_root
  AND json_extract(NEW.canonical_json, '$.sourceTree.projectionDigest') =
      NEW.source_tree_projection_digest
  AND json_extract(NEW.canonical_json, '$.gitState.projectionDigest') =
      NEW.git_state_projection_digest
  AND json_extract(NEW.canonical_json, '$.snapshotId') = NEW.snapshot_id
  AND json_extract(NEW.canonical_json, '$.workspaceRootIdentity') =
      NEW.workspace_root_identity
  AND json_extract(NEW.canonical_json, '$.snapshotLeafRealpath') =
      NEW.snapshot_leaf_realpath
  AND json_extract(NEW.canonical_json, '$.ownershipMarkerDigest') =
      NEW.ownership_marker_digest
  AND json_extract(NEW.canonical_json, '$.policyBundleId') = NEW.policy_bundle_id
  AND json_extract(NEW.canonical_json, '$.policyBundleDigest') = NEW.policy_bundle_digest
  AND json_extract(NEW.canonical_json, '$.executionProfileId') = NEW.execution_profile_id
  AND json_extract(NEW.canonical_json, '$.executionProfileDigest') =
      NEW.execution_profile_digest
  AND json_extract(NEW.canonical_json, '$.capabilityGrantDigest') =
      NEW.capability_grant_digest
  AND json_extract(NEW.canonical_json, '$.responseContractDigest') =
      NEW.response_contract_digest
  AND json_extract(NEW.canonical_json, '$.issuedAt') = NEW.issued_at
  AND json_extract(NEW.canonical_json, '$.recordDigest') = NEW.record_digest
  AND EXISTS (
    SELECT 1
    FROM attempts AS attempt
    JOIN workflows AS workflow ON workflow.id = attempt.workflow_id
    JOIN goals AS goal ON goal.id = workflow.goal_id
    WHERE attempt.id = NEW.attempt_id
      AND attempt.workflow_id = NEW.workflow_id
      AND attempt.phase = NEW.phase
      AND attempt.status = 'RUNNING'
      AND attempt.context_manifest_id IS NOT NULL
      AND workflow.id = NEW.workflow_id
      AND workflow.goal_id = NEW.goal_id
      AND workflow.goal_revision = NEW.goal_revision
      AND workflow.version = NEW.workflow_version
      AND workflow.active_attempt_id = NEW.attempt_id
      AND workflow.phase = NEW.phase
      AND workflow.run_status = 'RUNNING'
      AND goal.revision = NEW.goal_revision
      AND goal.project_path = NEW.normalized_project_root
      AND NEW.issued_at <= attempt.started_at
  )
  AND EXISTS (
    SELECT 1 FROM audit_events AS audit
    WHERE audit.sequence = NEW.audit_sequence
      AND audit.aggregate_type = 'PROJECT_SOURCE_READ_AUTHORITY'
      AND audit.aggregate_id = NEW.id
      AND audit.event_type = 'PROJECT_SOURCE_READ_AUTHORITY_RECORDED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.payload_digest = NEW.record_digest
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid project-source read authority');
END;

CREATE TRIGGER project_source_read_authorities_no_update
BEFORE UPDATE ON project_source_read_authorities
BEGIN
  SELECT RAISE(ABORT, 'project-source read authorities are immutable');
END;

CREATE TRIGGER project_source_read_authorities_no_delete
BEFORE DELETE ON project_source_read_authorities
BEGIN
  SELECT RAISE(ABORT, 'project-source read authorities cannot be deleted');
END;

CREATE TABLE project_read_context_manifest_extensions (
  context_manifest_id TEXT PRIMARY KEY REFERENCES context_manifests(id) ON DELETE RESTRICT,
  logical_schema_version INTEGER NOT NULL CHECK (logical_schema_version = 5),
  project_read_authority_id TEXT NOT NULL,
  project_read_authority_record_digest TEXT NOT NULL,
  source_tree_projection_digest TEXT NOT NULL,
  git_state_projection_digest TEXT NOT NULL,
  verification_plan_id TEXT NOT NULL,
  verification_plan_digest TEXT NOT NULL,
  FOREIGN KEY (project_read_authority_id, project_read_authority_record_digest)
    REFERENCES project_source_read_authorities(id, record_digest) ON DELETE RESTRICT,
  FOREIGN KEY (verification_plan_id, verification_plan_digest)
    REFERENCES acceptance_critical_verification_plans(id, plan_digest) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER project_read_context_manifest_extensions_insert_guard
BEFORE INSERT ON project_read_context_manifest_extensions
WHEN NOT EXISTS (
  SELECT 1
  FROM context_manifests AS context
  JOIN project_source_read_authorities AS authority
    ON authority.id = NEW.project_read_authority_id
   AND authority.record_digest = NEW.project_read_authority_record_digest
  JOIN acceptance_critical_verification_plans AS plan
    ON plan.id = NEW.verification_plan_id
   AND plan.plan_digest = NEW.verification_plan_digest
  WHERE context.id = NEW.context_manifest_id
    AND context.schema_version = 2
    AND context.goal_id = authority.goal_id
    AND context.goal_revision = authority.goal_revision
    AND context.workflow_id = authority.workflow_id
    AND context.workflow_version = authority.workflow_version
    AND context.phase = authority.phase
    AND context.attempt_id = authority.attempt_id
    AND context.candidate_generation_id IS NULL
    AND context.candidate_digest IS NULL
    AND context.policy_bundle_id = authority.policy_bundle_id
    AND context.policy_bundle_digest = authority.policy_bundle_digest
    AND context.execution_profile_id = authority.execution_profile_id
    AND context.execution_profile_digest = authority.execution_profile_digest
    AND context.capability_grant_digest = authority.capability_grant_digest
    AND context.response_contract_digest = authority.response_contract_digest
    AND authority.source_tree_projection_digest = NEW.source_tree_projection_digest
    AND authority.git_state_projection_digest = NEW.git_state_projection_digest
    AND plan.goal_id = context.goal_id
    AND plan.goal_revision = context.goal_revision
    AND plan.workflow_id = context.workflow_id
    AND plan.policy_bundle_id = context.policy_bundle_id
    AND plan.policy_bundle_digest = context.policy_bundle_digest
    AND plan.execution_profile_id = context.execution_profile_id
    AND plan.execution_profile_digest = context.execution_profile_digest
)
BEGIN
  SELECT RAISE(ABORT, 'project-read Context Manifest has no exact authority');
END;

CREATE TRIGGER project_read_context_manifest_extensions_no_update
BEFORE UPDATE ON project_read_context_manifest_extensions
BEGIN
  SELECT RAISE(ABORT, 'project-read Context Manifest extensions are immutable');
END;

CREATE TRIGGER project_read_context_manifest_extensions_no_delete
BEFORE DELETE ON project_read_context_manifest_extensions
BEGIN
  SELECT RAISE(ABORT, 'project-read Context Manifest extensions cannot be deleted');
END;
