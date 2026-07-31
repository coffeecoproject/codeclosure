CREATE TABLE evidence_obligation_causal_time_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

CREATE TRIGGER evidence_obligation_causal_time_migration_guard_reject
BEFORE INSERT ON evidence_obligation_causal_time_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(ABORT, 'legacy-evidence-before-obligation-authority');
END;

-- Verification Evidence cannot predate the exact Obligation that authorized
-- its production. Refuse an upgrade rather than normalizing historical time.
INSERT INTO evidence_obligation_causal_time_migration_guard(valid)
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM evidence_records AS evidence
  JOIN verification_obligations AS obligation
    ON obligation.id = evidence.verification_obligation_id
  WHERE evidence.kind IN ('TEST_RESULT', 'LOCAL_COMMAND_TEST_RESULT')
    AND evidence.started_at < obligation.created_at
);

DROP TRIGGER evidence_obligation_causal_time_migration_guard_reject;
DROP TABLE evidence_obligation_causal_time_migration_guard;

CREATE TRIGGER evidence_records_obligation_causal_insert_guard
BEFORE INSERT ON evidence_records
WHEN NEW.kind IN ('TEST_RESULT', 'LOCAL_COMMAND_TEST_RESULT')
  AND NOT EXISTS (
    SELECT 1
    FROM verification_obligations AS obligation
    WHERE obligation.id = NEW.verification_obligation_id
      AND obligation.goal_id = NEW.goal_id
      AND obligation.goal_revision = NEW.goal_revision
      AND obligation.candidate_generation_id = NEW.candidate_generation_id
      AND obligation.required_evidence_kind = NEW.kind
      AND obligation.check_spec_ref =
        json_extract(NEW.check_spec_json, '$.id') || '@' ||
        json_extract(NEW.check_spec_json, '$.version')
      AND NEW.started_at >= obligation.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'Verification Evidence predates its Obligation authority');
END;
