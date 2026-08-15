CREATE UNIQUE INDEX interaction_clarification_handoffs_message_idx
  ON interaction_message_handoffs(session_id, message_id)
  WHERE handoff_kind = 'INTAKE_CLARIFICATION';

CREATE UNIQUE INDEX interaction_result_messages_operation_idx
  ON interaction_messages(caused_by_operation_id)
  WHERE role IN ('FRONTSTAGE', 'SYSTEM');

DROP TRIGGER interaction_message_handoffs_b3_clarification_guard;

CREATE TRIGGER interaction_message_handoffs_clarification_authority_guard
BEFORE INSERT ON interaction_message_handoffs
WHEN NEW.handoff_kind = 'INTAKE_CLARIFICATION'
BEGIN
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM json_each(NEW.record_json)) <> 13 OR
    EXISTS (
      SELECT 1 FROM json_each(NEW.record_json)
      WHERE key NOT IN (
        'id', 'schemaVersion', 'kind', 'sessionId', 'messageRef', 'admittedUserContent',
        'admittedContentDigest', 'intakeCommandId', 'createdAt', 'handoffDigest',
        'focusRef', 'questionTarget', 'canonicalCommandInputDigest'
      )
    ) OR
    NOT EXISTS (
      SELECT 1
        FROM interaction_sessions AS session
        JOIN interaction_messages AS message
          ON message.id = NEW.message_id
         AND message.session_id = session.id
         AND message.message_digest = NEW.message_digest
        JOIN interaction_focus_bindings AS focus
          ON focus.id = NEW.focus_id
         AND focus.session_id = session.id
         AND focus.focus_digest = NEW.focus_digest
        JOIN intake_runs AS intake_run
          ON intake_run.id = NEW.intake_run_id
         AND intake_run.version = NEW.intake_run_version
         AND intake_run.status = 'NEEDS_CLARIFICATION'
         AND intake_run.active_question_id = NEW.clarification_question_id
        JOIN clarification_questions AS question
          ON question.id = NEW.clarification_question_id
         AND question.intake_run_id = intake_run.id
         AND question.question_digest = NEW.question_digest
       WHERE session.id = NEW.session_id
         AND session.state = 'OPEN'
         AND session.current_focus_id = focus.id
         AND session.current_focus_digest = focus.focus_digest
         AND focus.kind = 'INTAKE_QUESTION'
         AND message.role = 'USER'
         AND message.retention = 'RETAINED'
         AND message.principal_ref = session.principal_ref
         AND json_extract(message.record_json, '$.content') = NEW.admitted_user_content
         AND message.content_digest = NEW.admitted_content_digest
         AND NEW.created_at >= message.created_at
         AND NEW.created_at >= focus.created_at
         AND json_extract(focus.record_json, '$.questionTarget.intakeRunId') = NEW.intake_run_id
         AND json_extract(focus.record_json, '$.questionTarget.intakeRunVersion') =
               NEW.intake_run_version
         AND json_extract(focus.record_json, '$.questionTarget.clarificationQuestionId') =
               NEW.clarification_question_id
         AND json_extract(focus.record_json, '$.questionTarget.questionSpecDigest') =
               NEW.question_spec_digest
         AND json_extract(focus.record_json, '$.questionTarget.questionDigest') =
               NEW.question_digest
         AND question.intake_run_id = NEW.intake_run_id
         AND question.question_spec_digest = NEW.question_spec_digest
         AND json_extract(intake_run.record_json, '$.activeQuestionRef.clarificationQuestionId') =
               NEW.clarification_question_id
         AND json_extract(intake_run.record_json, '$.activeQuestionRef.questionSpecDigest') =
               NEW.question_spec_digest
         AND json_extract(intake_run.record_json, '$.activeQuestionRef.questionDigest') =
               NEW.question_digest
         AND json_extract(NEW.record_json, '$.focusRef.id') = focus.id
         AND json_extract(NEW.record_json, '$.focusRef.digest') = focus.focus_digest
         AND json_extract(NEW.record_json, '$.questionTarget.intakeRunId') = NEW.intake_run_id
         AND json_extract(NEW.record_json, '$.questionTarget.intakeRunVersion') =
               NEW.intake_run_version
         AND json_extract(NEW.record_json, '$.questionTarget.clarificationQuestionId') =
               NEW.clarification_question_id
         AND json_extract(NEW.record_json, '$.questionTarget.questionSpecDigest') =
               NEW.question_spec_digest
         AND json_extract(NEW.record_json, '$.questionTarget.questionDigest') =
               NEW.question_digest
         AND json_extract(NEW.record_json, '$.canonicalCommandInputDigest') =
               NEW.canonical_command_input_digest
    )
  THEN RAISE(ABORT, 'Intake clarification Handoff lacks exact Question authority') END;
END;

DROP TRIGGER interaction_operations_clarification_creation_guard;

