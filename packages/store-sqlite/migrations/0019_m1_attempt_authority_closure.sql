CREATE TABLE m1_attempt_authority_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

CREATE TRIGGER m1_attempt_authority_migration_guard_reject
BEFORE INSERT ON m1_attempt_authority_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(ABORT, 'legacy-m1-attempt-authority-state');
END;

-- A committed Workflow/Attempt pair must agree in both directions. The Store
-- uses an Attempt-first write order inside one transaction, so a RUNNING
-- Workflow may temporarily point at a terminal Attempt before the Workflow is
-- released; that intermediate state must never survive commit or migration.
INSERT INTO m1_attempt_authority_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM workflows AS workflow
  WHERE (
      workflow.run_status = 'RUNNING'
      AND NOT EXISTS (
        SELECT 1
        FROM attempts AS attempt
        WHERE attempt.id = workflow.active_attempt_id
          AND attempt.workflow_id = workflow.id
          AND attempt.phase = workflow.phase
          AND attempt.status = 'RUNNING'
      )
    )
    OR (
      workflow.run_status <> 'RUNNING'
      AND workflow.active_attempt_id IS NOT NULL
    )
)
OR EXISTS (
  SELECT 1
  FROM attempts AS attempt
  LEFT JOIN workflows AS workflow ON workflow.id = attempt.workflow_id
  WHERE attempt.status = 'RUNNING'
    AND (
      workflow.id IS NULL
      OR workflow.run_status <> 'RUNNING'
      OR workflow.active_attempt_id IS NOT attempt.id
      OR workflow.phase IS NOT attempt.phase
    )
)
OR EXISTS (
  SELECT 1
  FROM attempts AS attempt
  WHERE (
      attempt.context_manifest_id IS NOT NULL
      OR attempt.worker_session_ref IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM context_manifests AS context_manifest
        WHERE context_manifest.attempt_id = attempt.id
      )
    )
    AND attempt.status = 'RESULT_RECORDED'
    AND NOT (
      (
        attempt.phase IN ('DISCOVERY', 'PLAN')
        AND attempt.termination_reason = 'WORKER_RESULT:PROPOSALS'
      )
      OR (
        attempt.phase = 'IMPLEMENT'
        AND attempt.termination_reason = 'WORKER_RESULT:COMPLETION_REQUEST'
      )
    )
);

-- A Worker-bound failure reason is runtime protocol authority, not free-form
-- diagnostic text. Every retained Worker failure must use one closed mapping.
INSERT INTO m1_attempt_authority_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM attempts AS attempt
  WHERE (
      attempt.context_manifest_id IS NOT NULL
      OR attempt.worker_session_ref IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM context_manifests AS context_manifest
        WHERE context_manifest.attempt_id = attempt.id
      )
    )
    AND attempt.status = 'FAILED'
    AND NOT (
      (
        attempt.termination_reason = 'WORKER_BACKEND_FAILURE'
        AND attempt.failure_class = 'TRANSIENT_BACKEND'
      )
      OR (
        attempt.termination_reason = 'WORKER_PORT_INVOCATION_FAILED'
        AND attempt.failure_class = 'ABRUPT_TERMINATION'
      )
      OR (
        attempt.termination_reason IN (
          'WORKER_PORT_NON_ASYNC_STREAM',
          'WORKER_STREAM_NO_TERMINAL_EVENT',
          'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT'
        )
        AND attempt.failure_class = 'PROTOCOL_ERROR'
      )
    )
);

