CREATE UNIQUE INDEX interaction_pending_actions_one_per_route_decision_idx
  ON interaction_pending_actions(route_decision_id);

CREATE UNIQUE INDEX interaction_operations_one_action_proposal_per_message_idx
  ON interaction_operations(session_id, message_id)
  WHERE operation_kind = 'ACTION_PROPOSAL';

CREATE UNIQUE INDEX interaction_operations_one_action_confirmation_per_message_idx
  ON interaction_operations(session_id, message_id)
  WHERE operation_kind = 'ACTION_CONFIRMATION';

CREATE TRIGGER interaction_pending_actions_exact_authority_guard
BEFORE INSERT ON interaction_pending_actions
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM interaction_pending_actions AS existing
      LEFT JOIN interaction_pending_action_resolutions AS resolution
        ON resolution.pending_action_id = existing.id
     WHERE existing.session_id = NEW.session_id
       AND resolution.id IS NULL
  ) THEN RAISE(ABORT, 'Interaction Session already has an unresolved Pending Action') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_sessions AS session
      JOIN interaction_messages AS message
        ON message.id = NEW.originating_message_id
       AND message.session_id = NEW.session_id
       AND message.message_digest = NEW.originating_message_digest
      JOIN interaction_route_decisions AS decision
        ON decision.id = NEW.route_decision_id
       AND decision.session_id = NEW.session_id
       AND decision.decision_digest = NEW.route_decision_digest
     WHERE session.id = NEW.session_id
       AND session.state = 'OPEN'
       AND session.version = decision.expected_session_version
       AND message.role = 'USER'
       AND message.retention = 'RETAINED'
       AND message.created_at = session.updated_at
       AND decision.message_id = message.id
       AND decision.message_digest = message.message_digest
       AND json_extract(NEW.record_json, '$.schemaVersion') = NEW.schema_version
       AND json_extract(NEW.record_json, '$.principalRef') = session.principal_ref
       AND json_extract(NEW.record_json, '$.projectRef.normalizedPath') = session.project_path
       AND json_extract(NEW.record_json, '$.projectRef.identityDigest') = session.project_identity_digest
       AND json_extract(NEW.record_json, '$.originatingMessageRef.id') = message.id
       AND json_extract(NEW.record_json, '$.originatingMessageRef.digest') = message.message_digest
       AND json_extract(NEW.record_json, '$.routeDecisionRef.id') = decision.id
       AND json_extract(NEW.record_json, '$.routeDecisionRef.digest') = decision.decision_digest
       AND json_extract(NEW.record_json, '$.routingPolicy.id') = session.routing_policy_id
       AND json_extract(NEW.record_json, '$.routingPolicy.version') = session.routing_policy_version
       AND json_extract(NEW.record_json, '$.routingPolicy.digest') = session.routing_policy_digest
       AND json_extract(NEW.record_json, '$.confirmationPolicy.id') = session.confirmation_policy_id
       AND json_extract(NEW.record_json, '$.confirmationPolicy.version') = session.confirmation_policy_version
       AND json_extract(NEW.record_json, '$.confirmationPolicy.digest') = session.confirmation_policy_digest
       AND json_extract(NEW.record_json, '$.expiresAt') = NEW.expires_at
       AND json_extract(NEW.record_json, '$.createdAt') = NEW.created_at
       AND (
         (decision.focus_id IS NULL AND NEW.focus_id IS NULL AND
           json_type(NEW.record_json, '$.focusRef') IS NULL) OR
         (decision.focus_id = NEW.focus_id AND
           decision.focus_digest = NEW.focus_digest AND
           json_extract(NEW.record_json, '$.focusRef.id') = NEW.focus_id AND
           json_extract(NEW.record_json, '$.focusRef.digest') = NEW.focus_digest)
       )
  ) THEN RAISE(ABORT, 'Pending Action lacks exact current Runtime authority') END;
END;

