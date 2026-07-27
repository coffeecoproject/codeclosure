ALTER TABLE attempts ADD COLUMN termination_reason TEXT;

CREATE UNIQUE INDEX attempts_one_running_per_workflow_idx
  ON attempts(workflow_id)
  WHERE status = 'RUNNING';

CREATE TRIGGER attempts_insert_guard
BEFORE INSERT ON attempts
WHEN NEW.status <> 'RUNNING'
  OR NEW.ended_at IS NOT NULL
  OR NEW.failure_class IS NOT NULL
  OR NEW.termination_reason IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'new Attempt must begin as RUNNING');
END;

CREATE TRIGGER attempts_terminal_immutable
BEFORE UPDATE ON attempts
WHEN OLD.status <> 'RUNNING'
BEGIN
  SELECT RAISE(ABORT, 'terminal Attempt is immutable');
END;

CREATE TRIGGER attempts_lifecycle_guard
BEFORE UPDATE OF status ON attempts
WHEN OLD.status <> 'RUNNING'
  OR NEW.status NOT IN ('RESULT_RECORDED', 'FAILED', 'INTERRUPTED')
  OR NEW.ended_at IS NULL
  OR NEW.ended_at < NEW.started_at
  OR NEW.termination_reason IS NULL
  OR length(trim(NEW.termination_reason)) = 0
  OR (NEW.status = 'RESULT_RECORDED' AND NEW.failure_class IS NOT NULL)
  OR (NEW.status = 'FAILED' AND NEW.failure_class IS NULL)
  OR (NEW.status = 'INTERRUPTED' AND NEW.failure_class IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid Attempt lifecycle transition');
END;

CREATE TRIGGER attempts_identity_immutable
BEFORE UPDATE ON attempts
WHEN NEW.id <> OLD.id
  OR NEW.workflow_id <> OLD.workflow_id
  OR NEW.phase <> OLD.phase
  OR NEW.sequence <> OLD.sequence
  OR NEW.capability_grant_json <> OLD.capability_grant_json
  OR NEW.started_at <> OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'Attempt identity is immutable');
END;

CREATE TRIGGER attempts_failure_class_guard
BEFORE UPDATE OF failure_class ON attempts
WHEN NEW.failure_class IS NOT NULL
  AND NEW.failure_class NOT IN (
    'TRANSIENT_BACKEND',
    'TIMEOUT',
    'ABRUPT_TERMINATION',
    'PROTOCOL_ERROR',
    'INTEGRITY_VIOLATION',
    'PERMANENT_BACKEND',
    'UNKNOWN'
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid Attempt failure class');
END;

CREATE TRIGGER workflows_active_attempt_insert_guard
BEFORE INSERT ON workflows
WHEN (NEW.run_status = 'RUNNING') <> (NEW.active_attempt_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Workflow RUNNING state must bind exactly one active Attempt');
END;

CREATE TRIGGER workflows_active_attempt_update_guard
BEFORE UPDATE ON workflows
WHEN (NEW.run_status = 'RUNNING') <> (NEW.active_attempt_id IS NOT NULL)
  OR (
    NEW.active_attempt_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM attempts
      WHERE id = NEW.active_attempt_id
        AND workflow_id = NEW.id
        AND status = 'RUNNING'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Workflow active Attempt binding is invalid');
END;
