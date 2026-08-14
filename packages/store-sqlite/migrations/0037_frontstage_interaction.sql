-- M2.6 Slice 2: append-only Interaction authority foundation. Existing
-- Domain codecs own record meaning; relational columns provide identity,
-- atomic-audit, lifecycle, and single-consumption backstops.

CREATE TABLE interaction_direct_action_grammars (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  grammar_version TEXT NOT NULL CHECK (length(trim(grammar_version)) > 0),
  grammar_digest TEXT NOT NULL UNIQUE CHECK (
    length(grammar_digest) = 71 AND substr(grammar_digest, 1, 7) = 'sha256:' AND
    substr(grammar_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  installed_at TEXT NOT NULL CHECK (
    length(installed_at) = 24 AND installed_at GLOB '????-??-??T??:??:??.???Z'
  ),
  install_audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, grammar_version, grammar_digest),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.version') = grammar_version),
  CHECK (json_extract(record_json, '$.digest') = grammar_digest)
) STRICT;

CREATE TABLE interaction_confirmation_grammars (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  grammar_version TEXT NOT NULL CHECK (length(trim(grammar_version)) > 0),
  grammar_digest TEXT NOT NULL UNIQUE CHECK (
    length(grammar_digest) = 71 AND substr(grammar_digest, 1, 7) = 'sha256:' AND
    substr(grammar_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  installed_at TEXT NOT NULL CHECK (
    length(installed_at) = 24 AND installed_at GLOB '????-??-??T??:??:??.???Z'
  ),
  install_audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, grammar_version, grammar_digest),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.version') = grammar_version),
  CHECK (json_extract(record_json, '$.digest') = grammar_digest)
) STRICT;

CREATE TABLE interaction_routing_policies (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  policy_version TEXT NOT NULL CHECK (length(trim(policy_version)) > 0),
  direct_action_grammar_id TEXT NOT NULL,
  direct_action_grammar_version TEXT NOT NULL,
  direct_action_grammar_digest TEXT NOT NULL,
  policy_digest TEXT NOT NULL UNIQUE CHECK (
    length(policy_digest) = 71 AND substr(policy_digest, 1, 7) = 'sha256:' AND
    substr(policy_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  installed_at TEXT NOT NULL CHECK (
    length(installed_at) = 24 AND installed_at GLOB '????-??-??T??:??:??.???Z'
  ),
  install_audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, policy_version, policy_digest),
  FOREIGN KEY (
    direct_action_grammar_id,
    direct_action_grammar_version,
    direct_action_grammar_digest
  ) REFERENCES interaction_direct_action_grammars(id, grammar_version, grammar_digest)
    ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.version') = policy_version),
  CHECK (json_extract(record_json, '$.directActionGrammar.id') = direct_action_grammar_id),
  CHECK (json_extract(record_json, '$.directActionGrammar.version') = direct_action_grammar_version),
  CHECK (json_extract(record_json, '$.directActionGrammar.digest') = direct_action_grammar_digest),
  CHECK (json_extract(record_json, '$.digest') = policy_digest)
) STRICT;

CREATE TABLE interaction_confirmation_policies (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  policy_version TEXT NOT NULL CHECK (length(trim(policy_version)) > 0),
  confirmation_grammar_id TEXT NOT NULL,
  confirmation_grammar_version TEXT NOT NULL,
  confirmation_grammar_digest TEXT NOT NULL,
  policy_digest TEXT NOT NULL UNIQUE CHECK (
    length(policy_digest) = 71 AND substr(policy_digest, 1, 7) = 'sha256:' AND
    substr(policy_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  installed_at TEXT NOT NULL CHECK (
    length(installed_at) = 24 AND installed_at GLOB '????-??-??T??:??:??.???Z'
  ),
  install_audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, policy_version, policy_digest),
  FOREIGN KEY (
    confirmation_grammar_id,
    confirmation_grammar_version,
    confirmation_grammar_digest
  ) REFERENCES interaction_confirmation_grammars(id, grammar_version, grammar_digest)
    ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.version') = policy_version),
  CHECK (json_extract(record_json, '$.confirmationGrammar.id') = confirmation_grammar_id),
  CHECK (json_extract(record_json, '$.confirmationGrammar.version') = confirmation_grammar_version),
  CHECK (json_extract(record_json, '$.confirmationGrammar.digest') = confirmation_grammar_digest),
  CHECK (json_extract(record_json, '$.digest') = policy_digest)
) STRICT;

CREATE TABLE interaction_sessions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  version INTEGER NOT NULL CHECK (version >= 1 AND version <= 9007199254740991),
  principal_ref TEXT NOT NULL CHECK (length(trim(principal_ref)) > 0),
  project_path TEXT NOT NULL CHECK (length(trim(project_path)) > 0),
  project_identity_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'CLOSING', 'CLOSED', 'INTERRUPTED')),
  terminal_reason TEXT CHECK (
    terminal_reason IS NULL OR terminal_reason = 'RETENTION_LIMIT_REACHED'
  ),
  configuration_id TEXT NOT NULL,
  configuration_version TEXT NOT NULL,
  configuration_digest TEXT NOT NULL,
  routing_policy_id TEXT NOT NULL,
  routing_policy_version TEXT NOT NULL,
  routing_policy_digest TEXT NOT NULL,
  confirmation_policy_id TEXT NOT NULL,
  confirmation_policy_version TEXT NOT NULL,
  confirmation_policy_digest TEXT NOT NULL,
  retention_profile_id TEXT NOT NULL,
  retention_profile_version TEXT NOT NULL,
  retention_profile_digest TEXT NOT NULL,
  current_focus_id TEXT,
  current_focus_digest TEXT,
  opened_at TEXT NOT NULL CHECK (
    length(opened_at) = 24 AND opened_at GLOB '????-??-??T??:??:??.???Z'
  ),
  updated_at TEXT NOT NULL CHECK (
    length(updated_at) = 24 AND updated_at GLOB '????-??-??T??:??:??.???Z'
  ),
  session_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, version),
  UNIQUE (id, session_digest),
  FOREIGN KEY (routing_policy_id, routing_policy_version, routing_policy_digest)
    REFERENCES interaction_routing_policies(id, policy_version, policy_digest)
    ON DELETE RESTRICT,
  FOREIGN KEY (confirmation_policy_id, confirmation_policy_version, confirmation_policy_digest)
    REFERENCES interaction_confirmation_policies(id, policy_version, policy_digest)
    ON DELETE RESTRICT,
  FOREIGN KEY (current_focus_id, id, current_focus_digest)
    REFERENCES interaction_focus_bindings(id, session_id, focus_digest)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (state = 'CLOSED') OR terminal_reason IS NULL
  ),
  CHECK (
    (current_focus_id IS NULL AND current_focus_digest IS NULL) OR
    (current_focus_id IS NOT NULL AND current_focus_digest IS NOT NULL)
  ),
  CHECK (updated_at >= opened_at),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.version') = version),
  CHECK (json_extract(record_json, '$.principalRef') = principal_ref),
  CHECK (json_extract(record_json, '$.projectRef.normalizedPath') = project_path),
  CHECK (json_extract(record_json, '$.projectRef.identityDigest') = project_identity_digest),
  CHECK (json_extract(record_json, '$.state') = state),
  CHECK (json_extract(record_json, '$.sessionDigest') = session_digest)
) STRICT;

