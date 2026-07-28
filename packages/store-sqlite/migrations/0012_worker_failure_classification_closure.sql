CREATE TABLE worker_failure_classification_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO worker_failure_classification_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM attempts AS attempt
  WHERE (
    attempt.termination_reason = 'WORKER_BACKEND_FAILURE'
    AND (attempt.status <> 'FAILED' OR attempt.failure_class IS NOT 'TRANSIENT_BACKEND')
  )
  OR (
    attempt.termination_reason = 'WORKER_PORT_INVOCATION_FAILED'
    AND (attempt.status <> 'FAILED' OR attempt.failure_class IS NOT 'ABRUPT_TERMINATION')
  )
  OR (
    attempt.termination_reason IN (
      'WORKER_PORT_NON_ASYNC_STREAM',
      'WORKER_STREAM_NO_TERMINAL_EVENT',
      'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT'
    )
    AND (attempt.status <> 'FAILED' OR attempt.failure_class IS NOT 'PROTOCOL_ERROR')
  )
);

DROP TABLE worker_failure_classification_migration_guard;

CREATE TRIGGER attempts_worker_failure_classification_update_guard
BEFORE UPDATE OF status, failure_class, termination_reason, ended_at ON attempts
WHEN (
  NEW.termination_reason = 'WORKER_BACKEND_FAILURE'
  AND (NEW.status <> 'FAILED' OR NEW.failure_class IS NOT 'TRANSIENT_BACKEND')
)
OR (
  NEW.termination_reason = 'WORKER_PORT_INVOCATION_FAILED'
  AND (NEW.status <> 'FAILED' OR NEW.failure_class IS NOT 'ABRUPT_TERMINATION')
)
OR (
  NEW.termination_reason IN (
    'WORKER_PORT_NON_ASYNC_STREAM',
    'WORKER_STREAM_NO_TERMINAL_EVENT',
    'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT'
  )
  AND (NEW.status <> 'FAILED' OR NEW.failure_class IS NOT 'PROTOCOL_ERROR')
)
BEGIN
  SELECT RAISE(ABORT, 'Worker failure reason requires its runtime-owned failure class');
END;
