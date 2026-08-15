CREATE TABLE interaction_handoff_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO interaction_handoff_migration_guard(valid)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM interaction_message_handoffs;

DROP TRIGGER interaction_message_handoffs_no_update;
DROP TRIGGER interaction_message_handoffs_no_delete;
DROP TABLE interaction_message_handoffs;

CREATE TABLE interaction_message_handoffs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  handoff_kind TEXT NOT NULL CHECK (
    handoff_kind IN ('AUTHORIZED_INTAKE_ACTION', 'INTAKE_CLARIFICATION')
  ),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  message_id TEXT NOT NULL,
  message_digest TEXT NOT NULL,
  pending_action_id TEXT,
  pending_action_digest TEXT,
  resolution_id TEXT,
  resolution_digest TEXT,
  reservation_id TEXT UNIQUE,
  reservation_digest TEXT,
  focus_id TEXT,
  focus_digest TEXT,
  intake_run_id TEXT,
  intake_run_version INTEGER,
  clarification_question_id TEXT,
  question_spec_digest TEXT,
  question_digest TEXT,
  canonical_command_input_digest TEXT,
  intake_command_id TEXT NOT NULL UNIQUE,
  admitted_user_content TEXT NOT NULL CHECK (length(admitted_user_content) > 0),
  admitted_content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (
    length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'
  ),
  handoff_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, handoff_digest),
  FOREIGN KEY (message_id, session_id, message_digest)
    REFERENCES interaction_messages(id, session_id, message_digest) ON DELETE RESTRICT,
  FOREIGN KEY (pending_action_id, session_id, pending_action_digest)
    REFERENCES interaction_pending_actions(id, session_id, pending_action_digest)
    ON DELETE RESTRICT,
  FOREIGN KEY (resolution_id, pending_action_id, resolution_digest)
    REFERENCES interaction_pending_action_resolutions(id, pending_action_id, resolution_digest)
    ON DELETE RESTRICT,
  FOREIGN KEY (reservation_id, intake_command_id, reservation_digest)
    REFERENCES interaction_action_reservations(id, command_id, reservation_digest)
    ON DELETE RESTRICT,
  FOREIGN KEY (focus_id, session_id, focus_digest)
    REFERENCES interaction_focus_bindings(id, session_id, focus_digest) ON DELETE RESTRICT,
  FOREIGN KEY (clarification_question_id, question_digest)
    REFERENCES clarification_questions(id, question_digest) ON DELETE RESTRICT,
  CHECK (
    (handoff_kind = 'AUTHORIZED_INTAKE_ACTION' AND
      pending_action_id IS NOT NULL AND pending_action_digest IS NOT NULL AND
      resolution_id IS NOT NULL AND resolution_digest IS NOT NULL AND
      reservation_id IS NOT NULL AND reservation_digest IS NOT NULL AND
      focus_id IS NULL AND focus_digest IS NULL AND intake_run_id IS NULL AND
      intake_run_version IS NULL AND clarification_question_id IS NULL AND
      question_spec_digest IS NULL AND question_digest IS NULL AND
      canonical_command_input_digest IS NULL) OR
    (handoff_kind = 'INTAKE_CLARIFICATION' AND
      pending_action_id IS NULL AND pending_action_digest IS NULL AND
      resolution_id IS NULL AND resolution_digest IS NULL AND reservation_id IS NULL AND
      reservation_digest IS NULL AND focus_id IS NOT NULL AND focus_digest IS NOT NULL AND
      intake_run_id IS NOT NULL AND intake_run_version IS NOT NULL AND
      clarification_question_id IS NOT NULL AND question_spec_digest IS NOT NULL AND
      question_digest IS NOT NULL AND canonical_command_input_digest IS NOT NULL)
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.kind') = handoff_kind),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.messageRef.id') = message_id),
  CHECK (json_extract(record_json, '$.messageRef.digest') = message_digest),
  CHECK (json_extract(record_json, '$.intakeCommandId') = intake_command_id),
  CHECK (json_extract(record_json, '$.admittedUserContent') = admitted_user_content),
  CHECK (json_extract(record_json, '$.admittedContentDigest') = admitted_content_digest),
  CHECK (json_extract(record_json, '$.createdAt') = created_at),
  CHECK (json_extract(record_json, '$.handoffDigest') = handoff_digest)
) STRICT;

CREATE INDEX interaction_message_handoffs_session_idx
  ON interaction_message_handoffs(session_id, created_at, id);

CREATE TRIGGER interaction_message_handoffs_no_update
BEFORE UPDATE ON interaction_message_handoffs
BEGIN
  SELECT RAISE(ABORT, 'Interaction Message Handoff is immutable');