CREATE TRIGGER interaction_pending_action_resolutions_exact_authority_guard
BEFORE INSERT ON interaction_pending_action_resolutions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_pending_actions AS action
     WHERE action.id = NEW.pending_action_id
       AND action.session_id = NEW.session_id
       AND action.pending_action_digest = NEW.pending_action_digest
       AND NEW.resolved_at >= action.created_at
       AND json_extract(NEW.record_json, '$.schemaVersion') = NEW.schema_version
       AND json_extract(NEW.record_json, '$.confirmationPolicy.id') =
         json_extract(action.record_json, '$.confirmationPolicy.id')
       AND json_extract(NEW.record_json, '$.confirmationPolicy.version') =
         json_extract(action.record_json, '$.confirmationPolicy.version')
       AND json_extract(NEW.record_json, '$.confirmationPolicy.digest') =
         json_extract(action.record_json, '$.confirmationPolicy.digest')
       AND json_extract(NEW.record_json, '$.resolvedAt') = NEW.resolved_at
       AND (
         (NEW.disposition = 'DIRECT_USER_AUTHORIZED' AND
           action.confirmation_requirement = 'DIRECT_USER_MESSAGE_SUFFICIENT' AND
           NEW.resolved_at < action.expires_at AND
           json_extract(NEW.record_json, '$.authorizingMessageRef.id') = action.originating_message_id AND
           json_extract(NEW.record_json, '$.authorizingMessageRef.digest') = action.originating_message_digest) OR
         (NEW.disposition = 'SEPARATE_RESPONSE_CONFIRMED' AND
           action.confirmation_requirement = 'SEPARATE_RESPONSE_REQUIRED' AND
           NEW.resolved_at < action.expires_at AND
           json_extract(NEW.record_json, '$.originatingMessageRef.id') = action.originating_message_id AND
           json_extract(NEW.record_json, '$.originatingMessageRef.digest') = action.originating_message_digest AND
           EXISTS (
             SELECT 1 FROM interaction_messages AS response
              WHERE response.id = json_extract(NEW.record_json, '$.authorizingMessageRef.id')
                AND response.message_digest = json_extract(NEW.record_json, '$.authorizingMessageRef.digest')
                AND response.session_id = action.session_id
                AND response.role = 'USER'
                AND response.retention = 'RETAINED'
                AND response.id <> action.originating_message_id
                AND response.created_at >= action.created_at
                AND response.created_at <= NEW.resolved_at
           )) OR
         (NEW.disposition IN ('DECLINED', 'UNCLEAR') AND
           action.confirmation_requirement = 'SEPARATE_RESPONSE_REQUIRED' AND
           NEW.resolved_at < action.expires_at AND
           EXISTS (
             SELECT 1 FROM interaction_messages AS response
              WHERE response.id = json_extract(NEW.record_json, '$.responseMessageRef.id')
                AND response.message_digest = json_extract(NEW.record_json, '$.responseMessageRef.digest')
                AND response.session_id = action.session_id
                AND response.role = 'USER'
                AND response.retention = 'RETAINED'
                AND response.id <> action.originating_message_id
                AND response.created_at >= action.created_at
                AND response.created_at <= NEW.resolved_at
           )) OR
         ((NEW.disposition = 'EXPIRED' AND NEW.resolved_at >= action.expires_at) OR
           NEW.disposition IN ('STALE_AUTHORITY', 'CONFLICT', 'INTERRUPTED')) AND
           NOT EXISTS (
             SELECT 1 FROM interaction_operations AS active
              WHERE active.session_id = action.session_id
                AND active.state = 'RESERVED'
           )
       )
  ) THEN RAISE(ABORT, 'Pending Action Resolution lacks exact Action authority') END;
END;

CREATE TRIGGER interaction_action_reservations_exact_authority_guard
BEFORE INSERT ON interaction_action_reservations
WHEN NEW.public_capability IN ('SUBMIT_INTAKE', 'START_GOAL', 'RESUME_GOAL', 'CANCEL_GOAL')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_pending_actions AS action
      JOIN interaction_pending_action_resolutions AS resolution
        ON resolution.id = NEW.resolution_id
       AND resolution.pending_action_id = action.id
       AND resolution.resolution_digest = NEW.resolution_digest
     WHERE action.id = NEW.pending_action_id
       AND action.session_id = NEW.session_id
       AND action.pending_action_digest = NEW.pending_action_digest
       AND resolution.disposition IN ('DIRECT_USER_AUTHORIZED', 'SEPARATE_RESPONSE_CONFIRMED')
       AND NEW.public_capability = action.public_capability
       AND NEW.command_id = action.preallocated_command_id
       AND NEW.canonical_command_input_digest = action.canonical_command_input_digest
       AND NEW.reserved_at >= resolution.resolved_at
       AND json_extract(NEW.record_json, '$.schemaVersion') = NEW.schema_version
       AND json_extract(NEW.record_json, '$.pendingActionRef.digest') = action.pending_action_digest
       AND json_extract(NEW.record_json, '$.resolutionRef.digest') = resolution.resolution_digest
       AND json_extract(NEW.record_json, '$.reservedAt') = NEW.reserved_at
  ) THEN RAISE(ABORT, 'Action Reservation lacks exact authorized Pending Action') END;
END;

DROP TRIGGER interaction_operations_route_completion_guard;

CREATE TRIGGER interaction_operations_route_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind = 'ROUTE'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_route_decisions AS decision
     WHERE decision.id = json_extract(NEW.record_json, '$.result.routeDecisionRef.id')
       AND decision.session_id = NEW.session_id
       AND decision.expected_session_version = NEW.expected_session_version
       AND decision.message_id = NEW.message_id
       AND decision.message_digest = NEW.message_digest
       AND decision.decision_digest = json_extract(NEW.record_json, '$.result.routeDecisionRef.digest')
       AND json_extract(NEW.record_json, '$.result.kind') = 'ROUTE_DECIDED'
       AND (
         (decision.proposal_id IS NULL AND
           json_type(NEW.record_json, '$.result.routeProposalRef') IS NULL AND
           NEW.context_manifest_id IS NULL) OR
         (decision.proposal_id IS NOT NULL AND
           json_extract(NEW.record_json, '$.result.routeProposalRef.id') = decision.proposal_id AND
           json_extract(NEW.record_json, '$.result.routeProposalRef.digest') = decision.proposal_digest AND
           EXISTS (
             SELECT 1 FROM interaction_route_proposals AS proposal
              WHERE proposal.id = decision.proposal_id
                AND proposal.session_id = NEW.session_id
                AND proposal.operation_id = NEW.id
                AND proposal.message_id = NEW.message_id
                AND proposal.message_digest = NEW.message_digest
                AND proposal.proposal_digest = decision.proposal_digest
           ) AND NEW.context_manifest_id IS NOT NULL)
       )
  ) THEN RAISE(ABORT, 'Route Operation completion lacks its exact Decision result') END;
