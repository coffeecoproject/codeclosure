CREATE TABLE causal_control_time_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO causal_control_time_migration_guard(valid)
SELECT 0
WHERE EXISTS (
    SELECT 1
    FROM goals
    WHERE updated_at < created_at
  )
  OR EXISTS (
    SELECT 1
    FROM workflows
    WHERE updated_at < created_at
  )
  OR EXISTS (
    SELECT 1
    FROM attempts
    JOIN workflows ON workflows.id = attempts.workflow_id
    WHERE attempts.started_at < workflows.created_at
  )
  OR EXISTS (
    SELECT 1
    FROM candidate_generations
    WHERE updated_at < created_at
      OR (frozen_at IS NOT NULL AND frozen_at < created_at)
      OR (frozen_at IS NOT NULL AND frozen_at > updated_at)
  );

DROP TABLE causal_control_time_migration_guard;

CREATE TRIGGER goals_updated_at_monotonic
BEFORE UPDATE OF updated_at ON goals
WHEN NEW.updated_at < OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Goal updated_at cannot move backward');
END;

CREATE TRIGGER workflows_updated_at_monotonic
BEFORE UPDATE OF updated_at ON workflows
WHEN NEW.updated_at < OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Workflow updated_at cannot move backward');
END;

CREATE TRIGGER workflows_terminal_immutable
BEFORE UPDATE ON workflows
WHEN OLD.run_status IN ('CANCELLED', 'CLOSED')
BEGIN
  SELECT RAISE(ABORT, 'terminal Workflow is immutable');
END;

CREATE TRIGGER attempts_causal_start_insert_guard
BEFORE INSERT ON attempts
WHEN NEW.started_at < (
  SELECT updated_at
  FROM workflows
  WHERE id = NEW.workflow_id
)
BEGIN
  SELECT RAISE(ABORT, 'Attempt cannot start before current Workflow state');
END;

CREATE TRIGGER attempts_causal_end_update_guard
BEFORE UPDATE OF status, failure_class, termination_reason, ended_at ON attempts
WHEN NEW.ended_at IS NOT NULL
  AND NEW.ended_at < (
    SELECT updated_at
    FROM workflows
    WHERE id = NEW.workflow_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Attempt cannot end before current Workflow state');
END;

CREATE TRIGGER candidate_generations_updated_at_monotonic
BEFORE UPDATE OF updated_at ON candidate_generations
WHEN NEW.updated_at < OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Candidate generation updated_at cannot move backward');
END;

CREATE TRIGGER candidate_generations_terminal_immutable
BEFORE UPDATE ON candidate_generations
WHEN OLD.state IN ('INVALIDATED', 'REJECTED', 'ACCEPTED')
BEGIN
  SELECT RAISE(ABORT, 'terminal Candidate generation is immutable');
END;

CREATE TRIGGER audit_events_causal_insert_guard
BEFORE INSERT ON audit_events
WHEN (
    NEW.aggregate_type = 'GOAL'
    AND NEW.occurred_at < (
      SELECT updated_at
      FROM goals
      WHERE id = NEW.aggregate_id
    )
  )
  OR (
    NEW.aggregate_type = 'WORKFLOW'
    AND NEW.occurred_at < (
      SELECT updated_at
      FROM workflows
      WHERE id = NEW.aggregate_id
    )
  )
  OR (
    NEW.aggregate_type = 'ATTEMPT'
    AND NEW.occurred_at < (
      SELECT workflows.updated_at
      FROM attempts
      JOIN workflows ON workflows.id = attempts.workflow_id
      WHERE attempts.id = NEW.aggregate_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'control audit event cannot precede current aggregate state');
END;

CREATE TRIGGER processed_commands_causal_insert_guard
BEFORE INSERT ON processed_commands
WHEN NEW.completed_at < (
  SELECT updated_at
  FROM workflows
  WHERE id = json_extract(NEW.outcome_json, '$.workflow.id')
)
BEGIN
  SELECT RAISE(ABORT, 'processed command cannot precede observed Workflow state');
END;