CREATE TABLE interaction_messages (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  principal_ref TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('USER', 'FRONTSTAGE', 'SYSTEM')),
  retention TEXT NOT NULL CHECK (retention IN ('RETAINED', 'OMITTED')),
  content_digest TEXT NOT NULL,
  content_byte_length INTEGER NOT NULL CHECK (
    content_byte_length >= 0 AND content_byte_length <= 16384
  ),
  caused_by_operation_id TEXT,
  caused_by_operation_digest TEXT,
  created_at TEXT NOT NULL CHECK (
    length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'
  ),
  message_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, message_digest),
  FOREIGN KEY (caused_by_operation_id, session_id, caused_by_operation_digest)
    REFERENCES interaction_operations(id, session_id, operation_digest)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (role = 'USER' AND caused_by_operation_id IS NULL AND caused_by_operation_digest IS NULL) OR
    (role <> 'USER' AND caused_by_operation_id IS NOT NULL AND caused_by_operation_digest IS NOT NULL)
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.principalRef') = principal_ref),
  CHECK (json_extract(record_json, '$.role') = role),
  CHECK (json_extract(record_json, '$.retention') = retention),
  CHECK (json_extract(record_json, '$.contentDigest') = content_digest),
  CHECK (json_extract(record_json, '$.contentByteLength') = content_byte_length),
  CHECK (json_extract(record_json, '$.messageDigest') = message_digest)
) STRICT;

