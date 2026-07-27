CREATE TABLE context_worker_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

-- Slice 4 keeps retained authority only when it already satisfies the new
-- Context/Attempt ownership closure. It never invents a missing manifest.
INSERT INTO context_worker_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM context_manifests AS context
  WHERE context.schema_version <> 1
    OR length(trim(context.compiler_version)) = 0
    OR context.phase NOT IN ('DISCOVERY', 'PLAN', 'IMPLEMENT')
    OR json_type(context.entries_json) <> 'array'
    OR json_type(context.omission_decisions_json) <> 'array'
    OR NOT (
      length(context.id) BETWEEN 9 AND 136
      AND substr(context.id, 1, 8) = 'context_'
      AND substr(context.id, 9) NOT GLOB '*[^a-z0-9-]*'
      AND substr(context.id, 9, 1) GLOB '[a-z0-9]'
      AND substr(context.id, -1, 1) GLOB '[a-z0-9]'
    )
    OR NOT (
      length(context.created_at) = 24
      AND context.created_at GLOB '????-??-??T??:??:??.???Z'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', context.created_at) = context.created_at
    )
    OR (context.candidate_generation_id IS NULL) <> (context.candidate_digest IS NULL)
    OR EXISTS (
      SELECT 1
      FROM attempts AS attempt
      JOIN workflows AS workflow ON workflow.id = attempt.workflow_id
      WHERE attempt.id = context.attempt_id
        AND (
          attempt.context_manifest_id <> context.id
          OR attempt.worker_session_ref IS NULL
          OR context.workflow_id <> workflow.id
          OR context.goal_id <> workflow.goal_id
          OR context.goal_revision <> workflow.goal_revision
          OR context.phase <> attempt.phase
          OR context.phase <> workflow.phase
          OR context.workflow_version <> workflow.version
          OR context.created_at < attempt.started_at
        )
    )
    OR NOT EXISTS (
      SELECT 1 FROM attempts WHERE attempts.id = context.attempt_id
    )
    OR length(context.policy_bundle_digest) <> 71
    OR substr(context.policy_bundle_digest, 1, 7) <> 'sha256:'
    OR substr(context.policy_bundle_digest, 8) GLOB '*[^0-9a-f]*'
    OR length(context.capability_grant_digest) <> 71
    OR substr(context.capability_grant_digest, 1, 7) <> 'sha256:'
    OR substr(context.capability_grant_digest, 8) GLOB '*[^0-9a-f]*'
    OR length(context.response_contract_digest) <> 71
    OR substr(context.response_contract_digest, 1, 7) <> 'sha256:'
    OR substr(context.response_contract_digest, 8) GLOB '*[^0-9a-f]*'
    OR length(context.package_digest) <> 71
    OR substr(context.package_digest, 1, 7) <> 'sha256:'
    OR substr(context.package_digest, 8) GLOB '*[^0-9a-f]*'
    OR length(context.manifest_digest) <> 71
    OR substr(context.manifest_digest, 1, 7) <> 'sha256:'
    OR substr(context.manifest_digest, 8) GLOB '*[^0-9a-f]*'
)
OR EXISTS (
  SELECT 1
  FROM attempts AS attempt
  WHERE attempt.worker_session_ref IS NOT NULL
    AND attempt.context_manifest_id IS NULL
)
OR EXISTS (
  SELECT 1
  FROM policy_bundles AS policy
  WHERE policy.schema_version <> 1
    OR length(trim(policy.policy_version)) = 0
    OR json_type(policy.checker_identities_json) <> 'array'
    OR json_type(policy.canonical_content_json) <> 'object'
    OR NOT (
      length(policy.id) BETWEEN 8 AND 135
      AND substr(policy.id, 1, 7) = 'policy_'
      AND substr(policy.id, 8) NOT GLOB '*[^a-z0-9-]*'
      AND substr(policy.id, 8, 1) GLOB '[a-z0-9]'
      AND substr(policy.id, -1, 1) GLOB '[a-z0-9]'
    )
    OR length(policy.bundle_digest) <> 71
    OR substr(policy.bundle_digest, 1, 7) <> 'sha256:'
    OR substr(policy.bundle_digest, 8) GLOB '*[^0-9a-f]*'
    OR NOT (
      length(policy.installed_at) = 24
      AND policy.installed_at GLOB '????-??-??T??:??:??.???Z'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', policy.installed_at) = policy.installed_at
    )
);