-- The current Workflow projection must be the exact APPLIED command/audit
-- boundary for its current version. This remains true after later Attempt
-- history exists and detects raw rewrites of a terminal Workflow status.
INSERT INTO m1_attempt_authority_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM workflows AS workflow
  WHERE (
    SELECT COUNT(*)
    FROM audit_events AS audit
    JOIN processed_commands AS command ON command.command_id = audit.command_id
    WHERE audit.aggregate_type = 'WORKFLOW'
      AND audit.aggregate_id = workflow.id
      AND audit.actor_type = 'RUNTIME'
      AND audit.after_version = workflow.version
      AND audit.occurred_at = workflow.updated_at
      AND (
        (workflow.version = 1 AND audit.before_version IS NULL)
        OR audit.before_version = workflow.version - 1
      )
      AND command.completed_at = workflow.updated_at
      AND json_extract(command.outcome_json, '$.schemaVersion') = 3
      AND json_extract(command.outcome_json, '$.disposition') = 'APPLIED'
      AND json_extract(command.outcome_json, '$.target.aggregateType') = command.aggregate_type
      AND json_extract(command.outcome_json, '$.target.aggregateId') = command.aggregate_id
      AND json_extract(command.outcome_json, '$.goalId') = workflow.goal_id
      AND json_extract(command.outcome_json, '$.workflow.id') = workflow.id
      AND json_extract(command.outcome_json, '$.workflow.version') = workflow.version
      AND json_extract(command.outcome_json, '$.workflow.phase') = workflow.phase
      AND json_extract(command.outcome_json, '$.workflow.runStatus') = workflow.run_status
      AND json_extract(command.outcome_json, '$.output.commandId') = command.command_id
      AND json_extract(command.outcome_json, '$.output.ok') = 1
      AND json_extract(command.outcome_json, '$.output.goalId') = workflow.goal_id
      AND json_extract(command.outcome_json, '$.output.workflowVersion') = workflow.version
      AND json_extract(command.outcome_json, '$.output.phase') = workflow.phase
      AND json_extract(command.outcome_json, '$.output.runStatus') = workflow.run_status
  ) <> 1
);