CREATE TABLE interaction_focus_bindings (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  based_on_session_version INTEGER NOT NULL CHECK (
    based_on_session_version >= 1 AND based_on_session_version <= 9007199254740991
  ),
  kind TEXT NOT NULL CHECK (kind IN ('NONE', 'INTAKE_QUESTION', 'GOAL')),
  created_at TEXT NOT NULL CHECK (
    length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'
  ),
  focus_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, focus_digest),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.basedOnSessionVersion') = based_on_session_version),
  CHECK (json_extract(record_json, '$.kind') = kind),
  CHECK (json_extract(record_json, '$.focusDigest') = focus_digest)
) STRICT;

CREATE TABLE interaction_operations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  version INTEGER NOT NULL CHECK (version >= 1 AND version <= 9007199254740991),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  expected_session_version INTEGER NOT NULL CHECK (
    expected_session_version >= 1 AND expected_session_version <= 9007199254740991
  ),
  message_id TEXT NOT NULL,
  message_digest TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN (
    'ROUTE', 'FRONTSTAGE_ANSWER', 'GOAL_LIST', 'GOAL_STATUS', 'INTAKE_HANDOFF',
    'INTAKE_CLARIFICATION', 'ACTION_PROPOSAL', 'ACTION_CONFIRMATION', 'RESULT_PROJECTION'
  )),
  state TEXT NOT NULL CHECK (state IN ('RESERVED', 'COMPLETED', 'FAILED', 'INTERRUPTED')),
  context_manifest_id TEXT,
  context_manifest_digest TEXT,
  assistant_profile_id TEXT,
  assistant_profile_version TEXT,
  assistant_profile_digest TEXT,
  reserved_at TEXT NOT NULL CHECK (
    length(reserved_at) = 24 AND reserved_at GLOB '????-??-??T??:??:??.???Z'
  ),
  completed_at TEXT,
  operation_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id),
  UNIQUE (id, session_id, operation_digest),
  FOREIGN KEY (message_id, session_id, message_digest)
    REFERENCES interaction_messages(id, session_id, message_digest) ON DELETE RESTRICT,
  CHECK (
    (context_manifest_id IS NULL AND context_manifest_digest IS NULL AND
      assistant_profile_id IS NULL AND assistant_profile_version IS NULL AND
      assistant_profile_digest IS NULL) OR
    (context_manifest_id IS NOT NULL AND context_manifest_digest IS NOT NULL AND
      assistant_profile_id IS NOT NULL AND assistant_profile_version IS NOT NULL AND
      assistant_profile_digest IS NOT NULL AND operation_kind = 'ROUTE')
  ),
  CHECK (
    (state = 'RESERVED' AND completed_at IS NULL) OR
    (state <> 'RESERVED' AND completed_at IS NOT NULL)
  ),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.version') = version),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.expectedSessionVersion') = expected_session_version),
  CHECK (json_extract(record_json, '$.messageRef.id') = message_id),
  CHECK (json_extract(record_json, '$.messageRef.digest') = message_digest),
  CHECK (json_extract(record_json, '$.operationKind') = operation_kind),
  CHECK (json_extract(record_json, '$.state') = state),
  CHECK (json_extract(record_json, '$.operationDigest') = operation_digest)
) STRICT;

CREATE TABLE interaction_route_proposals (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE,
  message_id TEXT NOT NULL,
  message_digest TEXT NOT NULL,
  proposal_kind TEXT NOT NULL CHECK (proposal_kind IN (
    'ANSWER_PROPOSAL', 'ROUTE_PROPOSAL', 'CLARIFICATION_PROPOSAL', 'NO_ACTION_PROPOSAL'
  )),
  proposal_digest TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, proposal_digest),
  FOREIGN KEY (operation_id, session_id)
    REFERENCES interaction_operations(id, session_id) ON DELETE RESTRICT,
  FOREIGN KEY (message_id, session_id, message_digest)
    REFERENCES interaction_messages(id, session_id, message_digest) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.operationId') = operation_id),
  CHECK (json_extract(record_json, '$.kind') = proposal_kind),
  CHECK (json_extract(record_json, '$.proposalDigest') = proposal_digest)
) STRICT;

