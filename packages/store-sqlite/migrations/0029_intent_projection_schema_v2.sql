DROP TRIGGER intent_projection_revisions_no_update;
DROP TRIGGER intent_projection_revisions_no_delete;

CREATE TABLE intent_projection_revisions_v2 (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
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
    REFERENCES intent_projection_revisions_v2(id, revision) ON DELETE RESTRICT,
  CHECK (
    (revision = 1 AND parent_revision IS NULL) OR
    (revision > 1 AND parent_revision = revision - 1)
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.revision') = revision),
  CHECK (json_extract(record_json, '$.intakeRunId') = intake_run_id),
  CHECK (json_extract(record_json, '$.projectionDigest') = projection_digest)
) STRICT;

INSERT INTO intent_projection_revisions_v2(
  id, revision, schema_version, intake_run_id, parent_revision, proposal_id,
  proposal_digest, projection_digest, created_at, record_json
)
SELECT
  id, revision, schema_version, intake_run_id, parent_revision, proposal_id,
  proposal_digest, projection_digest, created_at, record_json
FROM intent_projection_revisions;

DROP TABLE intent_projection_revisions;
ALTER TABLE intent_projection_revisions_v2 RENAME TO intent_projection_revisions;

CREATE TRIGGER intent_projection_revisions_no_update
BEFORE UPDATE ON intent_projection_revisions
BEGIN
  SELECT RAISE(ABORT, 'Intent Projection revisions are immutable');
END;

CREATE TRIGGER intent_projection_revisions_no_delete
BEFORE DELETE ON intent_projection_revisions
BEGIN
  SELECT RAISE(ABORT, 'Intent Projection revisions are immutable');
END;
