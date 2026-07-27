CREATE TABLE processed_command_semantic_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

-- Version 2 records bind identity but do not prove whether their public output
-- agrees with the transaction that was actually committed. There is no safe
-- historical reconstruction for that missing fact, so the migration fails
-- closed instead of manufacturing a version 3 disposition or snapshot.
INSERT INTO processed_command_semantic_migration_guard(valid)
SELECT 0
WHERE EXISTS (SELECT 1 FROM processed_commands);

DROP TABLE processed_command_semantic_migration_guard;

DROP TRIGGER processed_commands_outcome_insert_guard;

CREATE TRIGGER processed_commands_outcome_insert_guard
BEFORE INSERT ON processed_commands
WHEN COALESCE(
    json_extract(NEW.outcome_json, '$.schemaVersion') = 3
    AND json_type(NEW.outcome_json, '$.disposition') = 'text'
    AND json_extract(NEW.outcome_json, '$.disposition') IN ('APPLIED', 'REJECTED')
    AND json_type(NEW.outcome_json, '$.target') = 'object'
    AND json_extract(NEW.outcome_json, '$.target.aggregateType') = NEW.aggregate_type
    AND json_extract(NEW.outcome_json, '$.target.aggregateId') = NEW.aggregate_id
    AND json_type(NEW.outcome_json, '$.goalId') = 'text'
    AND json_type(NEW.outcome_json, '$.workflow') = 'object'
    AND json_type(NEW.outcome_json, '$.workflow.id') = 'text'
    AND json_type(NEW.outcome_json, '$.workflow.version') = 'integer'
    AND json_extract(NEW.outcome_json, '$.workflow.version') >= 1
    AND json_type(NEW.outcome_json, '$.workflow.phase') = 'text'
    AND json_type(NEW.outcome_json, '$.workflow.runStatus') = 'text'
    AND json_type(NEW.outcome_json, '$.output') = 'object'
    AND json_extract(NEW.outcome_json, '$.output.schemaVersion') = 1
    AND json_extract(NEW.outcome_json, '$.output.commandId') = NEW.command_id
    AND EXISTS (
      SELECT 1
      FROM goals
      WHERE goals.id = json_extract(NEW.outcome_json, '$.goalId')
    )
    AND EXISTS (
      SELECT 1
      FROM workflows
      WHERE workflows.id = json_extract(NEW.outcome_json, '$.workflow.id')
        AND workflows.goal_id = json_extract(NEW.outcome_json, '$.goalId')
        AND workflows.version = json_extract(NEW.outcome_json, '$.workflow.version')
        AND workflows.phase = json_extract(NEW.outcome_json, '$.workflow.phase')
        AND workflows.run_status = json_extract(NEW.outcome_json, '$.workflow.runStatus')
    )
    AND (
      (
        NEW.aggregate_type = 'GOAL'
        AND NEW.aggregate_id = json_extract(NEW.outcome_json, '$.goalId')
      )
      OR (
        NEW.aggregate_type = 'WORKFLOW'
        AND NEW.aggregate_id = json_extract(NEW.outcome_json, '$.workflow.id')
      )
    )
    AND (
      (
        json_extract(NEW.outcome_json, '$.disposition') = 'APPLIED'
        AND json_type(NEW.outcome_json, '$.output.ok') = 'true'
        AND json_extract(NEW.outcome_json, '$.output.goalId') =
          json_extract(NEW.outcome_json, '$.goalId')
        AND json_extract(NEW.outcome_json, '$.output.workflowVersion') =
          json_extract(NEW.outcome_json, '$.workflow.version')
        AND json_extract(NEW.outcome_json, '$.output.phase') =
          json_extract(NEW.outcome_json, '$.workflow.phase')
        AND json_extract(NEW.outcome_json, '$.output.runStatus') =
          json_extract(NEW.outcome_json, '$.workflow.runStatus')
      )
      OR (
        json_extract(NEW.outcome_json, '$.disposition') = 'REJECTED'
        AND json_type(NEW.outcome_json, '$.output.ok') = 'false'
        AND json_type(NEW.outcome_json, '$.output.error') = 'object'
        AND json_type(NEW.outcome_json, '$.output.error.code') = 'text'
        AND json_extract(NEW.outcome_json, '$.output.error.code') IN (
          'NOT_FOUND',
          'DOMAIN_REJECTED',
          'STALE_GOAL_REVISION',
          'STALE_WORKFLOW_VERSION'
        )
        AND json_type(NEW.outcome_json, '$.output.error.message') = 'text'
        AND length(json_extract(NEW.outcome_json, '$.output.error.message')) >= 1
        AND json_type(NEW.outcome_json, '$.output.error.retryable') IN ('true', 'false')
        AND json_type(NEW.outcome_json, '$.output.error.detailCode') = 'text'
        AND length(json_extract(NEW.outcome_json, '$.output.error.detailCode')) >= 1
      )
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'processed command outcome semantic binding is invalid');
END;
