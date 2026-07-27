UPDATE goals
SET status = (
      SELECT CASE workflows.run_status
        WHEN 'READY' THEN 'ACTIVE'
        WHEN 'RUNNING' THEN 'ACTIVE'
        WHEN 'WAITING_FOR_INPUT' THEN 'WAITING_FOR_INPUT'
        WHEN 'BLOCKED' THEN 'BLOCKED'
        WHEN 'FAILED' THEN 'BLOCKED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        WHEN 'CLOSED' THEN 'CLOSED'
      END
      FROM workflows
      WHERE workflows.goal_id = goals.id
    ),
    updated_at = (
      SELECT workflows.updated_at
      FROM workflows
      WHERE workflows.goal_id = goals.id
    )
WHERE EXISTS (
  SELECT 1
  FROM workflows
  WHERE workflows.goal_id = goals.id
);

CREATE TRIGGER attempts_no_delete
BEFORE DELETE ON attempts
BEGIN
  SELECT RAISE(ABORT, 'Attempt records cannot be deleted');
END;

CREATE TRIGGER goals_status_projection_guard
BEFORE UPDATE OF status ON goals
WHEN EXISTS (
    SELECT 1
    FROM workflows
    WHERE workflows.goal_id = OLD.id
  )
  AND NEW.status <> (
    SELECT CASE workflows.run_status
      WHEN 'READY' THEN 'ACTIVE'
      WHEN 'RUNNING' THEN 'ACTIVE'
      WHEN 'WAITING_FOR_INPUT' THEN 'WAITING_FOR_INPUT'
      WHEN 'BLOCKED' THEN 'BLOCKED'
      WHEN 'FAILED' THEN 'BLOCKED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      WHEN 'CLOSED' THEN 'CLOSED'
    END
    FROM workflows
    WHERE workflows.goal_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'Goal status must match its Workflow lifecycle projection');
END;

CREATE TRIGGER workflows_goal_projection_insert_guard
BEFORE INSERT ON workflows
WHEN (
    SELECT status
    FROM goals
    WHERE id = NEW.goal_id
  ) <> CASE NEW.run_status
    WHEN 'READY' THEN 'ACTIVE'
    WHEN 'RUNNING' THEN 'ACTIVE'
    WHEN 'WAITING_FOR_INPUT' THEN 'WAITING_FOR_INPUT'
    WHEN 'BLOCKED' THEN 'BLOCKED'
    WHEN 'FAILED' THEN 'BLOCKED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    WHEN 'CLOSED' THEN 'CLOSED'
  END
BEGIN
  SELECT RAISE(ABORT, 'Workflow lifecycle must match its Goal status projection');
END;

CREATE TRIGGER workflows_goal_projection_update
AFTER UPDATE OF run_status ON workflows
WHEN NEW.run_status <> OLD.run_status
BEGIN
  UPDATE goals
  SET status = CASE NEW.run_status
        WHEN 'READY' THEN 'ACTIVE'
        WHEN 'RUNNING' THEN 'ACTIVE'
        WHEN 'WAITING_FOR_INPUT' THEN 'WAITING_FOR_INPUT'
        WHEN 'BLOCKED' THEN 'BLOCKED'
        WHEN 'FAILED' THEN 'BLOCKED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        WHEN 'CLOSED' THEN 'CLOSED'
      END,
      updated_at = NEW.updated_at
  WHERE id = NEW.goal_id;
END;
