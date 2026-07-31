DROP TRIGGER evidence_sets_insert_guard;

CREATE TRIGGER evidence_sets_insert_guard
BEFORE INSERT ON evidence_sets
WHEN COALESCE(
  json_type(NEW.obligation_mappings_json) = 'array'
  AND json_array_length(NEW.obligation_mappings_json) > 0
  AND json_type(NEW.evidence_refs_json) = 'array'
  AND json_array_length(NEW.evidence_refs_json) > 0
  AND json_type(NEW.unresolved_requirements_json) = 'array'
  AND json_array_length(NEW.unresolved_requirements_json) = 0
  AND (
    SELECT COUNT(DISTINCT obligation.check_spec_ref)
    FROM json_each(NEW.obligation_mappings_json) AS mapping
    JOIN verification_obligations AS obligation
      ON obligation.id = json_extract(mapping.value, '$.obligationId')
  ) = 1
  AND json_array_length(NEW.obligation_mappings_json) = (
    SELECT COUNT(*)
    FROM verification_obligations AS obligation
    WHERE obligation.goal_id = NEW.goal_id
      AND obligation.goal_revision = NEW.goal_revision
      AND obligation.candidate_generation_id = NEW.candidate_generation_id
      AND obligation.check_spec_ref = (
        SELECT selected.check_spec_ref
        FROM json_each(NEW.obligation_mappings_json) AS selected_mapping
        JOIN verification_obligations AS selected
          ON selected.id = json_extract(selected_mapping.value, '$.obligationId')
        LIMIT 1
      )
  )
  AND (
    SELECT COUNT(DISTINCT json_extract(mapping.value, '$.obligationId'))
    FROM json_each(NEW.obligation_mappings_json) AS mapping
  ) = json_array_length(NEW.obligation_mappings_json)
  AND (
    SELECT COUNT(DISTINCT json_extract(reference.value, '$.evidenceId'))
    FROM json_each(NEW.evidence_refs_json) AS reference
  ) = json_array_length(NEW.evidence_refs_json)
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(NEW.obligation_mappings_json) AS mapping
    WHERE json_type(mapping.value) <> 'object'
      OR (SELECT COUNT(*) FROM json_each(mapping.value)) <> 2
      OR EXISTS (
        SELECT 1 FROM json_each(mapping.value)
        WHERE key NOT IN ('obligationId', 'evidenceIds')
      )
      OR json_type(mapping.value, '$.obligationId') <> 'text'
      OR json_type(mapping.value, '$.evidenceIds') <> 'array'
      OR json_array_length(json_extract(mapping.value, '$.evidenceIds')) = 0
      OR NOT EXISTS (
        SELECT 1
        FROM verification_obligations AS obligation
        WHERE obligation.id = json_extract(mapping.value, '$.obligationId')
          AND obligation.goal_id = NEW.goal_id
          AND obligation.goal_revision = NEW.goal_revision
          AND obligation.candidate_generation_id = NEW.candidate_generation_id
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(json_extract(mapping.value, '$.evidenceIds')) AS mapped
        WHERE mapped.type <> 'text'
          OR NOT EXISTS (
            SELECT 1
            FROM json_each(NEW.evidence_refs_json) AS reference
            JOIN evidence_records AS evidence
              ON evidence.id = json_extract(reference.value, '$.evidenceId')
            JOIN verification_obligations AS obligation
              ON obligation.id = json_extract(mapping.value, '$.obligationId')
            WHERE json_extract(reference.value, '$.evidenceId') = mapped.value
              AND evidence.verification_obligation_id = obligation.id
              AND evidence.kind = obligation.required_evidence_kind
              AND json_extract(evidence.check_spec_json, '$.id') || '@' ||
                json_extract(evidence.check_spec_json, '$.version') = obligation.check_spec_ref
          )
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_refs_json) AS reference
    WHERE json_type(reference.value) <> 'object'
      OR (SELECT COUNT(*) FROM json_each(reference.value)) <> 4
      OR EXISTS (
        SELECT 1 FROM json_each(reference.value)
        WHERE key NOT IN (
          'evidenceId', 'evidenceRecordDigest', 'eligibilityVersion', 'eligibilityState'
        )
      )
      OR json_type(reference.value, '$.evidenceId') <> 'text'
      OR json_extract(reference.value, '$.eligibilityVersion') <> 1
      OR json_extract(reference.value, '$.eligibilityState') <> 'ELIGIBLE'
      OR NOT EXISTS (
        SELECT 1
        FROM evidence_records AS evidence
        JOIN evidence_eligibility AS eligibility
          ON eligibility.evidence_id = evidence.id
          AND eligibility.version = json_extract(reference.value, '$.eligibilityVersion')
        JOIN audit_events AS evidence_audit
          ON evidence_audit.aggregate_type = 'EVIDENCE'
          AND evidence_audit.aggregate_id = evidence.id
          AND evidence_audit.event_type = 'EVIDENCE_RECORDED_ELIGIBLE'
        WHERE evidence.id = json_extract(reference.value, '$.evidenceId')
          AND evidence.record_digest =
            json_extract(reference.value, '$.evidenceRecordDigest')
          AND evidence.goal_id = NEW.goal_id
          AND evidence.goal_revision = NEW.goal_revision
          AND evidence.candidate_generation_id = NEW.candidate_generation_id
          AND evidence.candidate_digest = NEW.candidate_digest
          AND eligibility.state = 'ELIGIBLE'
          AND evidence_audit.sequence < (
            SELECT sequence
            FROM audit_events AS set_audit
            WHERE set_audit.aggregate_type = 'EVIDENCE_SET'
              AND set_audit.aggregate_id = NEW.digest
              AND set_audit.event_type = 'EVIDENCE_SET_RECORDED'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM evidence_eligibility AS later
        WHERE later.evidence_id = json_extract(reference.value, '$.evidenceId')
          AND later.version > json_extract(reference.value, '$.eligibilityVersion')
      )
      OR NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.obligation_mappings_json) AS mapping,
             json_each(json_extract(mapping.value, '$.evidenceIds')) AS mapped
        WHERE mapped.value = json_extract(reference.value, '$.evidenceId')
      )
  )
  AND EXISTS (
    SELECT 1
    FROM candidate_generations AS generation
    JOIN candidates AS candidate ON candidate.id = generation.candidate_id
    WHERE generation.id = NEW.candidate_generation_id
      AND generation.state = 'FROZEN'
      AND generation.frozen_digest = NEW.candidate_digest
      AND candidate.goal_id = NEW.goal_id
      AND EXISTS (
        SELECT 1
        FROM workflows AS workflow
        WHERE workflow.id = generation.workflow_id
          AND workflow.goal_id = NEW.goal_id
          AND workflow.goal_revision = NEW.goal_revision
      )
  )
  AND EXISTS (
    SELECT 1
    FROM audit_events
    WHERE aggregate_type = 'EVIDENCE_SET'
      AND aggregate_id = NEW.digest
      AND event_type = 'EVIDENCE_SET_RECORDED'
      AND actor_type = 'RUNTIME'
      AND command_id IS NOT NULL
      AND before_version IS NULL
      AND after_version IS NULL
      AND payload_digest = NEW.digest
      AND (
        SELECT COUNT(*)
        FROM audit_events AS only_audit
        WHERE only_audit.aggregate_type = 'EVIDENCE_SET'
          AND only_audit.aggregate_id = NEW.digest
      ) = 1
  )
  , 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Evidence Set');
END;