CREATE TABLE interaction_route_decisions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  expected_session_version INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  message_digest TEXT NOT NULL,
  proposal_id TEXT,
  proposal_digest TEXT,
  focus_id TEXT,
  focus_digest TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'ANSWER', 'LIST_GOALS', 'SHOW_GOAL', 'CONTINUE_EXACT_INTAKE_QUESTION',
    'PROPOSE_INTAKE_ACTION', 'PROPOSE_GOAL_CONTROL', 'ASK_ROUTE_CLARIFICATION', 'NO_ACTION'
  )),
  decided_at TEXT NOT NULL,
  decision_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, decision_digest),
  FOREIGN KEY (message_id, session_id, message_digest)
    REFERENCES interaction_messages(id, session_id, message_digest) ON DELETE RESTRICT,
  FOREIGN KEY (proposal_id, session_id, proposal_digest)
    REFERENCES interaction_route_proposals(id, session_id, proposal_digest) ON DELETE RESTRICT,
  FOREIGN KEY (focus_id, session_id, focus_digest)
    REFERENCES interaction_focus_bindings(id, session_id, focus_digest) ON DELETE RESTRICT,
  CHECK ((proposal_id IS NULL AND proposal_digest IS NULL) OR
    (proposal_id IS NOT NULL AND proposal_digest IS NOT NULL)),
  CHECK ((focus_id IS NULL AND focus_digest IS NULL) OR
    (focus_id IS NOT NULL AND focus_digest IS NOT NULL)),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.outcome') = outcome),
  CHECK (json_extract(record_json, '$.decisionDigest') = decision_digest)
) STRICT;

CREATE TABLE interaction_pending_actions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  originating_message_id TEXT NOT NULL,
  originating_message_digest TEXT NOT NULL,
  route_decision_id TEXT NOT NULL,
  route_decision_digest TEXT NOT NULL,
  focus_id TEXT,
  focus_digest TEXT,
  action_kind TEXT NOT NULL CHECK (action_kind IN (
    'SUBMIT_GOVERNED_INTAKE', 'SUBMIT_MATERIALIZE_ONLY_INTAKE',
    'START_GOAL', 'RESUME_GOAL', 'CANCEL_GOAL'
  )),
  confirmation_requirement TEXT NOT NULL CHECK (confirmation_requirement IN (
    'DIRECT_USER_MESSAGE_SUFFICIENT', 'SEPARATE_RESPONSE_REQUIRED'
  )),
  public_capability TEXT NOT NULL CHECK (public_capability IN (
    'SUBMIT_INTAKE', 'START_GOAL', 'RESUME_GOAL', 'CANCEL_GOAL'
  )),
  preallocated_command_id TEXT NOT NULL UNIQUE,
  canonical_command_input_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  pending_action_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, pending_action_digest),
  UNIQUE (
    id,
    session_id,
    preallocated_command_id,
    canonical_command_input_digest,
    pending_action_digest
  ),
  FOREIGN KEY (originating_message_id, session_id, originating_message_digest)
    REFERENCES interaction_messages(id, session_id, message_digest) ON DELETE RESTRICT,
  FOREIGN KEY (route_decision_id, session_id, route_decision_digest)
    REFERENCES interaction_route_decisions(id, session_id, decision_digest) ON DELETE RESTRICT,
  FOREIGN KEY (focus_id, session_id, focus_digest)
    REFERENCES interaction_focus_bindings(id, session_id, focus_digest) ON DELETE RESTRICT,
  CHECK ((focus_id IS NULL AND focus_digest IS NULL) OR
    (focus_id IS NOT NULL AND focus_digest IS NOT NULL)),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.kind') = action_kind),
  CHECK (json_extract(record_json, '$.confirmationRequirement') = confirmation_requirement),
  CHECK (json_extract(record_json, '$.publicCapability') = public_capability),
  CHECK (json_extract(record_json, '$.preallocatedCommandId') = preallocated_command_id),
  CHECK (json_extract(record_json, '$.canonicalCommandInputDigest') = canonical_command_input_digest),
  CHECK (json_extract(record_json, '$.pendingActionDigest') = pending_action_digest)
) STRICT;