CREATE TRIGGER interaction_operations_clarification_creation_guard
BEFORE INSERT ON interaction_operations
WHEN NEW.operation_kind = 'INTAKE_CLARIFICATION'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_message_handoffs AS handoff
     WHERE handoff.handoff_kind = 'INTAKE_CLARIFICATION'
       AND handoff.session_id = NEW.session_id
       AND handoff.message_id = NEW.message_id
       AND handoff.message_digest = NEW.message_digest
       AND handoff.created_at <= NEW.reserved_at
       AND NEW.state = 'RESERVED'
       AND NEW.version = 1
       AND NEW.context_manifest_id IS NULL
       AND NEW.assistant_profile_id IS NULL
  ) THEN RAISE(ABORT, 'Intake Clarification Operation lacks its exact Handoff') END;
END;

CREATE TRIGGER interaction_messages_presentation_result_guard
BEFORE INSERT ON interaction_messages
WHEN NEW.role IN ('FRONTSTAGE', 'SYSTEM')
BEGIN
  SELECT CASE WHEN
    NEW.retention <> 'RETAINED' OR
    NEW.content_byte_length = 0 OR
    NOT EXISTS (
      SELECT 1
        FROM interaction_operations AS operation
        JOIN interaction_sessions AS session ON session.id = operation.session_id
       WHERE operation.id = NEW.caused_by_operation_id
         AND operation.session_id = NEW.session_id
         AND operation.state = 'RESERVED'
         AND operation.operation_kind IN ('FRONTSTAGE_ANSWER', 'RESULT_PROJECTION')
         AND session.principal_ref = NEW.principal_ref
         AND NEW.created_at >= operation.reserved_at
         AND json_extract(NEW.record_json, '$.causedByOperationRef.id') = operation.id
         AND json_extract(NEW.record_json, '$.causedByOperationRef.digest') =
               NEW.caused_by_operation_digest
         AND json_extract(NEW.record_json, '$.content') IS NOT NULL
    )
  THEN RAISE(ABORT, 'Produced Interaction Message lacks its reserved result Operation') END;
END;

CREATE TRIGGER frontstage_answers_exact_authority_guard
BEFORE INSERT ON frontstage_answers
BEGIN
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM json_each(NEW.record_json)) <> 13 OR
    EXISTS (
      SELECT 1 FROM json_each(NEW.record_json)
      WHERE key NOT IN (
        'id', 'schemaVersion', 'sessionId', 'originatingMessageRef', 'routeDecisionRef',
        'proposalRef', 'assistantProfile', 'responseContract', 'retentionProfile',
        'answerContent', 'answerContentDigest', 'createdAt', 'answerDigest'
      )
    ) OR
    NOT EXISTS (
      SELECT 1
        FROM interaction_sessions AS session
        JOIN interaction_messages AS message
          ON message.id = NEW.originating_message_id
         AND message.session_id = session.id
         AND message.message_digest = NEW.originating_message_digest
        JOIN interaction_route_proposals AS proposal
          ON proposal.id = NEW.proposal_id
         AND proposal.session_id = session.id
         AND proposal.proposal_digest = NEW.proposal_digest
        JOIN interaction_route_decisions AS decision
          ON decision.id = NEW.route_decision_id
         AND decision.session_id = session.id
         AND decision.decision_digest = NEW.route_decision_digest
       WHERE session.id = NEW.session_id
         AND message.role = 'USER'
         AND message.retention = 'RETAINED'
         AND proposal.proposal_kind = 'ANSWER_PROPOSAL'
         AND proposal.message_id = message.id
         AND proposal.message_digest = message.message_digest
         AND decision.outcome = 'ANSWER'
         AND decision.message_id = message.id
         AND decision.message_digest = message.message_digest
         AND decision.proposal_id = proposal.id
         AND decision.proposal_digest = proposal.proposal_digest
         AND json_extract(NEW.record_json, '$.originatingMessageRef.digest') =
               message.message_digest
         AND json_extract(NEW.record_json, '$.routeDecisionRef.digest') =
               decision.decision_digest
         AND json_extract(NEW.record_json, '$.proposalRef.digest') = proposal.proposal_digest
         AND json_extract(NEW.record_json, '$.assistantProfile.id') =
               json_extract(proposal.record_json, '$.assistantProfile.id')
         AND json_extract(NEW.record_json, '$.assistantProfile.version') =
               json_extract(proposal.record_json, '$.assistantProfile.version')
         AND json_extract(NEW.record_json, '$.assistantProfile.digest') =
               json_extract(proposal.record_json, '$.assistantProfile.digest')
         AND json_extract(NEW.record_json, '$.responseContract.id') =
               json_extract(proposal.record_json, '$.responseContract.id')
         AND json_extract(NEW.record_json, '$.responseContract.version') =
               json_extract(proposal.record_json, '$.responseContract.version')
         AND json_extract(NEW.record_json, '$.responseContract.digest') =
               json_extract(proposal.record_json, '$.responseContract.digest')
         AND json_extract(NEW.record_json, '$.retentionProfile.id') =
               session.retention_profile_id
         AND json_extract(NEW.record_json, '$.retentionProfile.version') =
               session.retention_profile_version
         AND json_extract(NEW.record_json, '$.retentionProfile.digest') =
               session.retention_profile_digest
         AND json_extract(NEW.record_json, '$.answerContent') =
               json_extract(proposal.record_json, '$.answerContent')
         AND NEW.created_at >= proposal.observed_at
         AND NEW.created_at >= decision.decided_at
    )
  THEN RAISE(ABORT, 'Frontstage Answer lacks its exact Route authority') END;
