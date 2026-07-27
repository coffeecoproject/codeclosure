CREATE TABLE processed_command_outcome_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO processed_command_outcome_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM processed_commands
  WHERE COALESCE(
      json_extract(outcome_json, '$.schemaVersion') = 2
      AND json_type(outcome_json, '$.target') = 'object'
      AND json_extract(outcome_json, '$.target.aggregateType') = aggregate_type
      AND json_extract(outcome_json, '$.target.aggregateId') = aggregate_id
      AND json_type(outcome_json, '$.goalId') = 'text'
      AND json_type(outcome_json, '$.output') = 'object'
      AND json_extract(outcome_json, '$.output.schemaVersion') = 1
      AND json_extract(outcome_json, '$.output.commandId') = command_id
      AND json_type(outcome_json, '$.output.ok') IN ('true', 'false')
      AND (
        json_type(outcome_json, '$.output.ok') = 'false'
        OR json_extract(outcome_json, '$.output.goalId') = json_extract(outcome_json, '$.goalId')
      )
      AND (
        (
          aggregate_type = 'GOAL'
          AND aggregate_id = json_extract(outcome_json, '$.goalId')
        )
        OR (
          aggregate_type = 'WORKFLOW'
          AND EXISTS (
            SELECT 1
            FROM workflows
            WHERE workflows.id = processed_commands.aggregate_id
              AND workflows.goal_id = json_extract(processed_commands.outcome_json, '$.goalId')
          )
        )
      ),
      0
    ) = 0
);

DROP TABLE processed_command_outcome_migration_guard;

CREATE TRIGGER processed_commands_outcome_insert_guard
BEFORE INSERT ON processed_commands
WHEN COALESCE(
    json_extract(NEW.outcome_json, '$.schemaVersion') = 2
    AND json_type(NEW.outcome_json, '$.target') = 'object'
    AND json_extract(NEW.outcome_json, '$.target.aggregateType') = NEW.aggregate_type
    AND json_extract(NEW.outcome_json, '$.target.aggregateId') = NEW.aggregate_id
    AND json_type(NEW.outcome_json, '$.goalId') = 'text'
    AND json_type(NEW.outcome_json, '$.output') = 'object'
    AND json_extract(NEW.outcome_json, '$.output.schemaVersion') = 1
    AND json_extract(NEW.outcome_json, '$.output.commandId') = NEW.command_id
    AND json_type(NEW.outcome_json, '$.output.ok') IN ('true', 'false')
    AND (
      json_type(NEW.outcome_json, '$.output.ok') = 'false'
      OR json_extract(NEW.outcome_json, '$.output.goalId') = json_extract(NEW.outcome_json, '$.goalId')
    )
    AND (
      (
        NEW.aggregate_type = 'GOAL'
        AND NEW.aggregate_id = json_extract(NEW.outcome_json, '$.goalId')
      )
      OR (
        NEW.aggregate_type = 'WORKFLOW'
        AND EXISTS (
          SELECT 1
          FROM workflows
          WHERE workflows.id = NEW.aggregate_id
            AND workflows.goal_id = json_extract(NEW.outcome_json, '$.goalId')
        )
      )
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'processed command outcome identity binding is invalid');
END;