CREATE TABLE interaction_pending_action_resolutions (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  pending_action_id TEXT NOT NULL UNIQUE,
  pending_action_digest TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN (
    'DIRECT_USER_AUTHORIZED', 'SEPARATE_RESPONSE_CONFIRMED', 'DECLINED', 'UNCLEAR',
    'EXPIRED', 'STALE_AUTHORITY', 'CONFLICT', 'INTERRUPTED'
  )),
  resolved_at TEXT NOT NULL,
  resolution_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, resolution_digest),
  UNIQUE (id, pending_action_id, resolution_digest),
  FOREIGN KEY (pending_action_id, session_id, pending_action_digest)
    REFERENCES interaction_pending_actions(id, session_id, pending_action_digest)
    ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.pendingActionRef.id') = pending_action_id),
  CHECK (json_extract(record_json, '$.pendingActionRef.digest') = pending_action_digest),
  CHECK (json_extract(record_json, '$.disposition') = disposition),
  CHECK (json_extract(record_json, '$.resolutionDigest') = resolution_digest)
) STRICT;

CREATE TABLE interaction_action_reservations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  pending_action_id TEXT NOT NULL UNIQUE,
  pending_action_digest TEXT NOT NULL,
  resolution_id TEXT NOT NULL UNIQUE,
  resolution_digest TEXT NOT NULL,
  public_capability TEXT NOT NULL CHECK (public_capability IN (
    'SUBMIT_INTAKE', 'START_GOAL', 'RESUME_GOAL', 'CANCEL_GOAL'
  )),
  command_id TEXT NOT NULL UNIQUE,
  canonical_command_input_digest TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  reservation_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, reservation_digest),
  UNIQUE (id, command_id, reservation_digest),
  UNIQUE (id, command_id, canonical_command_input_digest, reservation_digest),
  UNIQUE (
    id,
    session_id,
    command_id,
    canonical_command_input_digest,
    reservation_digest
  ),
  FOREIGN KEY (
    pending_action_id,
    session_id,
    command_id,
    canonical_command_input_digest,
    pending_action_digest
  ) REFERENCES interaction_pending_actions(
    id,
    session_id,
    preallocated_command_id,
    canonical_command_input_digest,
    pending_action_digest
  ) ON DELETE RESTRICT,
  FOREIGN KEY (resolution_id, pending_action_id, resolution_digest)
    REFERENCES interaction_pending_action_resolutions(id, pending_action_id, resolution_digest)
    ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.pendingActionRef.id') = pending_action_id),
  CHECK (json_extract(record_json, '$.resolutionRef.id') = resolution_id),
  CHECK (json_extract(record_json, '$.publicCapability') = public_capability),
  CHECK (json_extract(record_json, '$.commandId') = command_id),
  CHECK (json_extract(record_json, '$.canonicalCommandInputDigest') = canonical_command_input_digest),
  CHECK (json_extract(record_json, '$.reservationDigest') = reservation_digest)
) STRICT;

CREATE TABLE interaction_action_outcomes (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  reservation_id TEXT NOT NULL UNIQUE,
  reservation_digest TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  canonical_command_input_digest TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('APPLIED', 'REJECTED', 'FAILED')),
  public_command_outcome_digest TEXT NOT NULL,
  result_projection_digest TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  outcome_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, outcome_digest),
  FOREIGN KEY (
    reservation_id,
    session_id,
    command_id,
    canonical_command_input_digest,
    reservation_digest
  ) REFERENCES interaction_action_reservations(
    id,
    session_id,
    command_id,
    canonical_command_input_digest,
    reservation_digest
  ) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.reservationRef.id') = reservation_id),
  CHECK (json_extract(record_json, '$.commandId') = command_id),
  CHECK (json_extract(record_json, '$.canonicalCommandInputDigest') = canonical_command_input_digest),
  CHECK (json_extract(record_json, '$.disposition') = disposition),
  CHECK (json_extract(record_json, '$.publicCommandOutcomeDigest') = public_command_outcome_digest),
  CHECK (json_extract(record_json, '$.resultProjectionDigest') = result_projection_digest),
  CHECK (json_extract(record_json, '$.outcomeDigest') = outcome_digest)
) STRICT;