END;

DROP TRIGGER interaction_operations_unimplemented_completion_guard;

CREATE TRIGGER interaction_operations_frontstage_answer_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind = 'FRONTSTAGE_ANSWER'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM frontstage_answers AS answer
      JOIN interaction_messages AS produced
        ON produced.caused_by_operation_id = NEW.id
       AND produced.caused_by_operation_digest = NEW.operation_digest
     WHERE answer.id = json_extract(NEW.record_json, '$.result.answerRef.id')
       AND answer.answer_digest = json_extract(NEW.record_json, '$.result.answerRef.digest')
       AND answer.session_id = NEW.session_id
       AND answer.originating_message_id = NEW.message_id
       AND answer.originating_message_digest = NEW.message_digest
       AND json_extract(NEW.record_json, '$.result.kind') = 'ANSWER_RECORDED'
       AND produced.session_id = NEW.session_id
       AND produced.role = 'FRONTSTAGE'
       AND produced.retention = 'RETAINED'
       AND produced.content_digest = answer.answer_content_digest
       AND json_extract(produced.record_json, '$.content') =
             json_extract(answer.record_json, '$.answerContent')
       AND produced.created_at = NEW.completed_at
       AND answer.created_at <= NEW.completed_at
  ) THEN RAISE(ABORT, 'Frontstage Answer completion lacks its exact Answer and Message') END;
END;

CREATE TRIGGER interaction_operations_goal_view_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind IN ('GOAL_LIST', 'GOAL_STATUS')
BEGIN
  SELECT CASE WHEN
    json_extract(NEW.record_json, '$.result.kind') <> 'GOAL_VIEW_RECORDED' OR
    json_type(NEW.record_json, '$.result.projectionDigest') <> 'text' OR
    (SELECT COUNT(*) FROM json_each(NEW.record_json, '$.result')) <> 2
  THEN RAISE(ABORT, 'Goal view completion lacks its exact projection result') END;
END;

CREATE TRIGGER interaction_operations_clarification_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind = 'INTAKE_CLARIFICATION'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_message_handoffs AS handoff
      JOIN intake_command_reservations AS reservation
        ON reservation.command_id = handoff.intake_command_id
       AND reservation.operation_kind = 'CLARIFICATION_ANALYSIS'
       AND reservation.intake_run_id = handoff.intake_run_id
       AND reservation.expected_intake_run_version = handoff.intake_run_version
       AND reservation.canonical_command_input_digest = handoff.canonical_command_input_digest
      JOIN intake_command_outcomes AS outcome
        ON outcome.command_id = reservation.command_id
       AND outcome.reservation_digest = reservation.reservation_digest
     WHERE handoff.handoff_kind = 'INTAKE_CLARIFICATION'
       AND handoff.session_id = NEW.session_id
       AND handoff.message_id = NEW.message_id
       AND handoff.message_digest = NEW.message_digest
       AND json_extract(reservation.record_json, '$.clarificationBinding.clarificationQuestionId') =
             handoff.clarification_question_id
       AND json_extract(reservation.record_json, '$.clarificationBinding.questionSpecDigest') =
             handoff.question_spec_digest
       AND json_extract(reservation.record_json, '$.clarificationBinding.questionDigest') =
             handoff.question_digest
       AND json_extract(NEW.record_json, '$.result.kind') = 'PUBLIC_COMMAND_RECORDED'
       AND json_extract(NEW.record_json, '$.result.commandId') = outcome.command_id
       AND json_extract(NEW.record_json, '$.result.publicCommandOutcomeDigest') =
             outcome.outcome_digest
       AND (SELECT COUNT(*) FROM json_each(NEW.record_json, '$.result')) = 3
       AND NEW.completed_at = outcome.completed_at
  ) THEN RAISE(ABORT, 'Intake clarification completion lacks its exact public outcome') END;
END;

CREATE TRIGGER interaction_operations_result_projection_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind = 'RESULT_PROJECTION'
BEGIN
  SELECT CASE WHEN
    json_extract(NEW.record_json, '$.result.kind') <> 'RESULT_PROJECTED' OR
    json_type(NEW.record_json, '$.result.projectionDigest') <> 'text' OR
    (SELECT COUNT(*) FROM json_each(NEW.record_json, '$.result')) <> 2 OR
    NOT EXISTS (
      SELECT 1
        FROM interaction_messages AS produced
       WHERE produced.caused_by_operation_id = NEW.id
         AND produced.caused_by_operation_digest = NEW.operation_digest
         AND produced.session_id = NEW.session_id
         AND produced.role IN ('FRONTSTAGE', 'SYSTEM')
         AND produced.retention = 'RETAINED'
         AND produced.created_at = NEW.completed_at
    )
  THEN RAISE(ABORT, 'Result projection completion lacks its exact produced Message') END;
END;
