DROP TRIGGER attempts_m1_worker_failure_mapping_guard;

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
      NEW.termination_reason IN (
        'WORKER_PORT_INVOCATION_FAILED',
        'EXTERNAL_WORKER_PREPARATION_FAILED',
        'EXTERNAL_DISPATCH_AUTHORIZATION_FAILED'
      )
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
    OR (
      NEW.termination_reason IN (
        'PROJECT_SOURCE_DRIFT',
        'PROJECT_READ_SNAPSHOT_DRIFT',
        'PROJECT_READ_AUTHORITY_INVALID'
      )
      AND NEW.failure_class = 'INTEGRITY_VIOLATION'
      AND NEW.phase IN ('DISCOVERY', 'PLAN')
      AND NEW.context_manifest_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM project_read_context_manifest_extensions AS project_read
        JOIN project_source_read_authorities AS authority
          ON authority.id = project_read.project_read_authority_id
         AND authority.record_digest = project_read.project_read_authority_record_digest
        WHERE project_read.context_manifest_id = NEW.context_manifest_id
          AND project_read.logical_schema_version = 5
          AND authority.attempt_id = NEW.id
          AND authority.phase = NEW.phase
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Worker failure reason has no exact M1 failure mapping');
END;
