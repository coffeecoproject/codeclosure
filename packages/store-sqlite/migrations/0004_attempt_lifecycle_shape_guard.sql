CREATE TABLE attempt_lifecycle_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO attempt_lifecycle_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM attempts
  WHERE NOT (
      (
        status = 'RUNNING'
        AND failure_class IS NULL
        AND termination_reason IS NULL
        AND ended_at IS NULL
      )
      OR (
        status = 'RESULT_RECORDED'
        AND failure_class IS NULL
        AND termination_reason IS NOT NULL
        AND length(trim(termination_reason)) > 0
        AND ended_at IS NOT NULL
        AND ended_at >= started_at
      )
      OR (
        status = 'FAILED'
        AND failure_class IS NOT NULL
        AND termination_reason IS NOT NULL
        AND length(trim(termination_reason)) > 0
        AND ended_at IS NOT NULL
        AND ended_at >= started_at
      )
      OR (
        status = 'INTERRUPTED'
        AND failure_class IS NULL
        AND termination_reason IS NOT NULL
        AND length(trim(termination_reason)) > 0
        AND ended_at IS NOT NULL
        AND ended_at >= started_at
      )
    )
);

DROP TABLE attempt_lifecycle_migration_guard;

CREATE TRIGGER attempts_lifecycle_shape_update_guard
BEFORE UPDATE OF status, failure_class, termination_reason, ended_at ON attempts
WHEN NOT (
    (
      NEW.status = 'RUNNING'
      AND NEW.failure_class IS NULL
      AND NEW.termination_reason IS NULL
      AND NEW.ended_at IS NULL
    )
    OR (
      NEW.status = 'RESULT_RECORDED'
      AND NEW.failure_class IS NULL
      AND NEW.termination_reason IS NOT NULL
      AND length(trim(NEW.termination_reason)) > 0
      AND NEW.ended_at IS NOT NULL
      AND NEW.ended_at >= NEW.started_at
    )
    OR (
      NEW.status = 'FAILED'
      AND NEW.failure_class IS NOT NULL
      AND NEW.termination_reason IS NOT NULL
      AND length(trim(NEW.termination_reason)) > 0
      AND NEW.ended_at IS NOT NULL
      AND NEW.ended_at >= NEW.started_at
    )
    OR (
      NEW.status = 'INTERRUPTED'
      AND NEW.failure_class IS NULL
      AND NEW.termination_reason IS NOT NULL
      AND length(trim(NEW.termination_reason)) > 0
      AND NEW.ended_at IS NOT NULL
      AND NEW.ended_at >= NEW.started_at
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid Attempt lifecycle shape');
END;
