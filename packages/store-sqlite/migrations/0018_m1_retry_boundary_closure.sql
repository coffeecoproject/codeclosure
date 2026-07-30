CREATE TABLE m1_retry_boundary_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

CREATE TRIGGER m1_retry_boundary_migration_guard_reject
BEFORE INSERT ON m1_retry_boundary_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(ABORT, 'legacy-unbounded-retry-state');
END;

-- M1 has no persisted retry budget or backoff authority. Any later Attempt
-- after a transient failure is therefore unprovable continuation history. The
-- Workflow may only remain BLOCKED in the failed phase or be cancelled; it may
-- not become ready or advance phase without the authority required by I-028.
-- Do not invent a retry authorization, BLOCKED transition, or audit history for
-- that database.
INSERT INTO m1_retry_boundary_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM attempts AS failed
  WHERE failed.status = 'FAILED'
    AND failed.failure_class = 'TRANSIENT_BACKEND'
    AND EXISTS (
      SELECT 1
      FROM attempts AS later
      WHERE later.workflow_id = failed.workflow_id
        AND later.sequence > failed.sequence
    )
)
OR EXISTS (
  SELECT 1
  FROM workflows AS workflow
  JOIN attempts AS failed
    ON failed.workflow_id = workflow.id
  WHERE failed.status = 'FAILED'
    AND failed.failure_class = 'TRANSIENT_BACKEND'
    AND NOT EXISTS (
      SELECT 1
      FROM attempts AS later
      WHERE later.workflow_id = failed.workflow_id
        AND later.sequence > failed.sequence
    )
    AND (
      workflow.phase <> failed.phase
      OR workflow.run_status NOT IN ('BLOCKED', 'CANCELLED')
    )
);

DROP TRIGGER m1_retry_boundary_migration_guard_reject;
DROP TABLE m1_retry_boundary_migration_guard;

-- Once the transient failure exists, the owning Workflow may only remain
-- BLOCKED in that phase or move to CANCELLED.
CREATE TRIGGER workflows_m1_retry_boundary_update_guard
BEFORE UPDATE ON workflows
WHEN EXISTS (
    SELECT 1
    FROM attempts AS attempt
    WHERE attempt.workflow_id = NEW.id
      AND attempt.status = 'FAILED'
      AND attempt.failure_class = 'TRANSIENT_BACKEND'
      AND NOT EXISTS (
        SELECT 1
        FROM attempts AS later
        WHERE later.workflow_id = attempt.workflow_id
          AND later.sequence > attempt.sequence
      )
      AND (
        NEW.phase <> attempt.phase
        OR NEW.run_status NOT IN ('BLOCKED', 'CANCELLED')
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'M1 transient failure cannot authorize Workflow continuation');
END;

-- M1 cannot create any later Attempt from retry classification alone.
CREATE TRIGGER attempts_m1_retry_boundary_insert_guard
BEFORE INSERT ON attempts
WHEN EXISTS (
  SELECT 1
  FROM attempts AS failed
  WHERE failed.workflow_id = NEW.workflow_id
    AND failed.sequence < NEW.sequence
    AND failed.status = 'FAILED'
    AND failed.failure_class = 'TRANSIENT_BACKEND'
)
BEGIN
  SELECT RAISE(ABORT, 'M1 transient failure cannot authorize another Attempt');
END;

-- Preserve the history invariant when a direct writer terminalizes an earlier
-- Attempt after a later Attempt already exists.
CREATE TRIGGER attempts_m1_retry_boundary_history_update_guard
BEFORE UPDATE OF status, failure_class ON attempts
WHEN NEW.status = 'FAILED'
  AND NEW.failure_class = 'TRANSIENT_BACKEND'
  AND EXISTS (
    SELECT 1
    FROM attempts AS later
    WHERE later.workflow_id = NEW.workflow_id
      AND later.sequence > NEW.sequence
  )
BEGIN
  SELECT RAISE(ABORT, 'M1 transient failure cannot authorize another Attempt');
END;

-- The Store normally terminalizes the Attempt while the Workflow is still
-- RUNNING, then moves the Workflow to BLOCKED. Reject every other intermediate
-- Workflow relationship, including a direct phase jump or READY rewrite.
CREATE TRIGGER attempts_m1_retry_boundary_update_guard
BEFORE UPDATE OF status, failure_class ON attempts
WHEN NEW.status = 'FAILED'
  AND NEW.failure_class = 'TRANSIENT_BACKEND'
  AND EXISTS (
    SELECT 1
    FROM workflows AS workflow
    WHERE workflow.id = NEW.workflow_id
      AND (
        workflow.phase <> NEW.phase
        OR workflow.run_status NOT IN ('RUNNING', 'BLOCKED')
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'M1 transient failure cannot bind invalid Workflow state');
END;