END;

CREATE TRIGGER interaction_message_handoffs_no_delete
BEFORE DELETE ON interaction_message_handoffs
BEGIN
  SELECT RAISE(ABORT, 'Interaction Message Handoff cannot be deleted');
END;

CREATE TRIGGER interaction_message_handoffs_b3_clarification_guard
BEFORE INSERT ON interaction_message_handoffs
WHEN NEW.handoff_kind = 'INTAKE_CLARIFICATION'
BEGIN
  SELECT RAISE(ABORT, 'Intake clarification Handoff has no B3 Store owner');
END;

CREATE TRIGGER interaction_message_handoffs_action_authority_guard
BEFORE INSERT ON interaction_message_handoffs
WHEN NEW.handoff_kind = 'AUTHORIZED_INTAKE_ACTION'
BEGIN
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM json_each(NEW.record_json)) <> 13 OR
    EXISTS (
      SELECT 1 FROM json_each(NEW.record_json)
      WHERE key NOT IN (
        'id', 'schemaVersion', 'kind', 'sessionId', 'messageRef', 'admittedUserContent',
        'admittedContentDigest', 'intakeCommandId', 'createdAt', 'handoffDigest',
        'pendingActionRef', 'resolutionRef', 'reservationRef'
      )
    ) OR
    NOT EXISTS (
      SELECT 1
      FROM interaction_pending_actions AS action
      JOIN interaction_pending_action_resolutions AS resolution
        ON resolution.id = NEW.resolution_id
       AND resolution.pending_action_id = action.id
       AND resolution.resolution_digest = NEW.resolution_digest
      JOIN interaction_action_reservations AS reservation
        ON reservation.id = NEW.reservation_id
       AND reservation.pending_action_id = action.id
       AND reservation.pending_action_digest = action.pending_action_digest
       AND reservation.resolution_id = resolution.id
       AND reservation.resolution_digest = resolution.resolution_digest
       AND reservation.reservation_digest = NEW.reservation_digest
      JOIN interaction_messages AS message
        ON message.id = NEW.message_id
       AND message.session_id = NEW.session_id
       AND message.message_digest = NEW.message_digest
     WHERE action.id = NEW.pending_action_id
       AND action.session_id = NEW.session_id
       AND action.pending_action_digest = NEW.pending_action_digest
       AND action.originating_message_id = message.id
       AND action.originating_message_digest = message.message_digest
       AND action.public_capability = 'SUBMIT_INTAKE'
       AND resolution.disposition IN ('DIRECT_USER_AUTHORIZED', 'SEPARATE_RESPONSE_CONFIRMED')
       AND reservation.public_capability = 'SUBMIT_INTAKE'
       AND reservation.command_id = NEW.intake_command_id
       AND message.role = 'USER'
       AND message.retention = 'RETAINED'
       AND json_extract(message.record_json, '$.content') = NEW.admitted_user_content
       AND message.content_digest = NEW.admitted_content_digest
       AND NEW.created_at >= reservation.reserved_at
       AND json_extract(NEW.record_json, '$.pendingActionRef.id') = action.id
       AND json_extract(NEW.record_json, '$.pendingActionRef.digest') = action.pending_action_digest
       AND json_extract(NEW.record_json, '$.resolutionRef.id') = resolution.id
       AND json_extract(NEW.record_json, '$.resolutionRef.digest') = resolution.resolution_digest
       AND json_extract(NEW.record_json, '$.reservationRef.id') = reservation.id
       AND json_extract(NEW.record_json, '$.reservationRef.digest') = reservation.reservation_digest
    )
  THEN RAISE(ABORT, 'Intake Action Handoff lacks exact authorized authority') END;
END;

