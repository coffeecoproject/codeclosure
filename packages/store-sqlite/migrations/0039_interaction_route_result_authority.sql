CREATE TABLE frontstage_context_manifests (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  session_id TEXT NOT NULL REFERENCES interaction_sessions(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL,
  reserved_operation_version INTEGER NOT NULL CHECK (reserved_operation_version = 1),
  current_message_id TEXT NOT NULL,
  current_message_digest TEXT NOT NULL,
  current_message_content_digest TEXT NOT NULL,
  current_message_content_byte_length INTEGER NOT NULL CHECK (
    current_message_content_byte_length > 0 AND current_message_content_byte_length <= 16384
  ),
  focus_id TEXT,
  focus_digest TEXT,
  configuration_id TEXT NOT NULL,
  configuration_version TEXT NOT NULL,
  configuration_digest TEXT NOT NULL,
  context_compiler_id TEXT NOT NULL,
  context_compiler_version TEXT NOT NULL,
  context_compiler_digest TEXT NOT NULL,
  assistant_profile_id TEXT NOT NULL,
  assistant_profile_version TEXT NOT NULL,
  assistant_profile_digest TEXT NOT NULL,
  assistant_adapter_id TEXT NOT NULL,
  assistant_adapter_version TEXT NOT NULL,
  assistant_adapter_digest TEXT NOT NULL,
  response_contract_id TEXT NOT NULL,
  response_contract_version TEXT NOT NULL,
  response_contract_digest TEXT NOT NULL,
  routing_policy_id TEXT NOT NULL,
  routing_policy_version TEXT NOT NULL,
  routing_policy_digest TEXT NOT NULL,
  retention_profile_id TEXT NOT NULL,
  retention_profile_version TEXT NOT NULL,
  retention_profile_digest TEXT NOT NULL,
  budget_profile_id TEXT NOT NULL,
  budget_profile_version TEXT NOT NULL,
  budget_profile_digest TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  package_byte_length INTEGER NOT NULL CHECK (
    package_byte_length > 0 AND package_byte_length <= 65536
  ),
  created_at TEXT NOT NULL CHECK (
    length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'
  ),
  manifest_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  UNIQUE (id, session_id, manifest_digest),
  UNIQUE (operation_id, session_id),
  FOREIGN KEY (operation_id, session_id)
    REFERENCES interaction_operations(id, session_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (current_message_id, session_id, current_message_digest)
    REFERENCES interaction_messages(id, session_id, message_digest) ON DELETE RESTRICT,
  FOREIGN KEY (focus_id, session_id, focus_digest)
    REFERENCES interaction_focus_bindings(id, session_id, focus_digest) ON DELETE RESTRICT,
  FOREIGN KEY (routing_policy_id, routing_policy_version, routing_policy_digest)
    REFERENCES interaction_routing_policies(id, policy_version, policy_digest) ON DELETE RESTRICT,
  CHECK ((focus_id IS NULL AND focus_digest IS NULL) OR
    (focus_id IS NOT NULL AND focus_digest IS NOT NULL)),
  CHECK (json_extract(record_json, '$.id') = id),
  CHECK (json_extract(record_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(record_json, '$.sessionId') = session_id),
  CHECK (json_extract(record_json, '$.operationId') = operation_id),
  CHECK (json_extract(record_json, '$.reservedOperationVersion') = reserved_operation_version),
  CHECK (json_extract(record_json, '$.currentMessageRef.id') = current_message_id),
  CHECK (json_extract(record_json, '$.currentMessageRef.digest') = current_message_digest),
  CHECK (json_extract(record_json, '$.currentMessageContentDigest') = current_message_content_digest),
  CHECK (json_extract(record_json, '$.currentMessageContentByteLength') = current_message_content_byte_length),
  CHECK (json_extract(record_json, '$.configuration.id') = configuration_id),
  CHECK (json_extract(record_json, '$.configuration.version') = configuration_version),
  CHECK (json_extract(record_json, '$.configuration.digest') = configuration_digest),
  CHECK (json_extract(record_json, '$.contextCompiler.id') = context_compiler_id),
  CHECK (json_extract(record_json, '$.contextCompiler.version') = context_compiler_version),
  CHECK (json_extract(record_json, '$.contextCompiler.digest') = context_compiler_digest),
  CHECK (json_extract(record_json, '$.assistantProfile.id') = assistant_profile_id),
  CHECK (json_extract(record_json, '$.assistantProfile.version') = assistant_profile_version),
  CHECK (json_extract(record_json, '$.assistantProfile.digest') = assistant_profile_digest),
  CHECK (json_extract(record_json, '$.assistantAdapter.id') = assistant_adapter_id),
  CHECK (json_extract(record_json, '$.assistantAdapter.version') = assistant_adapter_version),
  CHECK (json_extract(record_json, '$.assistantAdapter.digest') = assistant_adapter_digest),
  CHECK (json_extract(record_json, '$.responseContract.id') = response_contract_id),
  CHECK (json_extract(record_json, '$.responseContract.version') = response_contract_version),
  CHECK (json_extract(record_json, '$.responseContract.digest') = response_contract_digest),
  CHECK (json_extract(record_json, '$.routingPolicy.id') = routing_policy_id),
  CHECK (json_extract(record_json, '$.routingPolicy.version') = routing_policy_version),
  CHECK (json_extract(record_json, '$.routingPolicy.digest') = routing_policy_digest),
  CHECK (json_extract(record_json, '$.retentionProfile.id') = retention_profile_id),
  CHECK (json_extract(record_json, '$.retentionProfile.version') = retention_profile_version),
  CHECK (json_extract(record_json, '$.retentionProfile.digest') = retention_profile_digest),
  CHECK (json_extract(record_json, '$.budgetProfile.id') = budget_profile_id),
  CHECK (json_extract(record_json, '$.budgetProfile.version') = budget_profile_version),
  CHECK (json_extract(record_json, '$.budgetProfile.digest') = budget_profile_digest),
  CHECK (json_extract(record_json, '$.packageDigest') = package_digest),
  CHECK (json_extract(record_json, '$.packageByteLength') = package_byte_length),
  CHECK (json_extract(record_json, '$.createdAt') = created_at),
  CHECK (json_extract(record_json, '$.manifestDigest') = manifest_digest),
  CHECK (
    (focus_id IS NULL AND json_type(record_json, '$.focusRef') IS NULL) OR
    (focus_id IS NOT NULL AND
      json_extract(record_json, '$.focusRef.id') = focus_id AND
      json_extract(record_json, '$.focusRef.digest') = focus_digest)
  )
) STRICT;

CREATE INDEX frontstage_context_manifests_session_idx
  ON frontstage_context_manifests(session_id, created_at, id);

CREATE UNIQUE INDEX interaction_operations_one_route_per_message_idx
  ON interaction_operations(session_id, message_id)
  WHERE operation_kind = 'ROUTE';

CREATE TRIGGER frontstage_context_manifests_no_update
BEFORE UPDATE ON frontstage_context_manifests
BEGIN
  SELECT RAISE(ABORT, 'Frontstage Context Manifests are immutable');
END;

CREATE TRIGGER frontstage_context_manifests_no_delete
BEFORE DELETE ON frontstage_context_manifests
BEGIN
  SELECT RAISE(ABORT, 'Frontstage Context Manifests cannot be deleted');
END;

CREATE TRIGGER interaction_operations_assistant_manifest_guard
BEFORE INSERT ON interaction_operations
WHEN NEW.context_manifest_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM frontstage_context_manifests AS manifest
     WHERE manifest.id = NEW.context_manifest_id
       AND manifest.session_id = NEW.session_id
       AND manifest.operation_id = NEW.id
       AND manifest.reserved_operation_version = NEW.version
       AND manifest.current_message_id = NEW.message_id
       AND manifest.current_message_digest = NEW.message_digest
       AND manifest.assistant_profile_id = NEW.assistant_profile_id
       AND manifest.assistant_profile_version = NEW.assistant_profile_version
       AND manifest.assistant_profile_digest = NEW.assistant_profile_digest
       AND manifest.manifest_digest = NEW.context_manifest_digest
  ) THEN RAISE(ABORT, 'Assistant Route Operation lacks its exact Context Manifest') END;
END;

CREATE TRIGGER interaction_operations_clarification_creation_guard
BEFORE INSERT ON interaction_operations
WHEN NEW.operation_kind = 'INTAKE_CLARIFICATION'
BEGIN
  SELECT RAISE(ABORT, 'Intake Clarification requires its result-specific creation owner');
END;

CREATE TRIGGER interaction_route_proposals_exact_parent_guard
BEFORE INSERT ON interaction_route_proposals
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_operations AS operation
      JOIN frontstage_context_manifests AS manifest
        ON manifest.id = operation.context_manifest_id
       AND manifest.session_id = operation.session_id
       AND manifest.manifest_digest = operation.context_manifest_digest
     WHERE operation.id = NEW.operation_id
       AND operation.session_id = NEW.session_id
       AND operation.message_id = NEW.message_id
       AND operation.message_digest = NEW.message_digest
       AND operation.operation_kind = 'ROUTE'
       AND operation.state = 'RESERVED'
       AND json_extract(NEW.record_json, '$.schemaVersion') = NEW.schema_version
       AND json_extract(NEW.record_json, '$.messageRef.digest') = NEW.message_digest
       AND json_extract(NEW.record_json, '$.contextManifestRef.id') = manifest.id
       AND json_extract(NEW.record_json, '$.contextManifestRef.digest') = manifest.manifest_digest
       AND json_extract(NEW.record_json, '$.assistantProfile.id') = manifest.assistant_profile_id
       AND json_extract(NEW.record_json, '$.assistantProfile.version') = manifest.assistant_profile_version
       AND json_extract(NEW.record_json, '$.assistantProfile.digest') = manifest.assistant_profile_digest
       AND json_extract(NEW.record_json, '$.assistantAdapter.id') = manifest.assistant_adapter_id
       AND json_extract(NEW.record_json, '$.assistantAdapter.version') = manifest.assistant_adapter_version
       AND json_extract(NEW.record_json, '$.assistantAdapter.digest') = manifest.assistant_adapter_digest
       AND json_extract(NEW.record_json, '$.responseContract.id') = manifest.response_contract_id
       AND json_extract(NEW.record_json, '$.responseContract.version') = manifest.response_contract_version
       AND json_extract(NEW.record_json, '$.responseContract.digest') = manifest.response_contract_digest
       AND json_extract(NEW.record_json, '$.observedAt') = NEW.observed_at
  ) THEN RAISE(ABORT, 'Route Proposal lacks its exact Assistant reservation parent') END;
END;

CREATE TRIGGER interaction_route_decisions_exact_authority_guard
BEFORE INSERT ON interaction_route_decisions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_sessions AS session
      JOIN interaction_messages AS message
        ON message.id = NEW.message_id
       AND message.session_id = NEW.session_id
       AND message.message_digest = NEW.message_digest
     WHERE session.id = NEW.session_id
       AND session.state = 'OPEN'
       AND session.version = NEW.expected_session_version
       AND message.role = 'USER'
       AND message.retention = 'RETAINED'
       AND message.created_at = session.updated_at
       AND json_extract(NEW.record_json, '$.schemaVersion') = NEW.schema_version
       AND json_extract(NEW.record_json, '$.expectedSessionVersion') = NEW.expected_session_version
       AND json_extract(NEW.record_json, '$.messageRef.id') = NEW.message_id
       AND json_extract(NEW.record_json, '$.messageRef.digest') = NEW.message_digest
       AND json_extract(NEW.record_json, '$.routingPolicy.id') = session.routing_policy_id
       AND json_extract(NEW.record_json, '$.routingPolicy.version') = session.routing_policy_version
       AND json_extract(NEW.record_json, '$.routingPolicy.digest') = session.routing_policy_digest
       AND json_extract(NEW.record_json, '$.decidedAt') = NEW.decided_at
       AND (
         (session.current_focus_id IS NULL AND NEW.focus_id IS NULL AND
           json_type(NEW.record_json, '$.focusRef') IS NULL) OR
         (session.current_focus_id = NEW.focus_id AND
           session.current_focus_digest = NEW.focus_digest AND
           json_extract(NEW.record_json, '$.focusRef.id') = NEW.focus_id AND
           json_extract(NEW.record_json, '$.focusRef.digest') = NEW.focus_digest)
       )
       AND (
         (NEW.proposal_id IS NULL AND
           json_extract(NEW.record_json, '$.source') <> 'ASSISTANT_PROPOSAL' AND
           json_type(NEW.record_json, '$.proposalRef') IS NULL) OR
         (NEW.proposal_id IS NOT NULL AND
           json_extract(NEW.record_json, '$.source') = 'ASSISTANT_PROPOSAL' AND
           json_extract(NEW.record_json, '$.proposalRef.id') = NEW.proposal_id AND
           json_extract(NEW.record_json, '$.proposalRef.digest') = NEW.proposal_digest)
       )
  ) THEN RAISE(ABORT, 'Route Decision lacks exact current Runtime authority') END;
END;

CREATE TRIGGER interaction_operations_route_completion_guard
BEFORE UPDATE ON interaction_operations
WHEN NEW.state = 'COMPLETED'
BEGIN
  SELECT CASE WHEN NEW.operation_kind <> 'ROUTE' OR NOT EXISTS (
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
             SELECT 1
               FROM interaction_route_proposals AS proposal
              WHERE proposal.id = decision.proposal_id
                AND proposal.session_id = NEW.session_id
                AND proposal.operation_id = NEW.id
                AND proposal.message_id = NEW.message_id
                AND proposal.message_digest = NEW.message_digest
                AND proposal.proposal_digest = decision.proposal_digest
           ) AND
           NEW.context_manifest_id IS NOT NULL)
       )
  ) THEN RAISE(ABORT, 'Route Operation completion lacks its exact Decision result') END;
END;