DROP TABLE context_worker_migration_guard;

CREATE TRIGGER attempts_worker_context_insert_guard
BEFORE INSERT ON attempts
WHEN NEW.worker_session_ref IS NOT NULL AND NEW.context_manifest_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Worker-bound Attempt requires a Context Manifest');
END;

CREATE TRIGGER attempts_worker_context_update_guard
BEFORE UPDATE OF context_manifest_id, worker_session_ref ON attempts
WHEN NEW.context_manifest_id IS NOT OLD.context_manifest_id
  OR NEW.worker_session_ref IS NOT OLD.worker_session_ref
BEGIN
  SELECT RAISE(ABORT, 'Attempt Context and Worker bindings are immutable');
END;

CREATE TABLE worker_dispatch_claims (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL CHECK (
    workflow_version >= 1 AND workflow_version <= 9007199254740991
  ),
  worker_session_id TEXT NOT NULL,
  context_manifest_id TEXT NOT NULL UNIQUE REFERENCES context_manifests(id) ON DELETE RESTRICT,
  context_manifest_digest TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  claimed_at TEXT NOT NULL
) STRICT;

CREATE TABLE worker_event_receipts (
  event_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  payload_digest TEXT NOT NULL,
  worker_session_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  observed_workflow_version INTEGER NOT NULL CHECK (
    observed_workflow_version >= 1 AND observed_workflow_version <= 9007199254740991
  ),
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE RESTRICT,
  context_manifest_id TEXT NOT NULL REFERENCES context_manifests(id) ON DELETE RESTRICT,
  context_manifest_digest TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('ADMITTED', 'IGNORED')),
  internal_command_id TEXT UNIQUE REFERENCES processed_commands(command_id) ON DELETE RESTRICT,
  reason_code TEXT,
  received_at TEXT NOT NULL,
  CHECK (
    (disposition = 'ADMITTED' AND internal_command_id IS NOT NULL AND reason_code IS NULL)
    OR
    (disposition = 'IGNORED' AND internal_command_id IS NULL AND length(trim(reason_code)) > 0)
  )
) STRICT;

CREATE INDEX worker_event_receipts_attempt_idx
  ON worker_event_receipts(attempt_id, received_at);

CREATE TRIGGER policy_bundles_slice4_insert_guard
BEFORE INSERT ON policy_bundles
WHEN NOT (
  NEW.schema_version = 1
  AND length(trim(NEW.policy_version)) > 0
  AND json_type(NEW.checker_identities_json) = 'array'
  AND json_type(NEW.canonical_content_json) = 'object'
  AND length(NEW.id) BETWEEN 8 AND 135
  AND substr(NEW.id, 1, 7) = 'policy_'
  AND substr(NEW.id, 8) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 8, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND length(NEW.bundle_digest) = 71
  AND substr(NEW.bundle_digest, 1, 7) = 'sha256:'
  AND substr(NEW.bundle_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.installed_at) = 24
  AND NEW.installed_at GLOB '????-??-??T??:??:??.???Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.installed_at) = NEW.installed_at
)
BEGIN
  SELECT RAISE(ABORT, 'invalid Policy Bundle authority record');
END;