CREATE TABLE interaction_message_handoffs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  message_id TEXT NOT NULL,
  message_digest TEXT NOT NULL,
  pending_action_id TEXT NOT NULL,
  pending_action_digest TEXT NOT NULL,
  resolution_id TEXT NOT NULL,
  resolution_digest TEXT NOT NULL,
  reservation_id TEXT NOT NULL UNIQUE,
  reservation_digest TEXT NOT NULL,
  intake_command_id TEXT NOT NULL UNIQUE,
  admitted_content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
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
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.messageRef.id') = message_id),
  CHECK (json_extract(record_json, '$.intakeCommandId') = intake_command_id),
  CHECK (json_extract(record_json, '$.admittedContentDigest') = admitted_content_digest),
  CHECK (json_extract(record_json, '$.handoffDigest') = handoff_digest)
) STRICT;

CREATE TABLE frontstage_answers (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  originating_message_id TEXT NOT NULL,
  originating_message_digest TEXT NOT NULL,
  route_decision_id TEXT NOT NULL,
  route_decision_digest TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_digest TEXT NOT NULL,
  answer_content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  answer_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, answer_digest),
  FOREIGN KEY (originating_message_id, session_id, originating_message_digest)
    REFERENCES interaction_messages(id, session_id, message_digest) ON DELETE RESTRICT,
  FOREIGN KEY (route_decision_id, session_id, route_decision_digest)
    REFERENCES interaction_route_decisions(id, session_id, decision_digest) ON DELETE RESTRICT,
  FOREIGN KEY (proposal_id, session_id, proposal_digest)
    REFERENCES interaction_route_proposals(id, session_id, proposal_digest) ON DELETE RESTRICT,
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.originatingMessageRef.id') = originating_message_id),
  CHECK (json_extract(record_json, '$.routeDecisionRef.id') = route_decision_id),
  CHECK (json_extract(record_json, '$.proposalRef.id') = proposal_id),
  CHECK (json_extract(record_json, '$.answerContentDigest') = answer_content_digest),
  CHECK (json_extract(record_json, '$.answerDigest') = answer_digest)
) STRICT;

CREATE TABLE interaction_audit_events (
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0 AND position <= 9007199254740991),
  audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, position)
) STRICT;

CREATE INDEX interaction_sessions_startup_idx
  ON interaction_sessions(principal_ref, project_path, state, updated_at, id);
CREATE INDEX interaction_messages_session_idx
  ON interaction_messages(session_id, created_at, id);
CREATE INDEX interaction_focus_bindings_session_idx
  ON interaction_focus_bindings(session_id, created_at, id);
CREATE INDEX interaction_operations_session_idx
  ON interaction_operations(session_id, state, reserved_at, id);
CREATE UNIQUE INDEX interaction_operations_one_reserved_per_session_idx
  ON interaction_operations(session_id) WHERE state = 'RESERVED';
CREATE INDEX interaction_route_decisions_session_idx
  ON interaction_route_decisions(session_id, decided_at, id);
CREATE INDEX interaction_pending_actions_session_idx
  ON interaction_pending_actions(session_id, expires_at, id);

CREATE TRIGGER interaction_sessions_delete_guard
BEFORE DELETE ON interaction_sessions
BEGIN
  SELECT RAISE(ABORT, 'Interaction Sessions cannot be deleted');
END;

CREATE TRIGGER interaction_sessions_update_guard
BEFORE UPDATE ON interaction_sessions
BEGIN
  SELECT CASE
    WHEN NEW.version <> OLD.version + 1 OR
      NEW.id <> OLD.id OR
      NEW.principal_ref <> OLD.principal_ref OR
      NEW.project_path <> OLD.project_path OR
      NEW.project_identity_digest <> OLD.project_identity_digest OR
      NEW.configuration_id <> OLD.configuration_id OR
      NEW.configuration_version <> OLD.configuration_version OR
      NEW.configuration_digest <> OLD.configuration_digest OR
      NEW.routing_policy_id <> OLD.routing_policy_id OR
      NEW.routing_policy_version <> OLD.routing_policy_version OR
      NEW.routing_policy_digest <> OLD.routing_policy_digest OR
      NEW.confirmation_policy_id <> OLD.confirmation_policy_id OR
      NEW.confirmation_policy_version <> OLD.confirmation_policy_version OR
      NEW.confirmation_policy_digest <> OLD.confirmation_policy_digest OR
      NEW.retention_profile_id <> OLD.retention_profile_id OR
      NEW.retention_profile_version <> OLD.retention_profile_version OR
      NEW.retention_profile_digest <> OLD.retention_profile_digest OR
      NEW.opened_at <> OLD.opened_at OR
      NEW.updated_at < OLD.updated_at OR
      OLD.state IN ('CLOSED', 'INTERRUPTED') OR
      (OLD.state = 'CLOSING' AND NEW.state NOT IN ('CLOSED', 'INTERRUPTED')) OR
      (OLD.state = 'OPEN' AND NEW.state = 'CLOSED' AND
        NEW.terminal_reason IS NOT 'RETENTION_LIMIT_REACHED') OR
      (OLD.state = 'CLOSING' AND NEW.state = 'CLOSED' AND
        NEW.terminal_reason IS NOT NULL) OR
      (NEW.state <> 'OPEN' AND (
        NEW.current_focus_id IS NOT OLD.current_focus_id OR
        NEW.current_focus_digest IS NOT OLD.current_focus_digest
      ))
    THEN RAISE(ABORT, 'illegal Interaction Session transition')
  END;