-- A terminal Attempt is historical authority. Its paired Attempt/Workflow
-- audits and processed outcome must preserve the exact status mapping from the
-- version at which it ended, even after the Workflow later advances.
INSERT INTO m1_attempt_authority_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM attempts AS attempt
  JOIN workflows AS workflow ON workflow.id = attempt.workflow_id
  WHERE attempt.status <> 'RUNNING'
    AND (
      SELECT COUNT(*)
      FROM audit_events AS attempt_audit
      JOIN audit_events AS workflow_audit
        ON workflow_audit.command_id = attempt_audit.command_id
       AND workflow_audit.before_version = attempt_audit.before_version
       AND workflow_audit.after_version = attempt_audit.after_version
      JOIN processed_commands AS command ON command.command_id = attempt_audit.command_id
      WHERE attempt_audit.aggregate_type = 'ATTEMPT'
        AND attempt_audit.aggregate_id = attempt.id
        AND attempt_audit.actor_type = 'RUNTIME'
        AND attempt_audit.event_type IN (
          'ATTEMPT_FINISHED',
          'ATTEMPT_INTERRUPTED_BY_WORKFLOW_CANCELLATION'
        )
        AND attempt_audit.before_version IS NOT NULL
        AND attempt_audit.after_version = attempt_audit.before_version + 1
        AND attempt_audit.occurred_at = attempt.ended_at
        AND workflow_audit.aggregate_type = 'WORKFLOW'
        AND workflow_audit.aggregate_id = workflow.id
        AND workflow_audit.actor_type = 'RUNTIME'
        AND workflow_audit.event_type IN (
          'WORKFLOW_ATTEMPT_FINISHED',
          'WORKFLOW_CANCELLED'
        )
        AND workflow_audit.payload_digest = attempt_audit.payload_digest
        AND workflow_audit.occurred_at = attempt.ended_at
        AND command.completed_at = attempt.ended_at
        AND workflow.version >= attempt_audit.after_version
        AND workflow.updated_at >= attempt.ended_at
        AND json_extract(command.outcome_json, '$.schemaVersion') = 3
        AND json_extract(command.outcome_json, '$.disposition') = 'APPLIED'
        AND json_extract(command.outcome_json, '$.target.aggregateType') = command.aggregate_type
        AND json_extract(command.outcome_json, '$.target.aggregateId') = command.aggregate_id
        AND json_extract(command.outcome_json, '$.goalId') = workflow.goal_id
        AND json_extract(command.outcome_json, '$.workflow.id') = workflow.id
        AND json_extract(command.outcome_json, '$.workflow.version') = attempt_audit.after_version
        AND json_extract(command.outcome_json, '$.workflow.phase') = attempt.phase
        AND json_extract(command.outcome_json, '$.output.commandId') = command.command_id
        AND json_extract(command.outcome_json, '$.output.ok') = 1
        AND json_extract(command.outcome_json, '$.output.goalId') = workflow.goal_id
        AND json_extract(command.outcome_json, '$.output.workflowVersion') =
          attempt_audit.after_version
        AND json_extract(command.outcome_json, '$.output.phase') = attempt.phase
        AND json_extract(command.outcome_json, '$.output.runStatus') =
          json_extract(command.outcome_json, '$.workflow.runStatus')
        AND (
          (
            attempt.status = 'INTERRUPTED'
            AND substr(
              attempt.termination_reason,
              1,
              length('WORKFLOW_CANCELLED:')
            ) = 'WORKFLOW_CANCELLED:'
            AND length(
              trim(
                substr(
                  attempt.termination_reason,
                  length('WORKFLOW_CANCELLED:') + 1
                )
              )
            ) > 0
            AND attempt_audit.event_type =
              'ATTEMPT_INTERRUPTED_BY_WORKFLOW_CANCELLATION'
            AND workflow_audit.event_type = 'WORKFLOW_CANCELLED'
            AND command.aggregate_type = 'GOAL'
            AND command.aggregate_id = workflow.goal_id
            AND json_extract(command.outcome_json, '$.workflow.runStatus') = 'CANCELLED'
          )
          OR (
            attempt_audit.event_type = 'ATTEMPT_FINISHED'
            AND workflow_audit.event_type = 'WORKFLOW_ATTEMPT_FINISHED'
            AND command.aggregate_type = 'WORKFLOW'
            AND command.aggregate_id = workflow.id
            AND (
              (
                attempt.status = 'RESULT_RECORDED'
                AND json_extract(command.outcome_json, '$.workflow.runStatus') = 'READY'
              )
              OR (
                attempt.status = 'FAILED'
                AND (
                  (
                    attempt.failure_class IN (
                      'TRANSIENT_BACKEND',
                      'TIMEOUT',
                      'ABRUPT_TERMINATION'
                    )
                    AND json_extract(command.outcome_json, '$.workflow.runStatus') = 'BLOCKED'
                  )
                  OR (
                    attempt.failure_class IN (
                      'PROTOCOL_ERROR',
                      'INTEGRITY_VIOLATION',
                      'PERMANENT_BACKEND',
                      'UNKNOWN'
                    )
                    AND json_extract(command.outcome_json, '$.workflow.runStatus') = 'FAILED'
                  )
                )
              )
              OR (
                attempt.status = 'INTERRUPTED'
                AND (
                  (
                    substr(
                      attempt.termination_reason,
                      1,
                      length('RECOVERY_RECONCILIATION:')
                    ) = 'RECOVERY_RECONCILIATION:'
                    AND length(
                      trim(
                        substr(
                          attempt.termination_reason,
                          length('RECOVERY_RECONCILIATION:') + 1
                        )
                      )
                    ) > 0
                    AND json_extract(command.outcome_json, '$.workflow.runStatus') = 'BLOCKED'
                  )
                  OR (
                    (
                      substr(
                        attempt.termination_reason,
                        1,
                        length('USER_REQUEST:')
                      ) = 'USER_REQUEST:'
                      AND length(
                        trim(
                          substr(
                            attempt.termination_reason,
                            length('USER_REQUEST:') + 1
                          )
                        )
                      ) > 0
                    )
                    OR (
                      substr(
                        attempt.termination_reason,
                        1,
                        length('RUNTIME_SHUTDOWN:')
                      ) = 'RUNTIME_SHUTDOWN:'
                      AND length(
                        trim(
                          substr(
                            attempt.termination_reason,
                            length('RUNTIME_SHUTDOWN:') + 1
                          )
                        )
                      ) > 0
                    )
                  )
                  AND json_extract(command.outcome_json, '$.workflow.runStatus') IN (
                    'READY',
                    'BLOCKED'
                  )
                )
              )
            )
          )
        )
    ) <> 1
);

