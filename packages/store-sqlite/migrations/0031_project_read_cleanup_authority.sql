-- M2.5.1 Slice 3 project-read cleanup persistence foundation. These records
-- are Runtime/Store authority; the workspace adapter can only return an
-- untrusted physical observation for an already-issued Grant.

CREATE TABLE project_read_workspace_authority_snapshots (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  authority_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  issued_at TEXT NOT NULL,
  canonical_json TEXT NOT NULL CHECK (
    json_valid(canonical_json) AND json_type(canonical_json) = 'object'
  ),
  authority_digest TEXT NOT NULL UNIQUE,
  audit_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  UNIQUE (id, authority_digest),
  CHECK (authority_sequence = audit_sequence),
  CHECK (length(authority_digest) = 71 AND substr(authority_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE TRIGGER project_read_workspace_authority_snapshots_insert_guard
BEFORE INSERT ON project_read_workspace_authority_snapshots
WHEN COALESCE(
  json_extract(NEW.canonical_json, '$.schemaVersion') = NEW.schema_version
  AND json_extract(NEW.canonical_json, '$.id') = NEW.id
  AND json_extract(NEW.canonical_json, '$.authoritySequence') = NEW.authority_sequence
  AND json_extract(NEW.canonical_json, '$.issuedAt') = NEW.issued_at
  AND json_extract(NEW.canonical_json, '$.authorityDigest') = NEW.authority_digest
  AND EXISTS (
    SELECT 1 FROM audit_events AS audit
    WHERE audit.sequence = NEW.audit_sequence
      AND audit.aggregate_type = 'PROJECT_READ_WORKSPACE_AUTHORITY_SNAPSHOT'
      AND audit.aggregate_id = NEW.id
      AND audit.event_type = 'PROJECT_READ_WORKSPACE_AUTHORITY_SNAPSHOT_ISSUED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.payload_digest = NEW.authority_digest
      AND audit.occurred_at = NEW.issued_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid project-read workspace authority snapshot');
END;

CREATE TRIGGER project_read_workspace_authority_snapshots_no_update
BEFORE UPDATE ON project_read_workspace_authority_snapshots
BEGIN
  SELECT RAISE(ABORT, 'project-read workspace authority snapshots are immutable');
END;

CREATE TRIGGER project_read_workspace_authority_snapshots_no_delete
BEFORE DELETE ON project_read_workspace_authority_snapshots
BEGIN
  SELECT RAISE(ABORT, 'project-read workspace authority snapshots cannot be deleted');
END;

CREATE TABLE project_read_workspace_observations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  authority_snapshot_id TEXT NOT NULL,
  authority_snapshot_digest TEXT NOT NULL,
  authority_sequence INTEGER NOT NULL,
  classification TEXT NOT NULL CHECK (
    classification IN ('OWNED_CURRENT', 'OWNED_ORPHANED', 'OWNED_RETAINED', 'UNSAFE')
  ),
  project_read_authority_id TEXT,
  snapshot_id TEXT,
  workspace_root_identity TEXT NOT NULL,
  snapshot_leaf_realpath TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  canonical_json TEXT NOT NULL CHECK (
    json_valid(canonical_json) AND json_type(canonical_json) = 'object'
  ),
  observation_digest TEXT NOT NULL UNIQUE,
  audit_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  UNIQUE (id, observation_digest),
  FOREIGN KEY (authority_snapshot_id, authority_snapshot_digest)
    REFERENCES project_read_workspace_authority_snapshots(id, authority_digest) ON DELETE RESTRICT,
  CHECK (length(observation_digest) = 71 AND substr(observation_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE TRIGGER project_read_workspace_observations_insert_guard
BEFORE INSERT ON project_read_workspace_observations
WHEN COALESCE(
  json_extract(NEW.canonical_json, '$.schemaVersion') = NEW.schema_version
  AND json_extract(NEW.canonical_json, '$.id') = NEW.id
  AND json_extract(NEW.canonical_json, '$.authoritySnapshotId') = NEW.authority_snapshot_id
  AND json_extract(NEW.canonical_json, '$.authoritySnapshotDigest') = NEW.authority_snapshot_digest
  AND json_extract(NEW.canonical_json, '$.authoritySequence') = NEW.authority_sequence
  AND json_extract(NEW.canonical_json, '$.classification') = NEW.classification
  AND json_extract(NEW.canonical_json, '$.projectReadAuthorityId') IS NEW.project_read_authority_id
  AND json_extract(NEW.canonical_json, '$.snapshotId') IS NEW.snapshot_id
  AND json_extract(NEW.canonical_json, '$.workspaceRootIdentity') = NEW.workspace_root_identity
  AND json_extract(NEW.canonical_json, '$.snapshotLeafRealpath') = NEW.snapshot_leaf_realpath
  AND json_extract(NEW.canonical_json, '$.observedAt') = NEW.observed_at
  AND json_extract(NEW.canonical_json, '$.observationDigest') = NEW.observation_digest
  AND EXISTS (
    SELECT 1 FROM audit_events AS audit
    WHERE audit.sequence = NEW.audit_sequence
      AND audit.aggregate_type = 'PROJECT_READ_WORKSPACE_OBSERVATION'
      AND audit.aggregate_id = NEW.id
      AND audit.event_type = 'PROJECT_READ_WORKSPACE_OBSERVATION_RECORDED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.payload_digest = NEW.observation_digest
      AND audit.occurred_at = NEW.observed_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid project-read workspace observation');
END;

CREATE TRIGGER project_read_workspace_observations_no_update
BEFORE UPDATE ON project_read_workspace_observations
BEGIN
  SELECT RAISE(ABORT, 'project-read workspace observations are immutable');
END;

CREATE TRIGGER project_read_workspace_observations_no_delete
BEFORE DELETE ON project_read_workspace_observations
BEGIN
  SELECT RAISE(ABORT, 'project-read workspace observations cannot be deleted');
END;

CREATE TABLE project_read_snapshot_cleanup_grants (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  eligibility_kind TEXT NOT NULL CHECK (eligibility_kind IN ('TERMINAL', 'ORPHANED')),
  authority_snapshot_id TEXT NOT NULL,
  authority_snapshot_digest TEXT NOT NULL,
  authority_sequence INTEGER NOT NULL,
  project_read_authority_id TEXT NOT NULL UNIQUE,
  snapshot_id TEXT NOT NULL UNIQUE,
  workspace_root_identity TEXT NOT NULL,
  snapshot_leaf_realpath TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  workspace_observation_id TEXT,
  workspace_observation_digest TEXT,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE RESTRICT,
  external_execution_id TEXT REFERENCES external_execution_records(id) ON DELETE RESTRICT,
  canonical_json TEXT NOT NULL CHECK (
    json_valid(canonical_json) AND json_type(canonical_json) = 'object'
  ),
  grant_digest TEXT NOT NULL UNIQUE,
  audit_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  UNIQUE (id, grant_digest),
  UNIQUE (workspace_root_identity, snapshot_leaf_realpath),
  FOREIGN KEY (authority_snapshot_id, authority_snapshot_digest)
    REFERENCES project_read_workspace_authority_snapshots(id, authority_digest) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_observation_id, workspace_observation_digest)
    REFERENCES project_read_workspace_observations(id, observation_digest) ON DELETE RESTRICT,
  CHECK (
    (eligibility_kind = 'ORPHANED' AND workspace_observation_id IS NOT NULL
      AND workspace_observation_digest IS NOT NULL AND attempt_id IS NULL
      AND external_execution_id IS NULL)
    OR
    (eligibility_kind = 'TERMINAL' AND workspace_observation_id IS NULL
      AND workspace_observation_digest IS NULL AND attempt_id IS NOT NULL
      AND external_execution_id IS NOT NULL)
  ),
  CHECK (length(grant_digest) = 71 AND substr(grant_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE TRIGGER project_read_snapshot_cleanup_grants_insert_guard
BEFORE INSERT ON project_read_snapshot_cleanup_grants
WHEN COALESCE(
  json_extract(NEW.canonical_json, '$.schemaVersion') = NEW.schema_version
  AND json_extract(NEW.canonical_json, '$.id') = NEW.id
  AND json_extract(NEW.canonical_json, '$.eligibilityKind') = NEW.eligibility_kind
  AND json_extract(NEW.canonical_json, '$.authoritySnapshotId') = NEW.authority_snapshot_id
  AND json_extract(NEW.canonical_json, '$.authoritySnapshotDigest') = NEW.authority_snapshot_digest
  AND json_extract(NEW.canonical_json, '$.authoritySequence') = NEW.authority_sequence
  AND json_extract(NEW.canonical_json, '$.projectReadAuthorityId') = NEW.project_read_authority_id
  AND json_extract(NEW.canonical_json, '$.snapshotId') = NEW.snapshot_id
  AND json_extract(NEW.canonical_json, '$.workspaceRootIdentity') = NEW.workspace_root_identity
  AND json_extract(NEW.canonical_json, '$.snapshotLeafRealpath') = NEW.snapshot_leaf_realpath
  AND json_extract(NEW.canonical_json, '$.issuedAt') = NEW.issued_at
  AND json_extract(NEW.canonical_json, '$.grantDigest') = NEW.grant_digest
  AND EXISTS (
    SELECT 1 FROM audit_events AS audit
    WHERE audit.sequence = NEW.audit_sequence
      AND audit.aggregate_type = 'PROJECT_READ_SNAPSHOT_CLEANUP_GRANT'
      AND audit.aggregate_id = NEW.id
      AND audit.event_type = 'PROJECT_READ_SNAPSHOT_CLEANUP_GRANT_ISSUED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.payload_digest = NEW.grant_digest
      AND audit.occurred_at = NEW.issued_at
  )
  AND (
    NEW.eligibility_kind = 'TERMINAL'
    OR NOT EXISTS (
      SELECT 1 FROM project_source_read_authorities AS authority
      WHERE authority.id = NEW.project_read_authority_id
         OR authority.snapshot_id = NEW.snapshot_id
         OR authority.snapshot_leaf_realpath = NEW.snapshot_leaf_realpath
    )
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid project-read snapshot cleanup grant');
END;

CREATE TRIGGER project_read_snapshot_cleanup_grants_no_update
BEFORE UPDATE ON project_read_snapshot_cleanup_grants
BEGIN
  SELECT RAISE(ABORT, 'project-read snapshot cleanup grants are immutable');
END;

CREATE TRIGGER project_read_snapshot_cleanup_grants_no_delete
BEFORE DELETE ON project_read_snapshot_cleanup_grants
BEGIN
  SELECT RAISE(ABORT, 'project-read snapshot cleanup grants cannot be deleted');
END;

CREATE TRIGGER project_source_read_authorities_no_preconsumed_orphan_identity
BEFORE INSERT ON project_source_read_authorities
WHEN EXISTS (
  SELECT 1 FROM project_read_snapshot_cleanup_grants AS grant
  WHERE grant.project_read_authority_id = NEW.id
     OR grant.snapshot_id = NEW.snapshot_id
     OR grant.snapshot_leaf_realpath = NEW.snapshot_leaf_realpath
)
BEGIN
  SELECT RAISE(ABORT, 'project-source read authority collides with retained cleanup grant');
END;

CREATE TABLE project_read_snapshot_cleanup_observations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  grant_id TEXT NOT NULL UNIQUE,
  grant_digest TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('DELETED', 'ALREADY_ABSENT', 'RETAINED_UNSAFE', 'FAILED')
  ),
  observed_at TEXT NOT NULL,
  canonical_json TEXT NOT NULL CHECK (
    json_valid(canonical_json) AND json_type(canonical_json) = 'object'
  ),
  observation_digest TEXT NOT NULL UNIQUE,
  audit_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  UNIQUE (id, observation_digest),
  FOREIGN KEY (grant_id, grant_digest)
    REFERENCES project_read_snapshot_cleanup_grants(id, grant_digest) ON DELETE RESTRICT,
  CHECK (length(observation_digest) = 71 AND substr(observation_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE TRIGGER project_read_snapshot_cleanup_observations_insert_guard
BEFORE INSERT ON project_read_snapshot_cleanup_observations
WHEN COALESCE(
  json_extract(NEW.canonical_json, '$.schemaVersion') = NEW.schema_version
  AND json_extract(NEW.canonical_json, '$.id') = NEW.id
  AND json_extract(NEW.canonical_json, '$.grantId') = NEW.grant_id
  AND json_extract(NEW.canonical_json, '$.grantDigest') = NEW.grant_digest
  AND json_extract(NEW.canonical_json, '$.disposition') = NEW.disposition
  AND json_extract(NEW.canonical_json, '$.observedAt') = NEW.observed_at
  AND json_extract(NEW.canonical_json, '$.observationDigest') = NEW.observation_digest
  AND EXISTS (
    SELECT 1 FROM audit_events AS audit
    WHERE audit.sequence = NEW.audit_sequence
      AND audit.aggregate_type = 'PROJECT_READ_SNAPSHOT_CLEANUP_OBSERVATION'
      AND audit.aggregate_id = NEW.id
      AND audit.event_type = 'PROJECT_READ_SNAPSHOT_CLEANUP_OBSERVED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.payload_digest = NEW.observation_digest
      AND audit.occurred_at = NEW.observed_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid project-read snapshot cleanup observation');
END;

CREATE TRIGGER project_read_snapshot_cleanup_observations_no_update
BEFORE UPDATE ON project_read_snapshot_cleanup_observations
BEGIN
  SELECT RAISE(ABORT, 'project-read snapshot cleanup observations are immutable');
END;

CREATE TRIGGER project_read_snapshot_cleanup_observations_no_delete
BEFORE DELETE ON project_read_snapshot_cleanup_observations
BEGIN
  SELECT RAISE(ABORT, 'project-read snapshot cleanup observations cannot be deleted');
END;

CREATE TABLE project_read_snapshot_cleanup_outcomes (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  grant_id TEXT NOT NULL UNIQUE,
  grant_digest TEXT NOT NULL,
  cleanup_observation_id TEXT NOT NULL UNIQUE,
  cleanup_observation_digest TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('DELETED', 'ALREADY_ABSENT', 'RETAINED_UNSAFE', 'FAILED')
  ),
  resolved_at TEXT NOT NULL,
  canonical_json TEXT NOT NULL CHECK (
    json_valid(canonical_json) AND json_type(canonical_json) = 'object'
  ),
  outcome_digest TEXT NOT NULL UNIQUE,
  audit_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  UNIQUE (id, outcome_digest),
  FOREIGN KEY (grant_id, grant_digest)
    REFERENCES project_read_snapshot_cleanup_grants(id, grant_digest) ON DELETE RESTRICT,
  FOREIGN KEY (cleanup_observation_id, cleanup_observation_digest)
    REFERENCES project_read_snapshot_cleanup_observations(id, observation_digest) ON DELETE RESTRICT,
  CHECK (length(outcome_digest) = 71 AND substr(outcome_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE TRIGGER project_read_snapshot_cleanup_outcomes_insert_guard
BEFORE INSERT ON project_read_snapshot_cleanup_outcomes
WHEN COALESCE(
  json_extract(NEW.canonical_json, '$.schemaVersion') = NEW.schema_version
  AND json_extract(NEW.canonical_json, '$.id') = NEW.id
  AND json_extract(NEW.canonical_json, '$.grantId') = NEW.grant_id
  AND json_extract(NEW.canonical_json, '$.grantDigest') = NEW.grant_digest
  AND json_extract(NEW.canonical_json, '$.cleanupObservationId') = NEW.cleanup_observation_id
  AND json_extract(NEW.canonical_json, '$.cleanupObservationDigest') = NEW.cleanup_observation_digest
  AND json_extract(NEW.canonical_json, '$.disposition') = NEW.disposition
  AND json_extract(NEW.canonical_json, '$.resolvedAt') = NEW.resolved_at
  AND json_extract(NEW.canonical_json, '$.outcomeDigest') = NEW.outcome_digest
  AND EXISTS (
    SELECT 1 FROM audit_events AS audit
    WHERE audit.sequence = NEW.audit_sequence
      AND audit.aggregate_type = 'PROJECT_READ_SNAPSHOT_CLEANUP_OUTCOME'
      AND audit.aggregate_id = NEW.id
      AND audit.event_type = 'PROJECT_READ_SNAPSHOT_CLEANUP_RESOLVED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.payload_digest = NEW.outcome_digest
      AND audit.occurred_at = NEW.resolved_at
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid project-read snapshot cleanup outcome');
END;

CREATE TRIGGER project_read_snapshot_cleanup_outcomes_no_update
BEFORE UPDATE ON project_read_snapshot_cleanup_outcomes
BEGIN
  SELECT RAISE(ABORT, 'project-read snapshot cleanup outcomes are immutable');
END;

CREATE TRIGGER project_read_snapshot_cleanup_outcomes_no_delete
BEFORE DELETE ON project_read_snapshot_cleanup_outcomes
BEGIN
  SELECT RAISE(ABORT, 'project-read snapshot cleanup outcomes cannot be deleted');
END;

CREATE TABLE project_read_snapshot_cleanup_consumptions (
  grant_id TEXT PRIMARY KEY,
  grant_digest TEXT NOT NULL,
  outcome_id TEXT NOT NULL UNIQUE REFERENCES project_read_snapshot_cleanup_outcomes(id) ON DELETE RESTRICT,
  outcome_digest TEXT NOT NULL UNIQUE,
  consumed_at TEXT NOT NULL,
  outcome_audit_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  FOREIGN KEY (grant_id, grant_digest)
    REFERENCES project_read_snapshot_cleanup_grants(id, grant_digest) ON DELETE RESTRICT,
  FOREIGN KEY (outcome_id, outcome_digest)
    REFERENCES project_read_snapshot_cleanup_outcomes(id, outcome_digest) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER project_read_snapshot_cleanup_consumptions_insert_guard
BEFORE INSERT ON project_read_snapshot_cleanup_consumptions
WHEN NOT EXISTS (
  SELECT 1
  FROM project_read_snapshot_cleanup_outcomes AS outcome
  JOIN audit_events AS audit ON audit.sequence = NEW.outcome_audit_sequence
  WHERE outcome.id = NEW.outcome_id
    AND outcome.outcome_digest = NEW.outcome_digest
    AND outcome.grant_id = NEW.grant_id
    AND outcome.grant_digest = NEW.grant_digest
    AND outcome.resolved_at = NEW.consumed_at
    AND outcome.audit_sequence = NEW.outcome_audit_sequence
    AND audit.payload_digest = NEW.outcome_digest
)
BEGIN
  SELECT RAISE(ABORT, 'invalid project-read cleanup Grant consumption');
END;

CREATE TRIGGER project_read_snapshot_cleanup_consumptions_no_update
BEFORE UPDATE ON project_read_snapshot_cleanup_consumptions
BEGIN
  SELECT RAISE(ABORT, 'project-read cleanup Grant consumptions are immutable');
END;

CREATE TRIGGER project_read_snapshot_cleanup_consumptions_no_delete
BEFORE DELETE ON project_read_snapshot_cleanup_consumptions
BEGIN
  SELECT RAISE(ABORT, 'project-read cleanup Grant consumptions cannot be deleted');
END;