CREATE TRIGGER context_manifests_slice4_insert_guard
BEFORE INSERT ON context_manifests
WHEN NOT (
  NEW.schema_version = 1
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
    WHERE attempt.id = NEW.attempt_id
      AND attempt.context_manifest_id = NEW.id
      AND attempt.worker_session_ref IS NOT NULL
      AND NEW.workflow_id = workflow.id
      AND NEW.goal_id = workflow.goal_id
      AND NEW.goal_revision = workflow.goal_revision
      AND NEW.phase = attempt.phase
      AND NEW.phase = workflow.phase
      AND NEW.workflow_version = workflow.version
      AND NEW.created_at >= attempt.started_at
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
  NEW.schema_version = 1
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
  AND length(NEW.claimed_at) = 24
  AND NEW.claimed_at GLOB '????-??-??T??:??:??.???Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.claimed_at) = NEW.claimed_at
  AND EXISTS (
    SELECT 1
    FROM workflows AS workflow
    JOIN attempts AS attempt ON attempt.id = NEW.attempt_id
    JOIN context_manifests AS context ON context.id = NEW.context_manifest_id
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
      AND NEW.claimed_at >= workflow.updated_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Worker dispatch is not eligible');
END;

CREATE TRIGGER worker_event_receipts_insert_guard
BEFORE INSERT ON worker_event_receipts
WHEN NOT (
  length(NEW.event_id) BETWEEN 14 AND 141
  AND substr(NEW.event_id, 1, 13) = 'worker-event_'
  AND substr(NEW.event_id, 14) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.event_id, 14, 1) GLOB '[a-z0-9]'
  AND substr(NEW.event_id, -1, 1) GLOB '[a-z0-9]'
  AND length(NEW.payload_digest) = 71
  AND substr(NEW.payload_digest, 1, 7) = 'sha256:'
  AND substr(NEW.payload_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.context_manifest_digest) = 71
  AND substr(NEW.context_manifest_digest, 1, 7) = 'sha256:'
  AND substr(NEW.context_manifest_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.package_digest) = 71
  AND substr(NEW.package_digest, 1, 7) = 'sha256:'
  AND substr(NEW.package_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.received_at) = 24
  AND NEW.received_at GLOB '????-??-??T??:??:??.???Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.received_at) = NEW.received_at
  AND EXISTS (
    SELECT 1 FROM attempts
    WHERE attempts.id = NEW.attempt_id
      AND attempts.workflow_id = NEW.workflow_id
  )
  AND (
    (NEW.disposition = 'IGNORED'
      AND EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = NEW.workflow_id
          AND workflows.version = NEW.observed_workflow_version
          AND NEW.received_at >= workflows.updated_at
      ))
    OR
    (NEW.disposition = 'ADMITTED'
      AND EXISTS (
        SELECT 1
        FROM attempts AS attempt
        JOIN context_manifests AS context ON context.id = NEW.context_manifest_id
        JOIN workflows AS workflow ON workflow.id = NEW.workflow_id
        JOIN processed_commands AS command ON command.command_id = NEW.internal_command_id
        WHERE attempt.id = NEW.attempt_id
          AND attempt.workflow_id = workflow.id
          AND attempt.context_manifest_id = context.id
          AND attempt.worker_session_ref = NEW.worker_session_id
          AND context.manifest_digest = NEW.context_manifest_digest
          AND context.package_digest = NEW.package_digest
          AND context.workflow_version = NEW.observed_workflow_version
          AND workflow.version = NEW.observed_workflow_version + 1
          AND command.aggregate_type = 'WORKFLOW'
          AND command.aggregate_id = workflow.id
      ))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid Worker Event receipt authority binding');
END;

CREATE TRIGGER worker_dispatch_claims_no_update
BEFORE UPDATE ON worker_dispatch_claims
BEGIN
  SELECT RAISE(ABORT, 'Worker dispatch claims are immutable');
END;

CREATE TRIGGER worker_dispatch_claims_no_delete
BEFORE DELETE ON worker_dispatch_claims
BEGIN
  SELECT RAISE(ABORT, 'Worker dispatch claims are immutable');
END;

CREATE TRIGGER worker_event_receipts_no_update
BEFORE UPDATE ON worker_event_receipts
BEGIN
  SELECT RAISE(ABORT, 'Worker Event receipts are immutable');
END;

CREATE TRIGGER worker_event_receipts_no_delete
BEFORE DELETE ON worker_event_receipts
BEGIN
  SELECT RAISE(ABORT, 'Worker Event receipts are immutable');
END;
