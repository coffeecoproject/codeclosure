CREATE TABLE worker_authority_closure_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

-- M1 has no durable Fact, Human Decision, or project-source resolver yet. A
-- retained Context Manifest therefore may contain only compiler-owned Goal and
-- success-criterion entries, with no Candidate binding or source omissions.
INSERT INTO worker_authority_closure_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM context_manifests AS context
  WHERE context.candidate_generation_id IS NOT NULL
    OR context.candidate_digest IS NOT NULL
    OR json_array_length(context.omission_decisions_json) <> 0
    OR EXISTS (
      SELECT 1
      FROM json_each(context.entries_json) AS entry
      WHERE json_type(entry.value) <> 'object'
        OR json_type(entry.value, '$.kind') <> 'text'
        OR json_type(entry.value, '$.authorityClass') <> 'text'
        OR json_extract(entry.value, '$.kind') NOT IN ('GOAL', 'SUCCESS_CRITERION')
        OR (
          json_extract(entry.value, '$.kind') IN ('GOAL', 'SUCCESS_CRITERION')
          AND json_extract(entry.value, '$.authorityClass') <> 'GOAL_AUTHORITY'
        )
    )
)
OR EXISTS (
  SELECT 1
  FROM policy_bundles AS policy
  WHERE NOT EXISTS (
    SELECT 1
    FROM audit_events AS audit
    WHERE audit.aggregate_type = 'POLICY'
      AND audit.aggregate_id = policy.id
      AND audit.event_type = 'POLICY_BUNDLE_INSTALLED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.command_id IS NULL
      AND audit.before_version IS NULL
      AND audit.after_version IS NULL
      AND audit.payload_digest = policy.bundle_digest
      AND audit.occurred_at = policy.installed_at
  )
)
OR EXISTS (
  SELECT 1
  FROM worker_event_receipts AS receipt
  WHERE NOT EXISTS (
    SELECT 1
    FROM worker_dispatch_claims AS claim
    WHERE claim.attempt_id = receipt.attempt_id
      AND claim.workflow_id = receipt.workflow_id
      AND claim.context_manifest_id = receipt.context_manifest_id
      AND receipt.received_at >= claim.claimed_at
  )
)
OR EXISTS (
  SELECT 1
  FROM worker_event_receipts AS receipt
  WHERE receipt.disposition = 'ADMITTED'
    AND NOT EXISTS (
      SELECT 1
      FROM worker_dispatch_claims AS claim
      WHERE claim.attempt_id = receipt.attempt_id
        AND claim.workflow_id = receipt.workflow_id
        AND claim.workflow_version = receipt.observed_workflow_version
        AND claim.worker_session_id = receipt.worker_session_id
        AND claim.context_manifest_id = receipt.context_manifest_id
        AND claim.context_manifest_digest = receipt.context_manifest_digest
        AND claim.package_digest = receipt.package_digest
        AND receipt.received_at >= claim.claimed_at
    )
)
OR EXISTS (
  SELECT 1
  FROM attempts AS attempt
  JOIN worker_dispatch_claims AS claim ON claim.attempt_id = attempt.id
  WHERE attempt.status <> 'RUNNING'
    AND (attempt.ended_at IS NULL OR attempt.ended_at < claim.claimed_at)
);

DROP TABLE worker_authority_closure_migration_guard;

CREATE TRIGGER context_manifests_m1_source_insert_guard
BEFORE INSERT ON context_manifests
WHEN NEW.candidate_generation_id IS NOT NULL
  OR NEW.candidate_digest IS NOT NULL
  OR json_array_length(NEW.omission_decisions_json) <> 0
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.entries_json) AS entry
    WHERE json_type(entry.value) <> 'object'
      OR json_type(entry.value, '$.kind') <> 'text'
      OR json_type(entry.value, '$.authorityClass') <> 'text'
      OR json_extract(entry.value, '$.kind') NOT IN ('GOAL', 'SUCCESS_CRITERION')
      OR (
        json_extract(entry.value, '$.kind') IN ('GOAL', 'SUCCESS_CRITERION')
        AND json_extract(entry.value, '$.authorityClass') <> 'GOAL_AUTHORITY'
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'M1 Context cannot contain unresolved source authority');
END;

CREATE TRIGGER attempts_dispatch_causal_update_guard
BEFORE UPDATE OF status, failure_class, termination_reason, ended_at ON attempts
WHEN NEW.status <> 'RUNNING'
  AND EXISTS (
    SELECT 1
    FROM worker_dispatch_claims AS claim
    WHERE claim.attempt_id = NEW.id
      AND (NEW.ended_at IS NULL OR NEW.ended_at < claim.claimed_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'Attempt cannot end before its Worker dispatch claim');
END;

CREATE TRIGGER policy_bundles_audited_insert_guard
BEFORE INSERT ON policy_bundles
WHEN NOT EXISTS (
  SELECT 1
  FROM audit_events AS audit
  WHERE audit.aggregate_type = 'POLICY'
    AND audit.aggregate_id = NEW.id
    AND audit.event_type = 'POLICY_BUNDLE_INSTALLED'
    AND audit.actor_type = 'RUNTIME'
    AND audit.command_id IS NULL
    AND audit.before_version IS NULL
    AND audit.after_version IS NULL
    AND audit.payload_digest = NEW.bundle_digest
    AND audit.occurred_at = NEW.installed_at
)
BEGIN
  SELECT RAISE(ABORT, 'Policy Bundle requires matching installation audit authority');
END;

DROP TRIGGER worker_event_receipts_insert_guard;

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
        SELECT 1
        FROM workflows
        JOIN worker_dispatch_claims AS claim ON claim.attempt_id = NEW.attempt_id
        WHERE workflows.id = NEW.workflow_id
          AND workflows.version = NEW.observed_workflow_version
          AND claim.workflow_id = NEW.workflow_id
          AND claim.context_manifest_id = NEW.context_manifest_id
          AND NEW.received_at >= workflows.updated_at
          AND NEW.received_at >= claim.claimed_at
      ))
    OR
    (NEW.disposition = 'ADMITTED'
      AND EXISTS (
        SELECT 1
        FROM attempts AS attempt
        JOIN context_manifests AS context ON context.id = NEW.context_manifest_id
        JOIN workflows AS workflow ON workflow.id = NEW.workflow_id
        JOIN processed_commands AS command ON command.command_id = NEW.internal_command_id
        JOIN worker_dispatch_claims AS claim ON claim.attempt_id = NEW.attempt_id
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
          AND claim.workflow_id = NEW.workflow_id
          AND claim.workflow_version = NEW.observed_workflow_version
          AND claim.worker_session_id = NEW.worker_session_id
          AND claim.context_manifest_id = NEW.context_manifest_id
          AND claim.context_manifest_digest = NEW.context_manifest_digest
          AND claim.package_digest = NEW.package_digest
          AND NEW.received_at >= claim.claimed_at
      ))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid Worker Event receipt authority binding');
END;