DROP TRIGGER m1_attempt_authority_migration_guard_reject;
DROP TABLE m1_attempt_authority_migration_guard;

-- The Store terminalizes the active Attempt first, then releases or advances
-- its Workflow in the same transaction. A direct Workflow-first release would
-- otherwise strand a RUNNING Attempt without an owning RUNNING Workflow.
CREATE TRIGGER workflows_running_attempt_release_guard
BEFORE UPDATE OF phase, run_status, version, active_attempt_id, suspended_reason, updated_at
ON workflows
WHEN OLD.run_status = 'RUNNING'
  AND OLD.active_attempt_id IS NOT NULL
  AND (
    NEW.run_status <> 'RUNNING'
    OR NEW.active_attempt_id IS NOT OLD.active_attempt_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM attempts AS attempt
    WHERE attempt.id = OLD.active_attempt_id
      AND attempt.workflow_id = OLD.id
      AND attempt.phase = OLD.phase
      AND attempt.status IN ('RESULT_RECORDED', 'FAILED', 'INTERRUPTED')
      AND attempt.ended_at = NEW.updated_at
      AND NEW.phase = OLD.phase
      AND NEW.version = OLD.version + 1
      AND NEW.active_attempt_id IS NULL
      AND (
        (
          attempt.status = 'RESULT_RECORDED'
          AND NEW.run_status = 'READY'
          AND NEW.suspended_reason IS NULL
        )
        OR (
          attempt.status = 'FAILED'
          AND NEW.suspended_reason = attempt.termination_reason
          AND (
            (
              attempt.failure_class IN (
                'TRANSIENT_BACKEND',
                'TIMEOUT',
                'ABRUPT_TERMINATION'
              )
              AND NEW.run_status = 'BLOCKED'
            )
            OR (
              attempt.failure_class IN (
                'PROTOCOL_ERROR',
                'INTEGRITY_VIOLATION',
                'PERMANENT_BACKEND',
                'UNKNOWN'
              )
              AND NEW.run_status = 'FAILED'
            )
          )
        )
        OR (
          attempt.status = 'INTERRUPTED'
          AND (
            (
              substr(
                attempt.termination_reason,
                1,
                length('WORKFLOW_CANCELLED:')
              ) = 'WORKFLOW_CANCELLED:'
              AND length(
                trim(
                  substr(
                    attempt.termination_reason,
                    length('WORKFLOW_CANCELLED:') + 1
                  )
                )
              ) > 0
              AND NEW.run_status = 'CANCELLED'
              AND NEW.suspended_reason = substr(
                attempt.termination_reason,
                length('WORKFLOW_CANCELLED:') + 1
              )
            )
            OR (
              substr(
                attempt.termination_reason,
                1,
                length('RECOVERY_RECONCILIATION:')
              ) = 'RECOVERY_RECONCILIATION:'
              AND length(
                trim(
                  substr(
                    attempt.termination_reason,
                    length('RECOVERY_RECONCILIATION:') + 1
                  )
                )
              ) > 0
              AND NEW.run_status = 'BLOCKED'
              AND NEW.suspended_reason = attempt.termination_reason
            )
            OR (
              (
                (
                  substr(attempt.termination_reason, 1, length('USER_REQUEST:')) =
                    'USER_REQUEST:'
                  AND length(
                    trim(
                      substr(
                        attempt.termination_reason,
                        length('USER_REQUEST:') + 1
                      )
                    )
                  ) > 0
                )
                OR (
                  substr(
                    attempt.termination_reason,
                    1,
                    length('RUNTIME_SHUTDOWN:')
                  ) = 'RUNTIME_SHUTDOWN:'
                  AND length(
                    trim(
                      substr(
                        attempt.termination_reason,
                        length('RUNTIME_SHUTDOWN:') + 1
                      )
                    )
                  ) > 0
                )
              )
              AND (
                (
                  NEW.run_status = 'READY'
                  AND NEW.suspended_reason IS NULL
                )
                OR (
                  NEW.run_status = 'BLOCKED'
                  AND NEW.suspended_reason = attempt.termination_reason
                )
              )
            )
          )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'Workflow cannot release a RUNNING Attempt without an exact terminal projection');
END;

-- The older lifecycle trigger checks identity, ownership, and status. M1 also
-- requires the active Attempt to belong to the Workflow's current phase.
CREATE TRIGGER workflows_m1_active_attempt_phase_insert_guard
BEFORE INSERT ON workflows
WHEN NEW.run_status = 'RUNNING'
  AND NOT EXISTS (
    SELECT 1
    FROM attempts AS attempt
    WHERE attempt.id = NEW.active_attempt_id
      AND attempt.workflow_id = NEW.id
      AND attempt.phase = NEW.phase
      AND attempt.status = 'RUNNING'
  )
BEGIN
  SELECT RAISE(ABORT, 'Workflow active Attempt does not belong to its current phase');
END;

CREATE TRIGGER workflows_m1_active_attempt_phase_update_guard
BEFORE UPDATE OF phase, run_status, active_attempt_id ON workflows
WHEN NEW.run_status = 'RUNNING'
  AND NOT EXISTS (
    SELECT 1
    FROM attempts AS attempt
    WHERE attempt.id = NEW.active_attempt_id
      AND attempt.workflow_id = NEW.id
      AND attempt.phase = NEW.phase
      AND attempt.status = 'RUNNING'
  )
BEGIN
  SELECT RAISE(ABORT, 'Workflow active Attempt does not belong to its current phase');
END;

-- A Worker result is completion evidence only when its result kind belongs to
-- the phase-owned response contract. Generic non-Worker test Attempts remain
-- outside this trigger by design.
CREATE TRIGGER attempts_m1_worker_result_kind_guard
BEFORE UPDATE OF status, termination_reason ON attempts
WHEN OLD.status = 'RUNNING'
  AND (
    NEW.context_manifest_id IS NOT NULL
    OR NEW.worker_session_ref IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM context_manifests AS context_manifest
      WHERE context_manifest.attempt_id = NEW.id
    )
  )
  AND NEW.status = 'RESULT_RECORDED'
  AND NOT (
    (
      NEW.phase IN ('DISCOVERY', 'PLAN')
      AND NEW.termination_reason = 'WORKER_RESULT:PROPOSALS'
    )
    OR (
      NEW.phase = 'IMPLEMENT'
      AND NEW.termination_reason = 'WORKER_RESULT:COMPLETION_REQUEST'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Worker result kind is not authorized by its Workflow phase');
END;

CREATE TRIGGER attempts_m1_worker_failure_mapping_guard
BEFORE UPDATE OF status, failure_class, termination_reason ON attempts
WHEN OLD.status = 'RUNNING'
  AND (
    NEW.context_manifest_id IS NOT NULL
    OR NEW.worker_session_ref IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM context_manifests AS context_manifest
      WHERE context_manifest.attempt_id = NEW.id
    )
  )
  AND NEW.status = 'FAILED'
  AND NOT (
    (
      NEW.termination_reason = 'WORKER_BACKEND_FAILURE'
      AND NEW.failure_class = 'TRANSIENT_BACKEND'
    )
    OR (
      NEW.termination_reason = 'WORKER_PORT_INVOCATION_FAILED'
      AND NEW.failure_class = 'ABRUPT_TERMINATION'
    )
    OR (
      NEW.termination_reason IN (
        'WORKER_PORT_NON_ASYNC_STREAM',
        'WORKER_STREAM_NO_TERMINAL_EVENT',
        'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT'
      )
      AND NEW.failure_class = 'PROTOCOL_ERROR'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Worker failure reason has no exact M1 failure mapping');
END;