CREATE TRIGGER interaction_action_outcomes_exact_public_authority_guard
BEFORE INSERT ON interaction_action_outcomes
BEGIN
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM json_each(NEW.record_json)) <> 10 OR
    EXISTS (
      SELECT 1 FROM json_each(NEW.record_json)
      WHERE key NOT IN (
        'id', 'schemaVersion', 'reservationRef', 'commandId',
        'canonicalCommandInputDigest', 'disposition', 'publicCommandOutcomeDigest',
        'resultProjectionDigest', 'completedAt', 'outcomeDigest'
      )
    ) OR
    NOT EXISTS (
      SELECT 1
      FROM interaction_action_reservations AS reservation
      JOIN interaction_pending_actions AS action
        ON action.id = reservation.pending_action_id
       AND action.session_id = reservation.session_id
       AND action.pending_action_digest = reservation.pending_action_digest
     WHERE reservation.id = NEW.reservation_id
       AND reservation.session_id = NEW.session_id
       AND reservation.command_id = NEW.command_id
       AND reservation.canonical_command_input_digest = NEW.canonical_command_input_digest
       AND reservation.reservation_digest = NEW.reservation_digest
       AND NEW.completed_at >= reservation.reserved_at
       AND json_extract(NEW.record_json, '$.schemaVersion') = NEW.schema_version
       AND json_extract(NEW.record_json, '$.reservationRef.digest') = reservation.reservation_digest
       AND json_extract(NEW.record_json, '$.completedAt') = NEW.completed_at
       AND (
         (reservation.public_capability = 'SUBMIT_INTAKE' AND
           EXISTS (
             SELECT 1 FROM intake_command_outcomes AS public_outcome
              WHERE public_outcome.command_id = reservation.command_id
                AND public_outcome.canonical_command_input_digest =
                  reservation.canonical_command_input_digest
                AND public_outcome.completed_at = NEW.completed_at
                AND public_outcome.disposition = NEW.disposition
                AND public_outcome.outcome_digest = NEW.public_command_outcome_digest
                AND public_outcome.result_digest = NEW.result_projection_digest
           ) AND EXISTS (
             SELECT 1 FROM interaction_message_handoffs AS handoff
              WHERE handoff.reservation_id = reservation.id
                AND handoff.handoff_kind = 'AUTHORIZED_INTAKE_ACTION'
           )) OR
         (reservation.public_capability IN ('START_GOAL', 'RESUME_GOAL', 'CANCEL_GOAL') AND
           EXISTS (
             SELECT 1 FROM processed_commands AS public_outcome
              WHERE public_outcome.command_id = reservation.command_id
                AND public_outcome.input_digest = reservation.canonical_command_input_digest
                AND public_outcome.completed_at = NEW.completed_at
                AND json_extract(public_outcome.outcome_json, '$.output.commandId') =
                  reservation.command_id
                AND ((json_extract(public_outcome.outcome_json, '$.disposition') = 'APPLIED' AND
                    NEW.disposition = 'APPLIED') OR
                  (json_extract(public_outcome.outcome_json, '$.disposition') = 'REJECTED' AND
                    NEW.disposition = 'REJECTED'))
           ))
       )
    )
  THEN RAISE(ABORT, 'Interaction Action Outcome lacks exact retained public authority') END;
END;

DROP TRIGGER interaction_operations_unimplemented_completion_guard;

CREATE TRIGGER interaction_operations_intake_handoff_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind = 'INTAKE_HANDOFF'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_message_handoffs AS handoff
      JOIN interaction_action_reservations AS reservation
        ON reservation.id = handoff.reservation_id
       AND reservation.reservation_digest = handoff.reservation_digest
      JOIN interaction_pending_action_resolutions AS resolution
        ON resolution.id = handoff.resolution_id
       AND resolution.resolution_digest = handoff.resolution_digest
     WHERE handoff.id = json_extract(NEW.record_json, '$.result.handoffRef.id')
       AND handoff.handoff_digest = json_extract(NEW.record_json, '$.result.handoffRef.digest')
       AND handoff.session_id = NEW.session_id
       AND handoff.handoff_kind = 'AUTHORIZED_INTAKE_ACTION'
       AND json_extract(NEW.record_json, '$.result.kind') = 'INTAKE_HANDOFF_RECORDED'
       AND NEW.reserved_at <= handoff.created_at
       AND (
         (resolution.disposition = 'DIRECT_USER_AUTHORIZED' AND
           NEW.message_id = handoff.message_id AND NEW.message_digest = handoff.message_digest) OR
         (resolution.disposition = 'SEPARATE_RESPONSE_CONFIRMED' AND
           NEW.message_id = json_extract(resolution.record_json, '$.authorizingMessageRef.id') AND
           NEW.message_digest = json_extract(resolution.record_json, '$.authorizingMessageRef.digest'))
       )
  ) THEN RAISE(ABORT, 'Intake Handoff Operation completion lacks its exact Handoff result') END;
END;

CREATE TRIGGER interaction_operations_unimplemented_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind NOT IN (
  'ROUTE', 'ACTION_PROPOSAL', 'ACTION_CONFIRMATION', 'INTAKE_HANDOFF'
)
BEGIN
  SELECT RAISE(ABORT, 'Interaction Operation completion has no implemented result owner');
END;

DROP TABLE interaction_handoff_migration_guard;
