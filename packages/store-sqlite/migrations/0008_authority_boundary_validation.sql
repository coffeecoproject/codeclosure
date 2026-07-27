CREATE TABLE authority_boundary_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

-- Retained control records must already satisfy the scalar and state shapes
-- that their owning runtime codecs enforce. The migration deliberately fails
-- closed; it does not rewrite identity, chronology, or lifecycle history.
INSERT INTO authority_boundary_migration_guard(valid)
SELECT 0
WHERE EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE version > 9007199254740991
      OR length(name) = 0
      OR length(checksum) <> 71
      OR substr(checksum, 1, 7) <> 'sha256:'
      OR substr(checksum, 8) GLOB '*[^0-9a-f]*'
      OR COALESCE(
        length(applied_at) = 24
        AND applied_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', applied_at) = applied_at,
        0
      ) = 0
  )
  OR EXISTS (
    SELECT 1
    FROM goals
    WHERE COALESCE(
        length(id) BETWEEN 6 AND 133
        AND substr(id, 1, 5) = 'goal_'
        AND substr(id, 6) NOT GLOB '*[^a-z0-9-]*'
        AND substr(id, 6, 1) GLOB '[a-z0-9]'
        AND substr(id, -1, 1) GLOB '[a-z0-9]',
        0
      ) = 0
      OR revision > 9007199254740991
      OR json_type(allowed_paths_json) <> 'array'
      OR EXISTS (
        SELECT 1 FROM json_each(allowed_paths_json)
        WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0
      )
      OR json_type(non_goals_json) <> 'array'
      OR EXISTS (
        SELECT 1 FROM json_each(non_goals_json)
        WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0
      )
      OR COALESCE(
        length(created_at) = 24
        AND created_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at,
        0
      ) = 0
      OR COALESCE(
        length(updated_at) = 24
        AND updated_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at,
        0
      ) = 0
      OR updated_at < created_at
      OR NOT EXISTS (SELECT 1 FROM goal_criteria WHERE goal_id = goals.id)
  )
  OR EXISTS (
    SELECT 1
    FROM goal_criteria
    WHERE COALESCE(
        length(id) BETWEEN 11 AND 138
        AND substr(id, 1, 10) = 'criterion_'
        AND substr(id, 11) NOT GLOB '*[^a-z0-9-]*'
        AND substr(id, 11, 1) GLOB '[a-z0-9]'
        AND substr(id, -1, 1) GLOB '[a-z0-9]',
        0
      ) = 0
      OR position > 9007199254740991
  )
  OR EXISTS (
    SELECT 1
    FROM workflows
    WHERE COALESCE(
        length(id) BETWEEN 10 AND 137
        AND substr(id, 1, 9) = 'workflow_'
        AND substr(id, 10) NOT GLOB '*[^a-z0-9-]*'
        AND substr(id, 10, 1) GLOB '[a-z0-9]'
        AND substr(id, -1, 1) GLOB '[a-z0-9]',
        0
      ) = 0
      OR goal_revision > 9007199254740991
      OR version > 9007199254740991
      OR (
        active_attempt_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM attempts
          WHERE attempts.id = workflows.active_attempt_id
            AND attempts.workflow_id = workflows.id
            AND attempts.status = 'RUNNING'
        )
      )
      OR COALESCE(
        length(created_at) = 24
        AND created_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at,
        0
      ) = 0
      OR COALESCE(
        length(updated_at) = 24
        AND updated_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at,
        0
      ) = 0
      OR updated_at < created_at
      OR (active_attempt_id IS NULL) <> (run_status <> 'RUNNING')
      OR (suspended_reason IS NOT NULL AND length(trim(suspended_reason)) = 0)
      OR (
        active_candidate_generation_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM candidate_generations
          WHERE candidate_generations.id = workflows.active_candidate_generation_id
            AND candidate_generations.workflow_id = workflows.id
        )
      )
  )
  OR EXISTS (
    SELECT 1
    FROM attempts
    WHERE COALESCE(
        length(id) BETWEEN 9 AND 136
        AND substr(id, 1, 8) = 'attempt_'
        AND substr(id, 9) NOT GLOB '*[^a-z0-9-]*'
        AND substr(id, 9, 1) GLOB '[a-z0-9]'
        AND substr(id, -1, 1) GLOB '[a-z0-9]',
        0
      ) = 0
      OR sequence > 9007199254740991
      OR phase = 'CLOSEOUT'
      OR (
        context_manifest_id IS NOT NULL
        AND COALESCE(
          length(context_manifest_id) BETWEEN 9 AND 136
          AND substr(context_manifest_id, 1, 8) = 'context_'
          AND substr(context_manifest_id, 9) NOT GLOB '*[^a-z0-9-]*'
          AND substr(context_manifest_id, 9, 1) GLOB '[a-z0-9]'
          AND substr(context_manifest_id, -1, 1) GLOB '[a-z0-9]',
          0
        ) = 0
      )
      OR (
        worker_session_ref IS NOT NULL
        AND COALESCE(
          length(worker_session_ref) BETWEEN 8 AND 135
          AND substr(worker_session_ref, 1, 7) = 'worker_'
          AND substr(worker_session_ref, 8) NOT GLOB '*[^a-z0-9-]*'
          AND substr(worker_session_ref, 8, 1) GLOB '[a-z0-9]'
          AND substr(worker_session_ref, -1, 1) GLOB '[a-z0-9]',
          0
        ) = 0
      )
      OR json_type(capability_grant_json) <> 'object'
      OR json_extract(capability_grant_json, '$.phase') <> phase
      OR json_type(capability_grant_json, '$.projectRead') <> 'true'
      OR json_type(capability_grant_json, '$.allowedActions') <> 'array'
      OR (SELECT count(*) FROM json_each(capability_grant_json)) <> 7
      OR COALESCE(NOT (
        (phase = 'DISCOVERY'
          AND json_extract(capability_grant_json, '$.candidateAccess') = 'NONE'
          AND json_extract(capability_grant_json, '$.runOutputScope') = 'BOUNDED_DISCOVERY'
          AND json_extract(capability_grant_json, '$.controlSubmission') = 'PROPOSALS'
          AND json_extract(capability_grant_json, '$.acceptanceAccess') = 'NONE'
          AND json_array_length(capability_grant_json, '$.allowedActions') = 3
          AND json_extract(capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
          AND json_extract(capability_grant_json, '$.allowedActions[1]') = 'WRITE_RUN_OUTPUT'
          AND json_extract(capability_grant_json, '$.allowedActions[2]') = 'SUBMIT_PROPOSALS')
        OR (phase = 'PLAN'
          AND json_extract(capability_grant_json, '$.candidateAccess') = 'NONE'
          AND json_extract(capability_grant_json, '$.runOutputScope') = 'PLAN_OBSERVATION'
          AND json_extract(capability_grant_json, '$.controlSubmission') = 'PROPOSALS'
          AND json_extract(capability_grant_json, '$.acceptanceAccess') = 'NONE'
          AND json_array_length(capability_grant_json, '$.allowedActions') = 3
          AND json_extract(capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
          AND json_extract(capability_grant_json, '$.allowedActions[1]') = 'WRITE_RUN_OUTPUT'
          AND json_extract(capability_grant_json, '$.allowedActions[2]') = 'SUBMIT_PROPOSALS')
        OR (phase = 'IMPLEMENT'
          AND json_extract(capability_grant_json, '$.candidateAccess') = 'MUTABLE_WRITE'
          AND json_extract(capability_grant_json, '$.runOutputScope') = 'BOUNDED_IMPLEMENTATION'
          AND json_extract(capability_grant_json, '$.controlSubmission') = 'COMPLETION_REQUEST'
          AND json_extract(capability_grant_json, '$.acceptanceAccess') = 'NONE'
          AND json_array_length(capability_grant_json, '$.allowedActions') = 5
          AND json_extract(capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
          AND json_extract(capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
          AND json_extract(capability_grant_json, '$.allowedActions[2]') = 'WRITE_CANDIDATE_SOURCE'
          AND json_extract(capability_grant_json, '$.allowedActions[3]') = 'WRITE_RUN_OUTPUT'
          AND json_extract(capability_grant_json, '$.allowedActions[4]') = 'SUBMIT_COMPLETION_REQUEST')
        OR (phase = 'SOURCE_FREEZE'
          AND json_extract(capability_grant_json, '$.candidateAccess') = 'FREEZE_READ'
          AND json_extract(capability_grant_json, '$.runOutputScope') = 'FREEZE_METADATA'
          AND json_extract(capability_grant_json, '$.controlSubmission') = 'RUNTIME_ONLY'
          AND json_extract(capability_grant_json, '$.acceptanceAccess') = 'NONE'
          AND json_array_length(capability_grant_json, '$.allowedActions') = 3
          AND json_extract(capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
          AND json_extract(capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
          AND json_extract(capability_grant_json, '$.allowedActions[2]') = 'WRITE_RUN_OUTPUT')
        OR (phase = 'EVIDENCE_BUILD'
          AND json_extract(capability_grant_json, '$.candidateAccess') = 'FROZEN_READ'
          AND json_extract(capability_grant_json, '$.runOutputScope') = 'RUN_OWNED_VERIFICATION'
          AND json_extract(capability_grant_json, '$.controlSubmission') = 'EVIDENCE_SUBMISSION'
          AND json_extract(capability_grant_json, '$.acceptanceAccess') = 'NONE'
          AND json_array_length(capability_grant_json, '$.allowedActions') = 4
          AND json_extract(capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
          AND json_extract(capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
          AND json_extract(capability_grant_json, '$.allowedActions[2]') = 'WRITE_RUN_OUTPUT'
          AND json_extract(capability_grant_json, '$.allowedActions[3]') = 'SUBMIT_EVIDENCE')
        OR (phase = 'FINAL_VERIFY'
          AND json_extract(capability_grant_json, '$.candidateAccess') = 'FROZEN_READ'
          AND json_extract(capability_grant_json, '$.runOutputScope') = 'DECISION_TRACE'
          AND json_extract(capability_grant_json, '$.controlSubmission') = 'DECISION_SUBMISSION'
          AND json_extract(capability_grant_json, '$.acceptanceAccess') = 'EVALUATE_READ_ONLY'
          AND json_array_length(capability_grant_json, '$.allowedActions') = 5
          AND json_extract(capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
          AND json_extract(capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
          AND json_extract(capability_grant_json, '$.allowedActions[2]') = 'WRITE_RUN_OUTPUT'
          AND json_extract(capability_grant_json, '$.allowedActions[3]') = 'SUBMIT_DECISION'
          AND json_extract(capability_grant_json, '$.allowedActions[4]') = 'EVALUATE_ACCEPTANCE')
        OR (phase = 'CLOSEOUT'
          AND json_extract(capability_grant_json, '$.candidateAccess') = 'ACCEPTED_READ'
          AND json_extract(capability_grant_json, '$.runOutputScope') = 'CLOSEOUT_EXPORT'
          AND json_extract(capability_grant_json, '$.controlSubmission') = 'CONSUME_EXISTING'
          AND json_extract(capability_grant_json, '$.acceptanceAccess') = 'CONSUME_EXISTING'
          AND json_array_length(capability_grant_json, '$.allowedActions') = 4
          AND json_extract(capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
          AND json_extract(capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
          AND json_extract(capability_grant_json, '$.allowedActions[2]') = 'WRITE_RUN_OUTPUT'
          AND json_extract(capability_grant_json, '$.allowedActions[3]') = 'CONSUME_ACCEPTANCE')
      ), 1) = 1
      OR COALESCE(
        length(started_at) = 24
        AND started_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', started_at) = started_at,
        0
      ) = 0
      OR (
        ended_at IS NOT NULL
        AND COALESCE(
          length(ended_at) = 24
          AND ended_at GLOB '????-??-??T??:??:??.???Z'
          AND strftime('%Y-%m-%dT%H:%M:%fZ', ended_at) = ended_at,
          0
        ) = 0
      )
  )
  OR EXISTS (
    SELECT 1
    FROM candidate_generations
    WHERE COALESCE(
        length(id) BETWEEN 12 AND 139
        AND substr(id, 1, 11) = 'generation_'
        AND substr(id, 12) NOT GLOB '*[^a-z0-9-]*'
        AND substr(id, 12, 1) GLOB '[a-z0-9]'
        AND substr(id, -1, 1) GLOB '[a-z0-9]',
        0
      ) = 0
      OR COALESCE(
        length(candidate_id) BETWEEN 11 AND 138
        AND substr(candidate_id, 1, 10) = 'candidate_'
        AND substr(candidate_id, 11) NOT GLOB '*[^a-z0-9-]*'
        AND substr(candidate_id, 11, 1) GLOB '[a-z0-9]'
        AND substr(candidate_id, -1, 1) GLOB '[a-z0-9]',
        0
      ) = 0
      OR sequence > 9007199254740991
      OR version > 9007199254740991
      OR parent_generation_id = id
      OR length(base_digest) <> 71
      OR substr(base_digest, 1, 7) <> 'sha256:'
      OR substr(base_digest, 8) GLOB '*[^0-9a-f]*'
      OR (
        frozen_digest IS NOT NULL
        AND (
          length(frozen_digest) <> 71
          OR substr(frozen_digest, 1, 7) <> 'sha256:'
          OR substr(frozen_digest, 8) GLOB '*[^0-9a-f]*'
        )
      )
      OR COALESCE(
        length(created_at) = 24
        AND created_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at,
        0
      ) = 0
      OR COALESCE(
        length(updated_at) = 24
        AND updated_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at,
        0
      ) = 0
      OR updated_at < created_at
      OR (
        frozen_at IS NOT NULL
        AND COALESCE(
          length(frozen_at) = 24
          AND frozen_at GLOB '????-??-??T??:??:??.???Z'
          AND strftime('%Y-%m-%dT%H:%M:%fZ', frozen_at) = frozen_at,
          0
        ) = 0
      )
      OR (frozen_at IS NOT NULL AND (frozen_at < created_at OR frozen_at > updated_at))
      OR COALESCE(
        (state IN ('MUTABLE', 'FREEZING')
          AND frozen_digest IS NULL
          AND frozen_at IS NULL
          AND invalidation_reason IS NULL)
        OR (state IN ('FROZEN', 'REJECTED', 'ACCEPTED')
          AND frozen_digest IS NOT NULL
          AND frozen_at IS NOT NULL
          AND invalidation_reason IS NULL)
        OR (state = 'INVALIDATED'
          AND invalidation_reason IS NOT NULL
          AND length(trim(invalidation_reason)) > 0
          AND ((frozen_digest IS NULL AND frozen_at IS NULL)
            OR (frozen_digest IS NOT NULL AND frozen_at IS NOT NULL))),
        0
      ) = 0
      OR (
        parent_generation_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM candidate_generations AS parent
          WHERE parent.id = candidate_generations.parent_generation_id
            AND parent.candidate_id = candidate_generations.candidate_id
            AND parent.workflow_id = candidate_generations.workflow_id
            AND parent.sequence < candidate_generations.sequence
        )
      )
  )
  OR EXISTS (
    SELECT 1
    FROM candidate_generations
    GROUP BY candidate_id
    HAVING count(DISTINCT workflow_id) > 1
  )
  OR EXISTS (
    SELECT 1
    FROM candidate_generations
    WHERE state IN ('MUTABLE', 'FREEZING', 'FROZEN')
    GROUP BY workflow_id
    HAVING count(*) > 1
  )
  OR EXISTS (
    SELECT 1
    FROM processed_commands
    WHERE COALESCE(
        length(command_id) BETWEEN 9 AND 136
        AND substr(command_id, 1, 8) = 'command_'
        AND substr(command_id, 9) NOT GLOB '*[^a-z0-9-]*'
        AND substr(command_id, 9, 1) GLOB '[a-z0-9]'
        AND substr(command_id, -1, 1) GLOB '[a-z0-9]',
        0
      ) = 0
      OR length(input_digest) <> 71
      OR substr(input_digest, 1, 7) <> 'sha256:'
      OR substr(input_digest, 8) GLOB '*[^0-9a-f]*'
      OR COALESCE(
        length(completed_at) = 24
        AND completed_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', completed_at) = completed_at,
        0
      ) = 0
  )
  OR EXISTS (
    SELECT 1
    FROM audit_events
    WHERE length(trim(aggregate_type)) = 0
      OR length(trim(aggregate_id)) = 0
      OR length(trim(event_type)) = 0
      OR length(trim(actor_type)) = 0
      OR (correlation_id IS NOT NULL AND length(trim(correlation_id)) = 0)
      OR (causation_id IS NOT NULL AND length(trim(causation_id)) = 0)
      OR COALESCE(
        length(id) BETWEEN 7 AND 134
        AND substr(id, 1, 6) = 'audit_'
        AND substr(id, 7) NOT GLOB '*[^a-z0-9-]*'
        AND substr(id, 7, 1) GLOB '[a-z0-9]'
        AND substr(id, -1, 1) GLOB '[a-z0-9]',
        0
      ) = 0
      OR sequence > 9007199254740991
      OR (before_version IS NOT NULL AND before_version > 9007199254740991)
      OR (after_version IS NOT NULL AND after_version > 9007199254740991)
      OR (
        command_id IS NOT NULL
        AND COALESCE(
          length(command_id) BETWEEN 9 AND 136
          AND substr(command_id, 1, 8) = 'command_'
          AND substr(command_id, 9) NOT GLOB '*[^a-z0-9-]*'
          AND substr(command_id, 9, 1) GLOB '[a-z0-9]'
          AND substr(command_id, -1, 1) GLOB '[a-z0-9]',
          0
        ) = 0
      )
      OR length(payload_digest) <> 71
      OR substr(payload_digest, 1, 7) <> 'sha256:'
      OR substr(payload_digest, 8) GLOB '*[^0-9a-f]*'
      OR COALESCE(
        length(occurred_at) = 24
        AND occurred_at GLOB '????-??-??T??:??:??.???Z'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) = occurred_at,
        0
      ) = 0
  );

DROP TABLE authority_boundary_migration_guard;

CREATE UNIQUE INDEX candidate_generations_one_current_per_workflow
  ON candidate_generations(workflow_id)
  WHERE state IN ('MUTABLE', 'FREEZING', 'FROZEN');

CREATE TRIGGER goals_authority_insert_guard
BEFORE INSERT ON goals
WHEN COALESCE(
    length(NEW.id) BETWEEN 6 AND 133
    AND substr(NEW.id, 1, 5) = 'goal_'
    AND substr(NEW.id, 6) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 6, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND NEW.revision <= 9007199254740991
    AND json_type(NEW.allowed_paths_json) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.allowed_paths_json)
      WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0
    )
    AND json_type(NEW.non_goals_json) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.non_goals_json)
      WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0
    )
    AND length(NEW.created_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) = NEW.created_at
    AND length(NEW.updated_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.updated_at) = NEW.updated_at
    AND NEW.updated_at >= NEW.created_at,
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Goal authority representation is invalid');
END;

CREATE TRIGGER goals_authority_update_guard
BEFORE UPDATE ON goals
WHEN COALESCE(
    NEW.id = OLD.id
    AND NEW.revision <= 9007199254740991
    AND json_type(NEW.allowed_paths_json) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.allowed_paths_json)
      WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0
    )
    AND json_type(NEW.non_goals_json) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.non_goals_json)
      WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0
    )
    AND length(NEW.created_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) = NEW.created_at
    AND length(NEW.updated_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.updated_at) = NEW.updated_at
    AND NEW.updated_at >= NEW.created_at,
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Goal authority representation is invalid');
END;

CREATE TRIGGER goal_criteria_authority_insert_guard
BEFORE INSERT ON goal_criteria
WHEN COALESCE(
    length(NEW.id) BETWEEN 11 AND 138
    AND substr(NEW.id, 1, 10) = 'criterion_'
    AND substr(NEW.id, 11) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 11, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND NEW.position <= 9007199254740991,
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Goal criterion authority representation is invalid');
END;

CREATE TRIGGER workflows_authority_insert_guard
BEFORE INSERT ON workflows
WHEN COALESCE(
    length(NEW.id) BETWEEN 10 AND 137
    AND substr(NEW.id, 1, 9) = 'workflow_'
    AND substr(NEW.id, 10) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 10, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND NEW.goal_revision <= 9007199254740991
    AND NEW.version <= 9007199254740991
    AND length(NEW.created_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) = NEW.created_at
    AND length(NEW.updated_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.updated_at) = NEW.updated_at
    AND NEW.updated_at >= NEW.created_at
    AND ((NEW.run_status = 'RUNNING') = (NEW.active_attempt_id IS NOT NULL))
    AND (NEW.suspended_reason IS NULL OR length(trim(NEW.suspended_reason)) > 0)
    AND (
      NEW.active_attempt_id IS NULL
      OR EXISTS (
        SELECT 1 FROM attempts
        WHERE id = NEW.active_attempt_id
          AND workflow_id = NEW.id
          AND status = 'RUNNING'
      )
    )
    AND (
      NEW.active_candidate_generation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM candidate_generations
        WHERE id = NEW.active_candidate_generation_id
          AND workflow_id = NEW.id
      )
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Workflow authority representation is invalid');
END;

CREATE TRIGGER workflows_authority_update_guard
BEFORE UPDATE ON workflows
WHEN COALESCE(
    NEW.id = OLD.id
    AND NEW.goal_id = OLD.goal_id
    AND NEW.goal_revision = OLD.goal_revision
    AND NEW.created_at = OLD.created_at
    AND NEW.version <= 9007199254740991
    AND length(NEW.updated_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.updated_at) = NEW.updated_at
    AND NEW.updated_at >= NEW.created_at
    AND ((NEW.run_status = 'RUNNING') = (NEW.active_attempt_id IS NOT NULL))
    AND (NEW.suspended_reason IS NULL OR length(trim(NEW.suspended_reason)) > 0)
    AND (
      NEW.active_candidate_generation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM candidate_generations
        WHERE id = NEW.active_candidate_generation_id
          AND workflow_id = NEW.id
      )
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Workflow authority representation is invalid');
END;

CREATE TRIGGER attempts_authority_insert_guard
BEFORE INSERT ON attempts
WHEN COALESCE(
    length(NEW.id) BETWEEN 9 AND 136
    AND substr(NEW.id, 1, 8) = 'attempt_'
    AND substr(NEW.id, 9) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 9, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND NEW.sequence <= 9007199254740991
    AND NEW.phase <> 'CLOSEOUT'
    AND (NEW.context_manifest_id IS NULL OR (
      length(NEW.context_manifest_id) BETWEEN 9 AND 136
      AND substr(NEW.context_manifest_id, 1, 8) = 'context_'
      AND substr(NEW.context_manifest_id, 9) NOT GLOB '*[^a-z0-9-]*'
      AND substr(NEW.context_manifest_id, 9, 1) GLOB '[a-z0-9]'
      AND substr(NEW.context_manifest_id, -1, 1) GLOB '[a-z0-9]'
    ))
    AND (NEW.worker_session_ref IS NULL OR (
      length(NEW.worker_session_ref) BETWEEN 8 AND 135
      AND substr(NEW.worker_session_ref, 1, 7) = 'worker_'
      AND substr(NEW.worker_session_ref, 8) NOT GLOB '*[^a-z0-9-]*'
      AND substr(NEW.worker_session_ref, 8, 1) GLOB '[a-z0-9]'
      AND substr(NEW.worker_session_ref, -1, 1) GLOB '[a-z0-9]'
    ))
    AND json_type(NEW.capability_grant_json) = 'object'
    AND json_extract(NEW.capability_grant_json, '$.phase') = NEW.phase
    AND json_type(NEW.capability_grant_json, '$.projectRead') = 'true'
    AND json_type(NEW.capability_grant_json, '$.allowedActions') = 'array'
    AND (SELECT count(*) FROM json_each(NEW.capability_grant_json)) = 7
    AND (
      (NEW.phase = 'DISCOVERY'
        AND json_extract(NEW.capability_grant_json, '$.candidateAccess') = 'NONE'
        AND json_extract(NEW.capability_grant_json, '$.runOutputScope') = 'BOUNDED_DISCOVERY'
        AND json_extract(NEW.capability_grant_json, '$.controlSubmission') = 'PROPOSALS'
        AND json_extract(NEW.capability_grant_json, '$.acceptanceAccess') = 'NONE'
        AND json_array_length(NEW.capability_grant_json, '$.allowedActions') = 3
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[1]') = 'WRITE_RUN_OUTPUT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[2]') = 'SUBMIT_PROPOSALS')
      OR (NEW.phase = 'PLAN'
        AND json_extract(NEW.capability_grant_json, '$.candidateAccess') = 'NONE'
        AND json_extract(NEW.capability_grant_json, '$.runOutputScope') = 'PLAN_OBSERVATION'
        AND json_extract(NEW.capability_grant_json, '$.controlSubmission') = 'PROPOSALS'
        AND json_extract(NEW.capability_grant_json, '$.acceptanceAccess') = 'NONE'
        AND json_array_length(NEW.capability_grant_json, '$.allowedActions') = 3
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[1]') = 'WRITE_RUN_OUTPUT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[2]') = 'SUBMIT_PROPOSALS')
      OR (NEW.phase = 'IMPLEMENT'
        AND json_extract(NEW.capability_grant_json, '$.candidateAccess') = 'MUTABLE_WRITE'
        AND json_extract(NEW.capability_grant_json, '$.runOutputScope') = 'BOUNDED_IMPLEMENTATION'
        AND json_extract(NEW.capability_grant_json, '$.controlSubmission') = 'COMPLETION_REQUEST'
        AND json_extract(NEW.capability_grant_json, '$.acceptanceAccess') = 'NONE'
        AND json_array_length(NEW.capability_grant_json, '$.allowedActions') = 5
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[2]') = 'WRITE_CANDIDATE_SOURCE'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[3]') = 'WRITE_RUN_OUTPUT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[4]') = 'SUBMIT_COMPLETION_REQUEST')
      OR (NEW.phase = 'SOURCE_FREEZE'
        AND json_extract(NEW.capability_grant_json, '$.candidateAccess') = 'FREEZE_READ'
        AND json_extract(NEW.capability_grant_json, '$.runOutputScope') = 'FREEZE_METADATA'
        AND json_extract(NEW.capability_grant_json, '$.controlSubmission') = 'RUNTIME_ONLY'
        AND json_extract(NEW.capability_grant_json, '$.acceptanceAccess') = 'NONE'
        AND json_array_length(NEW.capability_grant_json, '$.allowedActions') = 3
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[2]') = 'WRITE_RUN_OUTPUT')
      OR (NEW.phase = 'EVIDENCE_BUILD'
        AND json_extract(NEW.capability_grant_json, '$.candidateAccess') = 'FROZEN_READ'
        AND json_extract(NEW.capability_grant_json, '$.runOutputScope') = 'RUN_OWNED_VERIFICATION'
        AND json_extract(NEW.capability_grant_json, '$.controlSubmission') = 'EVIDENCE_SUBMISSION'
        AND json_extract(NEW.capability_grant_json, '$.acceptanceAccess') = 'NONE'
        AND json_array_length(NEW.capability_grant_json, '$.allowedActions') = 4
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[2]') = 'WRITE_RUN_OUTPUT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[3]') = 'SUBMIT_EVIDENCE')
      OR (NEW.phase = 'FINAL_VERIFY'
        AND json_extract(NEW.capability_grant_json, '$.candidateAccess') = 'FROZEN_READ'
        AND json_extract(NEW.capability_grant_json, '$.runOutputScope') = 'DECISION_TRACE'
        AND json_extract(NEW.capability_grant_json, '$.controlSubmission') = 'DECISION_SUBMISSION'
        AND json_extract(NEW.capability_grant_json, '$.acceptanceAccess') = 'EVALUATE_READ_ONLY'
        AND json_array_length(NEW.capability_grant_json, '$.allowedActions') = 5
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[2]') = 'WRITE_RUN_OUTPUT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[3]') = 'SUBMIT_DECISION'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[4]') = 'EVALUATE_ACCEPTANCE')
      OR (NEW.phase = 'CLOSEOUT'
        AND json_extract(NEW.capability_grant_json, '$.candidateAccess') = 'ACCEPTED_READ'
        AND json_extract(NEW.capability_grant_json, '$.runOutputScope') = 'CLOSEOUT_EXPORT'
        AND json_extract(NEW.capability_grant_json, '$.controlSubmission') = 'CONSUME_EXISTING'
        AND json_extract(NEW.capability_grant_json, '$.acceptanceAccess') = 'CONSUME_EXISTING'
        AND json_array_length(NEW.capability_grant_json, '$.allowedActions') = 4
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[0]') = 'READ_PROJECT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[1]') = 'READ_CANDIDATE'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[2]') = 'WRITE_RUN_OUTPUT'
        AND json_extract(NEW.capability_grant_json, '$.allowedActions[3]') = 'CONSUME_ACCEPTANCE')
    )
    AND length(NEW.started_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.started_at) = NEW.started_at,
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Attempt authority representation is invalid');
END;

CREATE TRIGGER attempts_authority_update_guard
BEFORE UPDATE ON attempts
WHEN COALESCE(
    (NEW.context_manifest_id IS NULL OR (
      length(NEW.context_manifest_id) BETWEEN 9 AND 136
      AND substr(NEW.context_manifest_id, 1, 8) = 'context_'
      AND substr(NEW.context_manifest_id, 9) NOT GLOB '*[^a-z0-9-]*'
      AND substr(NEW.context_manifest_id, 9, 1) GLOB '[a-z0-9]'
      AND substr(NEW.context_manifest_id, -1, 1) GLOB '[a-z0-9]'
    ))
    AND (NEW.worker_session_ref IS NULL OR (
      length(NEW.worker_session_ref) BETWEEN 8 AND 135
      AND substr(NEW.worker_session_ref, 1, 7) = 'worker_'
      AND substr(NEW.worker_session_ref, 8) NOT GLOB '*[^a-z0-9-]*'
      AND substr(NEW.worker_session_ref, 8, 1) GLOB '[a-z0-9]'
      AND substr(NEW.worker_session_ref, -1, 1) GLOB '[a-z0-9]'
    ))
    AND (NEW.ended_at IS NULL OR (
      length(NEW.ended_at) = 24
      AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.ended_at) = NEW.ended_at
    )),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Attempt authority representation is invalid');
END;

CREATE TRIGGER candidate_generations_authority_insert_guard
BEFORE INSERT ON candidate_generations
WHEN COALESCE(
    length(NEW.id) BETWEEN 12 AND 139
    AND substr(NEW.id, 1, 11) = 'generation_'
    AND substr(NEW.id, 12) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 12, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND length(NEW.candidate_id) BETWEEN 11 AND 138
    AND substr(NEW.candidate_id, 1, 10) = 'candidate_'
    AND substr(NEW.candidate_id, 11) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.candidate_id, 11, 1) GLOB '[a-z0-9]'
    AND substr(NEW.candidate_id, -1, 1) GLOB '[a-z0-9]'
    AND NEW.sequence <= 9007199254740991
    AND NEW.version <= 9007199254740991
    AND NEW.parent_generation_id IS NOT NEW.id
    AND length(NEW.base_digest) = 71
    AND substr(NEW.base_digest, 1, 7) = 'sha256:'
    AND substr(NEW.base_digest, 8) NOT GLOB '*[^0-9a-f]*'
    AND (NEW.frozen_digest IS NULL OR (
      length(NEW.frozen_digest) = 71
      AND substr(NEW.frozen_digest, 1, 7) = 'sha256:'
      AND substr(NEW.frozen_digest, 8) NOT GLOB '*[^0-9a-f]*'
    ))
    AND length(NEW.created_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) = NEW.created_at
    AND length(NEW.updated_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.updated_at) = NEW.updated_at
    AND NEW.updated_at >= NEW.created_at
    AND (NEW.frozen_at IS NULL OR (
      length(NEW.frozen_at) = 24
      AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.frozen_at) = NEW.frozen_at
      AND NEW.frozen_at >= NEW.created_at
      AND NEW.frozen_at <= NEW.updated_at
    ))
    AND (
      (NEW.state IN ('MUTABLE', 'FREEZING')
        AND NEW.frozen_digest IS NULL
        AND NEW.frozen_at IS NULL
        AND NEW.invalidation_reason IS NULL)
      OR (NEW.state IN ('FROZEN', 'REJECTED', 'ACCEPTED')
        AND NEW.frozen_digest IS NOT NULL
        AND NEW.frozen_at IS NOT NULL
        AND NEW.invalidation_reason IS NULL)
      OR (NEW.state = 'INVALIDATED'
        AND NEW.invalidation_reason IS NOT NULL
        AND length(trim(NEW.invalidation_reason)) > 0
        AND ((NEW.frozen_digest IS NULL AND NEW.frozen_at IS NULL)
          OR (NEW.frozen_digest IS NOT NULL AND NEW.frozen_at IS NOT NULL)))
    )
    AND NOT EXISTS (
      SELECT 1 FROM candidate_generations
      WHERE candidate_id = NEW.candidate_id
        AND workflow_id <> NEW.workflow_id
    )
    AND (
      NEW.parent_generation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM candidate_generations
        WHERE id = NEW.parent_generation_id
          AND candidate_id = NEW.candidate_id
          AND workflow_id = NEW.workflow_id
          AND sequence < NEW.sequence
      )
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Candidate generation authority representation is invalid');
END;

CREATE TRIGGER candidate_generations_authority_update_guard
BEFORE UPDATE ON candidate_generations
WHEN COALESCE(
    NEW.id = OLD.id
    AND NEW.candidate_id = OLD.candidate_id
    AND NEW.workflow_id = OLD.workflow_id
    AND NEW.sequence = OLD.sequence
    AND NEW.parent_generation_id IS OLD.parent_generation_id
    AND NEW.workspace_identity = OLD.workspace_identity
    AND NEW.base_digest = OLD.base_digest
    AND NEW.created_at = OLD.created_at
    AND NEW.version <= 9007199254740991
    AND length(NEW.updated_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.updated_at) = NEW.updated_at
    AND NEW.updated_at >= NEW.created_at
    AND (NEW.frozen_digest IS NULL OR (
      length(NEW.frozen_digest) = 71
      AND substr(NEW.frozen_digest, 1, 7) = 'sha256:'
      AND substr(NEW.frozen_digest, 8) NOT GLOB '*[^0-9a-f]*'
    ))
    AND (NEW.frozen_at IS NULL OR (
      length(NEW.frozen_at) = 24
      AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.frozen_at) = NEW.frozen_at
      AND NEW.frozen_at >= NEW.created_at
      AND NEW.frozen_at <= NEW.updated_at
    ))
    AND (
      (NEW.state IN ('MUTABLE', 'FREEZING')
        AND NEW.frozen_digest IS NULL
        AND NEW.frozen_at IS NULL
        AND NEW.invalidation_reason IS NULL)
      OR (NEW.state IN ('FROZEN', 'REJECTED', 'ACCEPTED')
        AND NEW.frozen_digest IS NOT NULL
        AND NEW.frozen_at IS NOT NULL
        AND NEW.invalidation_reason IS NULL)
      OR (NEW.state = 'INVALIDATED'
        AND NEW.invalidation_reason IS NOT NULL
        AND length(trim(NEW.invalidation_reason)) > 0
        AND ((NEW.frozen_digest IS NULL AND NEW.frozen_at IS NULL)
          OR (NEW.frozen_digest IS NOT NULL AND NEW.frozen_at IS NOT NULL)))
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Candidate generation authority representation is invalid');
END;

CREATE TRIGGER processed_commands_authority_insert_guard
BEFORE INSERT ON processed_commands
WHEN COALESCE(
    length(NEW.command_id) BETWEEN 9 AND 136
    AND substr(NEW.command_id, 1, 8) = 'command_'
    AND substr(NEW.command_id, 9) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.command_id, 9, 1) GLOB '[a-z0-9]'
    AND substr(NEW.command_id, -1, 1) GLOB '[a-z0-9]'
    AND length(NEW.input_digest) = 71
    AND substr(NEW.input_digest, 1, 7) = 'sha256:'
    AND substr(NEW.input_digest, 8) NOT GLOB '*[^0-9a-f]*'
    AND length(NEW.completed_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.completed_at) = NEW.completed_at,
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Processed command authority representation is invalid');
END;

CREATE TRIGGER audit_events_authority_insert_guard
BEFORE INSERT ON audit_events
WHEN COALESCE(
    length(trim(NEW.aggregate_type)) > 0
    AND length(trim(NEW.aggregate_id)) > 0
    AND length(trim(NEW.event_type)) > 0
    AND length(trim(NEW.actor_type)) > 0
    AND (NEW.correlation_id IS NULL OR length(trim(NEW.correlation_id)) > 0)
    AND (NEW.causation_id IS NULL OR length(trim(NEW.causation_id)) > 0)
    AND length(NEW.id) BETWEEN 7 AND 134
    AND substr(NEW.id, 1, 6) = 'audit_'
    AND substr(NEW.id, 7) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 7, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND NEW.sequence <= 9007199254740991
    AND (NEW.before_version IS NULL OR NEW.before_version <= 9007199254740991)
    AND (NEW.after_version IS NULL OR NEW.after_version <= 9007199254740991)
    AND (NEW.command_id IS NULL OR (
      length(NEW.command_id) BETWEEN 9 AND 136
      AND substr(NEW.command_id, 1, 8) = 'command_'
      AND substr(NEW.command_id, 9) NOT GLOB '*[^a-z0-9-]*'
      AND substr(NEW.command_id, 9, 1) GLOB '[a-z0-9]'
      AND substr(NEW.command_id, -1, 1) GLOB '[a-z0-9]'
    ))
    AND length(NEW.payload_digest) = 71
    AND substr(NEW.payload_digest, 1, 7) = 'sha256:'
    AND substr(NEW.payload_digest, 8) NOT GLOB '*[^0-9a-f]*'
    AND length(NEW.occurred_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.occurred_at) = NEW.occurred_at,
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'Audit event authority representation is invalid');
END;