END;

CREATE TRIGGER interaction_operations_delete_guard
BEFORE DELETE ON interaction_operations
BEGIN
  SELECT RAISE(ABORT, 'Interaction Operations cannot be deleted');
END;

CREATE TRIGGER interaction_operations_update_guard
BEFORE UPDATE ON interaction_operations
BEGIN
  SELECT CASE
    WHEN OLD.state <> 'RESERVED' OR NEW.state = 'RESERVED' OR
      NEW.version <> OLD.version + 1 OR
      NEW.id <> OLD.id OR
      NEW.session_id <> OLD.session_id OR
      NEW.expected_session_version <> OLD.expected_session_version OR
      NEW.message_id <> OLD.message_id OR
      NEW.message_digest <> OLD.message_digest OR
      NEW.operation_kind <> OLD.operation_kind OR
      NEW.context_manifest_id IS NOT OLD.context_manifest_id OR
      NEW.context_manifest_digest IS NOT OLD.context_manifest_digest OR
      NEW.assistant_profile_id IS NOT OLD.assistant_profile_id OR
      NEW.assistant_profile_version IS NOT OLD.assistant_profile_version OR
      NEW.assistant_profile_digest IS NOT OLD.assistant_profile_digest OR
      NEW.reserved_at <> OLD.reserved_at
    THEN RAISE(ABORT, 'illegal Interaction Operation transition')
  END;
END;

CREATE TRIGGER interaction_direct_action_grammars_no_update
BEFORE UPDATE ON interaction_direct_action_grammars BEGIN SELECT RAISE(ABORT, 'Interaction grammar is immutable'); END;
CREATE TRIGGER interaction_direct_action_grammars_no_delete
BEFORE DELETE ON interaction_direct_action_grammars BEGIN SELECT RAISE(ABORT, 'Interaction grammar cannot be deleted'); END;
CREATE TRIGGER interaction_confirmation_grammars_no_update
BEFORE UPDATE ON interaction_confirmation_grammars BEGIN SELECT RAISE(ABORT, 'Interaction grammar is immutable'); END;
CREATE TRIGGER interaction_confirmation_grammars_no_delete
BEFORE DELETE ON interaction_confirmation_grammars BEGIN SELECT RAISE(ABORT, 'Interaction grammar cannot be deleted'); END;
CREATE TRIGGER interaction_routing_policies_no_update
BEFORE UPDATE ON interaction_routing_policies BEGIN SELECT RAISE(ABORT, 'Interaction policy is immutable'); END;
CREATE TRIGGER interaction_routing_policies_no_delete
BEFORE DELETE ON interaction_routing_policies BEGIN SELECT RAISE(ABORT, 'Interaction policy cannot be deleted'); END;
CREATE TRIGGER interaction_confirmation_policies_no_update
BEFORE UPDATE ON interaction_confirmation_policies BEGIN SELECT RAISE(ABORT, 'Interaction policy is immutable'); END;
CREATE TRIGGER interaction_confirmation_policies_no_delete
BEFORE DELETE ON interaction_confirmation_policies BEGIN SELECT RAISE(ABORT, 'Interaction policy cannot be deleted'); END;