END;

CREATE TRIGGER interaction_operations_action_proposal_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind = 'ACTION_PROPOSAL'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_pending_actions AS action
      JOIN interaction_route_decisions AS decision
        ON decision.id = action.route_decision_id
       AND decision.session_id = action.session_id
       AND decision.decision_digest = action.route_decision_digest
     WHERE action.id = json_extract(NEW.record_json, '$.result.pendingActionRef.id')
       AND action.pending_action_digest = json_extract(NEW.record_json, '$.result.pendingActionRef.digest')
       AND action.session_id = NEW.session_id
       AND action.originating_message_id = NEW.message_id
       AND action.originating_message_digest = NEW.message_digest
       AND decision.expected_session_version = NEW.expected_session_version
       AND json_extract(NEW.record_json, '$.result.kind') = 'PENDING_ACTION_RECORDED'
       AND (
         (action.confirmation_requirement = 'SEPARATE_RESPONSE_REQUIRED' AND NOT EXISTS (
           SELECT 1 FROM interaction_pending_action_resolutions AS resolution
            WHERE resolution.pending_action_id = action.id
         )) OR
         (action.confirmation_requirement = 'DIRECT_USER_MESSAGE_SUFFICIENT' AND EXISTS (
           SELECT 1
             FROM interaction_pending_action_resolutions AS resolution
             JOIN interaction_action_reservations AS reservation
               ON reservation.resolution_id = resolution.id
              AND reservation.pending_action_id = action.id
            WHERE resolution.pending_action_id = action.id
              AND resolution.disposition = 'DIRECT_USER_AUTHORIZED'
         ))
       )
  ) THEN RAISE(ABORT, 'Action Proposal completion lacks its exact Pending Action closure') END;
END;

CREATE TRIGGER interaction_operations_action_confirmation_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind = 'ACTION_CONFIRMATION'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_pending_action_resolutions AS resolution
      JOIN interaction_pending_actions AS action
        ON action.id = resolution.pending_action_id
       AND action.session_id = resolution.session_id
       AND action.pending_action_digest = resolution.pending_action_digest
     WHERE resolution.id = json_extract(NEW.record_json, '$.result.resolutionRef.id')
       AND resolution.resolution_digest = json_extract(NEW.record_json, '$.result.resolutionRef.digest')
       AND resolution.session_id = NEW.session_id
       AND NEW.message_id = CASE
         WHEN resolution.disposition = 'SEPARATE_RESPONSE_CONFIRMED'
           THEN json_extract(resolution.record_json, '$.authorizingMessageRef.id')
         ELSE json_extract(resolution.record_json, '$.responseMessageRef.id')
       END
       AND NEW.message_digest = CASE
         WHEN resolution.disposition = 'SEPARATE_RESPONSE_CONFIRMED'
           THEN json_extract(resolution.record_json, '$.authorizingMessageRef.digest')
         ELSE json_extract(resolution.record_json, '$.responseMessageRef.digest')
       END
       AND json_extract(NEW.record_json, '$.result.kind') = 'ACTION_RESOLUTION_RECORDED'
       AND (
         (resolution.disposition = 'SEPARATE_RESPONSE_CONFIRMED' AND EXISTS (
           SELECT 1 FROM interaction_action_reservations AS reservation
            WHERE reservation.resolution_id = resolution.id
              AND reservation.id = json_extract(NEW.record_json, '$.result.reservationRef.id')
              AND reservation.reservation_digest = json_extract(NEW.record_json, '$.result.reservationRef.digest')
         )) OR
         (resolution.disposition IN ('DECLINED', 'UNCLEAR') AND
           json_type(NEW.record_json, '$.result.reservationRef') IS NULL AND NOT EXISTS (
             SELECT 1 FROM interaction_action_reservations AS reservation
              WHERE reservation.resolution_id = resolution.id
           ))
       )
  ) THEN RAISE(ABORT, 'Action Confirmation completion lacks its exact Resolution result') END;
END;

CREATE TRIGGER interaction_operations_unimplemented_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED' AND NEW.operation_kind NOT IN (
  'ROUTE', 'ACTION_PROPOSAL', 'ACTION_CONFIRMATION'
)
BEGIN
  SELECT RAISE(ABORT, 'Interaction Operation completion has no implemented result owner');
END;
