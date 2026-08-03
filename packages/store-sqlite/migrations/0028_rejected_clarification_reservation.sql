PRAGMA defer_foreign_keys = ON;

DROP TRIGGER intake_command_reservations_no_update;
DROP TRIGGER intake_command_reservations_no_delete;
DROP TRIGGER intake_command_outcomes_exact_reservation_guard;
DROP TRIGGER intake_abandonment_outcome_guard;
DROP INDEX intake_reservations_run_idx;

CREATE TABLE intake_command_reservations_v2 (
  command_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  operation_kind TEXT NOT NULL CHECK (
    operation_kind IN ('INTENT_ANALYSIS', 'ANSWER_ONLY', 'CLARIFICATION_ANALYSIS', 'ABANDON_CLARIFICATION', 'IMMEDIATE_NO_EXECUTION')
  ),
  principal_ref TEXT NOT NULL,
  raw_request_id TEXT NOT NULL REFERENCES raw_requests(id) ON DELETE RESTRICT,
  intake_run_id TEXT NOT NULL REFERENCES intake_runs(id) ON DELETE RESTRICT,
  canonical_command_input_digest TEXT NOT NULL,
  expected_intake_run_version INTEGER,
  observed_intake_run_version INTEGER NOT NULL CHECK (observed_intake_run_version >= 1),
  operation_id TEXT NOT NULL UNIQUE,
  manifest_id TEXT,
  manifest_digest TEXT,
  reservation_digest TEXT NOT NULL UNIQUE,
  reserved_at TEXT NOT NULL,
  has_abandonment_binding INTEGER NOT NULL CHECK (has_abandonment_binding IN (0, 1)),
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json) AND json_type(record_json) = 'object'
  ),
  UNIQUE (command_id, reservation_digest),
  FOREIGN KEY (manifest_id, manifest_digest)
    REFERENCES intake_manifests(id, manifest_digest) ON DELETE RESTRICT,
  CHECK (
    (operation_kind IN ('INTENT_ANALYSIS', 'ANSWER_ONLY') AND
      manifest_id IS NOT NULL AND manifest_digest IS NOT NULL) OR
    (operation_kind = 'CLARIFICATION_ANALYSIS' AND
      ((manifest_id IS NOT NULL AND manifest_digest IS NOT NULL) OR
       (manifest_id IS NULL AND manifest_digest IS NULL))) OR
    (operation_kind IN ('ABANDON_CLARIFICATION', 'IMMEDIATE_NO_EXECUTION') AND
      manifest_id IS NULL AND manifest_digest IS NULL)
  ),
  CHECK (
    operation_kind NOT IN ('CLARIFICATION_ANALYSIS', 'ABANDON_CLARIFICATION') OR
    expected_intake_run_version IS NOT NULL
  ),
  CHECK (
    (operation_kind = 'ABANDON_CLARIFICATION') OR has_abandonment_binding = 0
  ),
  CHECK (json_extract(record_json, '$.commandId') = command_id),
  CHECK (json_extract(record_json, '$.operationKind') = operation_kind),
  CHECK (json_extract(record_json, '$.reservationDigest') = reservation_digest)
) STRICT;

INSERT INTO intake_command_reservations_v2(
  command_id, schema_version, operation_kind, principal_ref, raw_request_id,
  intake_run_id, canonical_command_input_digest, expected_intake_run_version,
  observed_intake_run_version, operation_id, manifest_id, manifest_digest,
  reservation_digest, reserved_at, has_abandonment_binding, record_json
)
SELECT
  command_id, schema_version, operation_kind, principal_ref, raw_request_id,
  intake_run_id, canonical_command_input_digest, expected_intake_run_version,
  observed_intake_run_version, operation_id, manifest_id, manifest_digest,
  reservation_digest, reserved_at, has_abandonment_binding, record_json
FROM intake_command_reservations;

DROP TABLE intake_command_reservations;
ALTER TABLE intake_command_reservations_v2 RENAME TO intake_command_reservations;

CREATE INDEX intake_reservations_run_idx
  ON intake_command_reservations(intake_run_id, reserved_at, command_id);

CREATE TRIGGER intake_command_reservations_no_update
BEFORE UPDATE ON intake_command_reservations
BEGIN
  SELECT RAISE(ABORT, 'Intake command reservations are immutable');
END;

CREATE TRIGGER intake_command_reservations_no_delete
BEFORE DELETE ON intake_command_reservations
BEGIN
  SELECT RAISE(ABORT, 'Intake command reservations are immutable');
END;

CREATE TRIGGER intake_command_outcomes_exact_reservation_guard
BEFORE INSERT ON intake_command_outcomes
WHEN NOT EXISTS (
  SELECT 1 FROM intake_command_reservations AS reservation
   WHERE reservation.command_id = NEW.command_id
     AND reservation.intake_run_id = NEW.intake_run_id
     AND reservation.canonical_command_input_digest = NEW.canonical_command_input_digest
     AND reservation.reservation_digest = NEW.reservation_digest
     AND reservation.observed_intake_run_version = NEW.observed_intake_run_version
     AND NEW.completed_at >= reservation.reserved_at
)
BEGIN
  SELECT RAISE(ABORT, 'Intake outcome does not match its exact reservation');
END;

CREATE TRIGGER intake_abandonment_outcome_guard
BEFORE INSERT ON intake_command_outcomes
WHEN EXISTS (
  SELECT 1 FROM intake_command_reservations AS reservation
   WHERE reservation.command_id = NEW.command_id
     AND reservation.operation_kind = 'ABANDON_CLARIFICATION'
) AND NOT (
  (NEW.disposition = 'APPLIED' AND NEW.result_kind = 'NO_EXECUTION' AND
    (SELECT has_abandonment_binding FROM intake_command_reservations WHERE command_id = NEW.command_id) = 1) OR
  (NEW.disposition = 'REJECTED' AND NEW.result_kind = 'REJECTED' AND
    (SELECT has_abandonment_binding FROM intake_command_reservations WHERE command_id = NEW.command_id) = 0)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid abandonment reservation/outcome shape');
END;