CREATE TRIGGER interaction_messages_no_update
BEFORE UPDATE ON interaction_messages BEGIN SELECT RAISE(ABORT, 'Interaction Message is immutable'); END;
CREATE TRIGGER interaction_messages_no_delete
BEFORE DELETE ON interaction_messages BEGIN SELECT RAISE(ABORT, 'Interaction Message cannot be deleted'); END;
CREATE TRIGGER interaction_focus_bindings_no_update
BEFORE UPDATE ON interaction_focus_bindings BEGIN SELECT RAISE(ABORT, 'Focus Binding is immutable'); END;
CREATE TRIGGER interaction_focus_bindings_no_delete
BEFORE DELETE ON interaction_focus_bindings BEGIN SELECT RAISE(ABORT, 'Focus Binding cannot be deleted'); END;
CREATE TRIGGER interaction_route_proposals_no_update
BEFORE UPDATE ON interaction_route_proposals BEGIN SELECT RAISE(ABORT, 'Route Proposal is immutable'); END;
CREATE TRIGGER interaction_route_proposals_no_delete
BEFORE DELETE ON interaction_route_proposals BEGIN SELECT RAISE(ABORT, 'Route Proposal cannot be deleted'); END;
CREATE TRIGGER interaction_route_decisions_no_update
BEFORE UPDATE ON interaction_route_decisions BEGIN SELECT RAISE(ABORT, 'Route Decision is immutable'); END;
CREATE TRIGGER interaction_route_decisions_no_delete
BEFORE DELETE ON interaction_route_decisions BEGIN SELECT RAISE(ABORT, 'Route Decision cannot be deleted'); END;
CREATE TRIGGER interaction_pending_actions_no_update
BEFORE UPDATE ON interaction_pending_actions BEGIN SELECT RAISE(ABORT, 'Pending Action is immutable'); END;
CREATE TRIGGER interaction_pending_actions_no_delete
BEFORE DELETE ON interaction_pending_actions BEGIN SELECT RAISE(ABORT, 'Pending Action cannot be deleted'); END;
CREATE TRIGGER interaction_pending_action_resolutions_no_update
BEFORE UPDATE ON interaction_pending_action_resolutions BEGIN SELECT RAISE(ABORT, 'Pending Action Resolution is immutable'); END;
CREATE TRIGGER interaction_pending_action_resolutions_no_delete
BEFORE DELETE ON interaction_pending_action_resolutions BEGIN SELECT RAISE(ABORT, 'Pending Action Resolution cannot be deleted'); END;
CREATE TRIGGER interaction_action_reservations_no_update
BEFORE UPDATE ON interaction_action_reservations BEGIN SELECT RAISE(ABORT, 'Interaction Action Reservation is immutable'); END;
CREATE TRIGGER interaction_action_reservations_no_delete
BEFORE DELETE ON interaction_action_reservations BEGIN SELECT RAISE(ABORT, 'Interaction Action Reservation cannot be deleted'); END;
CREATE TRIGGER interaction_action_outcomes_no_update
BEFORE UPDATE ON interaction_action_outcomes BEGIN SELECT RAISE(ABORT, 'Interaction Action Outcome is immutable'); END;
CREATE TRIGGER interaction_action_outcomes_no_delete
BEFORE DELETE ON interaction_action_outcomes BEGIN SELECT RAISE(ABORT, 'Interaction Action Outcome cannot be deleted'); END;
CREATE TRIGGER interaction_message_handoffs_no_update
BEFORE UPDATE ON interaction_message_handoffs BEGIN SELECT RAISE(ABORT, 'Interaction Message Handoff is immutable'); END;
CREATE TRIGGER interaction_message_handoffs_no_delete
BEFORE DELETE ON interaction_message_handoffs BEGIN SELECT RAISE(ABORT, 'Interaction Message Handoff cannot be deleted'); END;
CREATE TRIGGER frontstage_answers_no_update
BEFORE UPDATE ON frontstage_answers BEGIN SELECT RAISE(ABORT, 'Frontstage Answer is immutable'); END;
CREATE TRIGGER frontstage_answers_no_delete
BEFORE DELETE ON frontstage_answers BEGIN SELECT RAISE(ABORT, 'Frontstage Answer cannot be deleted'); END;
CREATE TRIGGER interaction_audit_events_no_update
BEFORE UPDATE ON interaction_audit_events BEGIN SELECT RAISE(ABORT, 'Interaction audit membership is immutable'); END;
CREATE TRIGGER interaction_audit_events_no_delete
BEFORE DELETE ON interaction_audit_events BEGIN SELECT RAISE(ABORT, 'Interaction audit membership cannot be deleted'); END;
