CREATE TABLE candidate_evidence_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

-- Placeholder rows predate an owning Candidate/Evidence authority. Their
-- missing roots, revisions, policy identities, and canonical digests cannot be
-- reconstructed without inventing facts. A Goal without any required success
-- criterion also has no executable M1 completion boundary. Slice 5 therefore
-- fails closed for either retained shape.
INSERT INTO candidate_evidence_migration_guard(valid)
SELECT 0
WHERE EXISTS (SELECT 1 FROM candidate_generations)
   OR EXISTS (SELECT 1 FROM verification_obligations)
   OR EXISTS (SELECT 1 FROM evidence_records)
   OR EXISTS (SELECT 1 FROM evidence_eligibility)
   OR EXISTS (
     SELECT 1
     FROM goals AS goal
     WHERE NOT EXISTS (
       SELECT 1
       FROM goal_criteria AS criterion
       WHERE criterion.goal_id = goal.id AND criterion.required = 1
     )
   )
   OR EXISTS (
     SELECT 1
     FROM context_manifests
     WHERE candidate_generation_id IS NOT NULL OR candidate_digest IS NOT NULL
   );

DROP TABLE candidate_evidence_migration_guard;

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL UNIQUE REFERENCES goals(id) ON DELETE RESTRICT,
  base_project_identity TEXT NOT NULL CHECK (length(trim(base_project_identity)) > 0)
) STRICT;

CREATE TABLE check_specifications (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL CHECK (length(trim(version)) > 0),
  canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json)),
  UNIQUE (id, version)
) STRICT;

ALTER TABLE verification_obligations ADD COLUMN goal_revision INTEGER;
ALTER TABLE verification_obligations ADD COLUMN candidate_generation_id TEXT
  REFERENCES candidate_generations(id);
ALTER TABLE evidence_records ADD COLUMN policy_bundle_id TEXT REFERENCES policy_bundles(id);
ALTER TABLE evidence_records ADD COLUMN verification_obligation_id TEXT
  REFERENCES verification_obligations(id);

CREATE TABLE evidence_sets (
  digest TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL CHECK (
    goal_revision >= 1 AND goal_revision <= 9007199254740991
  ),
  candidate_generation_id TEXT NOT NULL REFERENCES candidate_generations(id) ON DELETE RESTRICT,
  candidate_digest TEXT NOT NULL,
  obligation_mappings_json TEXT NOT NULL CHECK (json_valid(obligation_mappings_json)),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  unresolved_requirements_json TEXT NOT NULL CHECK (json_valid(unresolved_requirements_json)),
  FOREIGN KEY (goal_id, goal_revision) REFERENCES goals(id, revision) ON DELETE RESTRICT,
  CHECK (length(digest) = 71 AND substr(digest, 1, 7) = 'sha256:'),
  CHECK (length(candidate_digest) = 71 AND substr(candidate_digest, 1, 7) = 'sha256:')
) STRICT;

CREATE INDEX candidate_generations_candidate_idx
  ON candidate_generations(candidate_id, sequence);
CREATE INDEX verification_obligations_goal_revision_idx
  ON verification_obligations(goal_id, goal_revision, candidate_generation_id, id);
CREATE INDEX evidence_sets_candidate_idx
  ON evidence_sets(candidate_generation_id, candidate_digest);

-- M1 creates a Goal and its unique Workflow in one transaction, after all Goal
-- criteria have been inserted. That Workflow write is the first SQL boundary
-- where the cross-row required-criterion invariant can be checked atomically.
CREATE TRIGGER workflows_required_criterion_insert_guard
BEFORE INSERT ON workflows
WHEN NOT EXISTS (
  SELECT 1
  FROM goal_criteria
  WHERE goal_id = NEW.goal_id AND required = 1
)
BEGIN
  SELECT RAISE(ABORT, 'Workflow Goal requires at least one required success criterion');
END;

CREATE TRIGGER goal_criteria_required_update_guard
BEFORE UPDATE OF goal_id, required ON goal_criteria
WHEN OLD.required = 1
  AND (NEW.goal_id <> OLD.goal_id OR NEW.required <> 1)
  AND NOT EXISTS (
    SELECT 1
    FROM goal_criteria
    WHERE goal_id = OLD.goal_id AND required = 1 AND id <> OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'Goal must retain at least one required success criterion');
END;

CREATE TRIGGER goal_criteria_required_delete_guard
BEFORE DELETE ON goal_criteria
WHEN OLD.required = 1
  AND NOT EXISTS (
    SELECT 1
    FROM goal_criteria
    WHERE goal_id = OLD.goal_id AND required = 1 AND id <> OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'Goal must retain at least one required success criterion');
END;

CREATE TRIGGER candidates_insert_guard
BEFORE INSERT ON candidates
WHEN COALESCE(
  length(NEW.id) BETWEEN 11 AND 138
  AND substr(NEW.id, 1, 10) = 'candidate_'
  AND substr(NEW.id, 11) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 11, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND length(NEW.base_project_identity) = 82
  AND substr(NEW.base_project_identity, 1, 18) = 'm1-project:sha256:'
  AND substr(NEW.base_project_identity, 19) NOT GLOB '*[^0-9a-f]*'
  AND EXISTS (
    SELECT 1
    FROM audit_events
    WHERE aggregate_type = 'CANDIDATE'
      AND aggregate_id = NEW.id
      AND event_type = 'CANDIDATE_CREATED'
      AND actor_type = 'RUNTIME'
  )
  , 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Candidate root');
END;

CREATE TRIGGER candidates_no_update
BEFORE UPDATE ON candidates
BEGIN
  SELECT RAISE(ABORT, 'Candidate roots are immutable');
END;

CREATE TRIGGER candidates_no_delete
BEFORE DELETE ON candidates
BEGIN
  SELECT RAISE(ABORT, 'Candidate roots cannot be deleted');
END;

CREATE TRIGGER candidate_generations_slice5_insert_guard
BEFORE INSERT ON candidate_generations
WHEN COALESCE(
  NEW.state = 'MUTABLE'
  AND NEW.version = 1
  AND NEW.created_at = NEW.updated_at
  AND NEW.workspace_identity = 'm1-workspace:' || NEW.id
  AND EXISTS (
    SELECT 1
    FROM candidates AS candidate
    JOIN workflows AS workflow ON workflow.goal_id = candidate.goal_id
    WHERE candidate.id = NEW.candidate_id
      AND workflow.id = NEW.workflow_id
  )
  AND (
    (NEW.sequence = 1 AND NEW.parent_generation_id IS NULL)
    OR (
      NEW.sequence > 1
      AND EXISTS (
        SELECT 1
        FROM candidate_generations AS parent
        WHERE parent.id = NEW.parent_generation_id
          AND parent.candidate_id = NEW.candidate_id
          AND parent.workflow_id = NEW.workflow_id
          AND parent.sequence = NEW.sequence - 1
          AND parent.state IN ('INVALIDATED', 'REJECTED')
      )
    )
  )
  AND EXISTS (
    SELECT 1
    FROM audit_events
    WHERE aggregate_type = 'CANDIDATE_GENERATION'
      AND aggregate_id = NEW.id
      AND event_type = 'CANDIDATE_GENERATION_CREATED'
      AND actor_type = 'RUNTIME'
      AND after_version = 1
  )
  , 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Candidate generation creation');
END;

CREATE TRIGGER candidate_generations_slice5_update_guard
BEFORE UPDATE ON candidate_generations
WHEN COALESCE(
  NEW.version = OLD.version + 1
  AND NEW.updated_at >= OLD.updated_at
  AND (
    (OLD.state = 'MUTABLE' AND NEW.state = 'FREEZING')
    OR (OLD.state = 'FREEZING' AND NEW.state IN ('FROZEN', 'INVALIDATED'))
    OR (OLD.state = 'MUTABLE' AND NEW.state = 'INVALIDATED')
    OR (OLD.state = 'FROZEN' AND NEW.state IN ('INVALIDATED', 'REJECTED', 'ACCEPTED'))
  )
  AND EXISTS (
    SELECT 1
    FROM audit_events
    WHERE aggregate_type = 'CANDIDATE_GENERATION'
      AND aggregate_id = NEW.id
      AND event_type = 'CANDIDATE_STATE_CHANGED'
      AND actor_type = 'RUNTIME'
      AND before_version = OLD.version
      AND after_version = NEW.version
      AND occurred_at = NEW.updated_at
  )
  , 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Candidate generation transition');
END;

CREATE TRIGGER candidate_generations_no_delete
BEFORE DELETE ON candidate_generations
BEGIN
  SELECT RAISE(ABORT, 'Candidate generations cannot be deleted');
END;

CREATE TRIGGER check_specifications_insert_guard
BEFORE INSERT ON check_specifications
WHEN COALESCE(
  length(NEW.id) BETWEEN 7 AND 134
  AND substr(NEW.id, 1, 6) = 'check_'
  AND substr(NEW.id, 7) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 7, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND json_type(NEW.canonical_json) = 'object'
  AND json_extract(NEW.canonical_json, '$.id') = NEW.id
  AND json_extract(NEW.canonical_json, '$.version') = NEW.version
  AND json_extract(NEW.canonical_json, '$.schemaVersion') = 1
  AND NEW.version = 'm1.2'
  AND json_extract(NEW.canonical_json, '$.environmentPolicy') =
    'M1_LOGICAL_DETERMINISTIC'
  AND json_extract(NEW.canonical_json, '$.timeoutMilliseconds') = 1000
  AND json_extract(NEW.canonical_json, '$.outputLimitBytes') = 65536
  AND json_extract(NEW.canonical_json, '$.cleanupPolicy') =
    'M1_LOGICAL_NO_EXTERNAL_RESOURCES'
  AND json_type(NEW.canonical_json, '$.inputRefs') = 'array'
  AND json_array_length(json_extract(NEW.canonical_json, '$.inputRefs')) = 1
  AND EXISTS (
    SELECT 1
    FROM candidate_generations AS generation
    WHERE generation.id = json_extract(NEW.canonical_json, '$.inputRefs[0]')
      AND generation.workspace_identity = json_extract(NEW.canonical_json, '$.cwdIdentity')
  )
  AND (SELECT COUNT(*) FROM json_each(NEW.canonical_json)) = 14
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.canonical_json)
    WHERE key NOT IN (
      'schemaVersion', 'id', 'version', 'kind', 'producerType', 'producerIdentity',
      'operation', 'cwdIdentity', 'inputRefs', 'environmentPolicy', 'timeoutMilliseconds',
      'outputLimitBytes', 'expectedObservationSchema', 'cleanupPolicy'
    )
  )
  AND (
    (
      json_extract(NEW.canonical_json, '$.kind') = 'CANDIDATE_FREEZE'
      AND json_extract(NEW.canonical_json, '$.producerType') = 'CANDIDATE_MANAGER'
      AND json_extract(NEW.canonical_json, '$.producerIdentity') = 'candidate-manager:m1'
      AND json_extract(NEW.canonical_json, '$.operation') = 'm1.logical.candidate.freeze'
      AND json_extract(NEW.canonical_json, '$.expectedObservationSchema') =
        'codeclosure.candidate-freeze-observation.v1'
    )
    OR
    (
      json_extract(NEW.canonical_json, '$.kind') = 'FAKE_VERIFICATION'
      AND json_extract(NEW.canonical_json, '$.producerType') = 'VERIFICATION_RUNNER'
      AND json_extract(NEW.canonical_json, '$.producerIdentity') =
        'fake-verification-runner:m1'
      AND json_extract(NEW.canonical_json, '$.operation') = 'm1.logical.fake-verification'
      AND json_extract(NEW.canonical_json, '$.expectedObservationSchema') =
        'codeclosure.fake-verification-observation.v1'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM audit_events
    WHERE aggregate_type = 'CHECK_SPECIFICATION'
      AND aggregate_id = NEW.id
      AND event_type = 'CHECK_SPECIFICATION_RECORDED'
      AND actor_type = 'RUNTIME'
  )
  , 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid Check Specification authority');
END;

CREATE TRIGGER check_specifications_no_update
BEFORE UPDATE ON check_specifications
BEGIN
  SELECT RAISE(ABORT, 'Check Specifications are immutable');
END;

CREATE TRIGGER check_specifications_no_delete
BEFORE DELETE ON check_specifications
BEGIN
  SELECT RAISE(ABORT, 'Check Specifications cannot be deleted');
END;

CREATE TRIGGER verification_obligations_slice5_insert_guard
BEFORE INSERT ON verification_obligations
WHEN COALESCE(
  NEW.goal_revision IS NOT NULL
  AND NEW.candidate_generation_id IS NOT NULL
  AND NEW.goal_revision BETWEEN 1 AND 9007199254740991
  AND length(NEW.id) BETWEEN 12 AND 139
  AND substr(NEW.id, 1, 11) = 'obligation_'
  AND substr(NEW.id, 12) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 12, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND json_type(NEW.source_criterion_refs_json) = 'array'
  AND json_array_length(NEW.source_criterion_refs_json) = 1
  AND json_type(NEW.scenario_refs_json) = 'array'
  AND NEW.required_evidence_kind IN ('CANDIDATE_FREEZE', 'TEST_RESULT')
  AND length(trim(NEW.check_spec_ref)) > 0
  AND length(trim(NEW.strength)) > 0
  AND EXISTS (
    SELECT 1 FROM goals
    WHERE id = NEW.goal_id AND revision = NEW.goal_revision
  )
  AND EXISTS (
    SELECT 1
    FROM candidate_generations AS generation
    JOIN candidates AS candidate ON candidate.id = generation.candidate_id
    WHERE generation.id = NEW.candidate_generation_id
      AND candidate.goal_id = NEW.goal_id
  )
  AND EXISTS (
    SELECT 1
    FROM check_specifications AS specification
    WHERE specification.id || '@' || specification.version = NEW.check_spec_ref
      AND json_array_length(json_extract(specification.canonical_json, '$.inputRefs')) = 1
      AND json_extract(specification.canonical_json, '$.inputRefs[0]') =
        NEW.candidate_generation_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(NEW.source_criterion_refs_json) AS criterion_ref
    WHERE criterion_ref.type <> 'text'
      OR NOT EXISTS (
        SELECT 1 FROM goal_criteria
        WHERE goal_id = NEW.goal_id
          AND id = criterion_ref.value
          AND required = 1
      )
  )
  AND EXISTS (
    SELECT 1
    FROM audit_events
    WHERE aggregate_type = 'VERIFICATION_OBLIGATION'
      AND aggregate_id = NEW.id
      AND event_type = 'VERIFICATION_OBLIGATION_RECORDED'
      AND actor_type = 'RUNTIME'
      AND occurred_at = NEW.created_at
  )
  , 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid Verification Obligation authority');
END;

CREATE TRIGGER verification_obligations_no_update
BEFORE UPDATE ON verification_obligations
BEGIN
  SELECT RAISE(ABORT, 'Verification Obligations are immutable');
END;

CREATE TRIGGER verification_obligations_no_delete
BEFORE DELETE ON verification_obligations
BEGIN
  SELECT RAISE(ABORT, 'Verification Obligations cannot be deleted');
END;

CREATE TRIGGER evidence_records_slice5_insert_guard
BEFORE INSERT ON evidence_records
WHEN COALESCE(
  NEW.schema_version = 1
  AND NEW.policy_bundle_id IS NOT NULL
  AND length(NEW.id) BETWEEN 10 AND 137
  AND substr(NEW.id, 1, 9) = 'evidence_'
  AND substr(NEW.id, 10) NOT GLOB '*[^a-z0-9-]*'
  AND substr(NEW.id, 10, 1) GLOB '[a-z0-9]'
  AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
  AND NEW.kind IN ('CANDIDATE_FREEZE', 'TEST_RESULT')
  AND NEW.producer_type IN ('CANDIDATE_MANAGER', 'VERIFICATION_RUNNER')
  AND length(trim(NEW.producer_identity)) > 0
  AND NEW.fact_snapshot_digest IS NULL
  AND json_type(NEW.check_spec_json) = 'object'
  AND json_type(NEW.observation_json) = 'object'
  AND json_type(NEW.payload_refs_json) = 'array'
  AND json_array_length(NEW.payload_refs_json) = 1
  AND length(NEW.observation_digest) = 71
  AND substr(NEW.observation_digest, 1, 7) = 'sha256:'
  AND substr(NEW.observation_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.record_digest) = 71
  AND substr(NEW.record_digest, 1, 7) = 'sha256:'
  AND substr(NEW.record_digest, 8) NOT GLOB '*[^0-9a-f]*'
  AND NEW.ended_at >= NEW.started_at
  AND NEW.recorded_at >= NEW.ended_at
  AND json_extract(NEW.check_spec_json, '$.producerType') = NEW.producer_type
  AND json_extract(NEW.check_spec_json, '$.producerIdentity') = NEW.producer_identity
  AND EXISTS (
    SELECT 1
    FROM check_specifications AS specification
    WHERE specification.id = json_extract(NEW.check_spec_json, '$.id')
      AND specification.version = json_extract(NEW.check_spec_json, '$.version')
      AND json(specification.canonical_json) = json(NEW.check_spec_json)
  )
  AND EXISTS (
    SELECT 1
    FROM candidate_generations AS generation
    JOIN candidates AS candidate ON candidate.id = generation.candidate_id
    JOIN workflows AS workflow ON workflow.id = generation.workflow_id
    JOIN attempts AS attempt ON attempt.id = NEW.attempt_id
    JOIN policy_bundles AS policy ON policy.id = NEW.policy_bundle_id
    WHERE generation.id = NEW.candidate_generation_id
      AND generation.state = 'FROZEN'
      AND generation.frozen_digest = NEW.candidate_digest
      AND candidate.goal_id = NEW.goal_id
      AND workflow.id = NEW.workflow_id
      AND workflow.goal_revision = NEW.goal_revision
      AND attempt.workflow_id = workflow.id
      AND policy.bundle_digest = NEW.policy_bundle_digest
  )
  AND (
    (NEW.kind = 'CANDIDATE_FREEZE'
      AND NEW.producer_type = 'CANDIDATE_MANAGER'
      AND NEW.producer_identity = 'candidate-manager:m1'
      AND NEW.verification_obligation_id IS NULL
      AND NEW.environment_identity_json IS NULL
      AND NEW.result_status = 'OBSERVED'
      AND json_extract(NEW.check_spec_json, '$.kind') = 'CANDIDATE_FREEZE'
      AND json_extract(NEW.observation_json, '$.kind') = 'CANDIDATE_FREEZE'
      AND json_extract(NEW.observation_json, '$.schemaVersion') = 1
      AND json_extract(NEW.observation_json, '$.firstSourceDigest') =
        json_extract(NEW.observation_json, '$.secondSourceDigest')
      AND json_extract(NEW.payload_refs_json, '$[0]') =
        json_extract(NEW.observation_json, '$.changeSetDigest')
      AND (SELECT COUNT(*) FROM json_each(NEW.observation_json)) = 5
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.observation_json)
        WHERE key NOT IN (
          'schemaVersion', 'kind', 'firstSourceDigest', 'secondSourceDigest', 'changeSetDigest'
        )
      )
      AND EXISTS (
        SELECT 1 FROM attempts
        WHERE id = NEW.attempt_id
          AND phase = 'SOURCE_FREEZE'
          AND status = 'RUNNING'
      ))
    OR
    (NEW.kind = 'TEST_RESULT'
      AND NEW.producer_type = 'VERIFICATION_RUNNER'
      AND NEW.producer_identity = 'fake-verification-runner:m1'
      AND NEW.verification_obligation_id IS NOT NULL
      AND NEW.result_status IN ('PASS', 'FAIL', 'RUNNER_ERROR', 'TIMEOUT')
      AND json_extract(NEW.check_spec_json, '$.kind') = 'FAKE_VERIFICATION'
      AND json_type(NEW.environment_identity_json) = 'object'
      AND json_extract(NEW.environment_identity_json, '$.schemaVersion') = 1
      AND json_extract(NEW.environment_identity_json, '$.kind') = 'M1_LOGICAL'
      AND json_extract(NEW.environment_identity_json, '$.identity') =
        'm1-logical:' || json_extract(NEW.check_spec_json, '$.cwdIdentity')
      AND length(json_extract(NEW.environment_identity_json, '$.digest')) = 71
      AND substr(json_extract(NEW.environment_identity_json, '$.digest'), 1, 7) = 'sha256:'
      AND substr(json_extract(NEW.environment_identity_json, '$.digest'), 8)
        NOT GLOB '*[^0-9a-f]*'
      AND (SELECT COUNT(*) FROM json_each(NEW.environment_identity_json)) = 4
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.environment_identity_json)
        WHERE key NOT IN ('schemaVersion', 'kind', 'identity', 'digest')
      )
      AND json_extract(NEW.payload_refs_json, '$[0]') = NEW.observation_digest
      AND json_extract(NEW.observation_json, '$.kind') = 'FAKE_VERIFICATION'
      AND json_extract(NEW.observation_json, '$.schemaVersion') = 1
      AND json_extract(NEW.observation_json, '$.checkSpecRef') =
        json_extract(NEW.check_spec_json, '$.id') || '@' ||
        json_extract(NEW.check_spec_json, '$.version')
      AND json_extract(NEW.observation_json, '$.observedResult') = NEW.result_status
      AND json_extract(NEW.observation_json, '$.detailCode') = CASE NEW.result_status
        WHEN 'PASS' THEN 'M1_FAKE_PASS'
        WHEN 'FAIL' THEN 'M1_FAKE_FAIL'
        WHEN 'RUNNER_ERROR' THEN 'M1_FAKE_RUNNER_ERROR'
        WHEN 'TIMEOUT' THEN 'M1_FAKE_TIMEOUT'
      END
      AND (SELECT COUNT(*) FROM json_each(NEW.observation_json)) = 5
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.observation_json)
        WHERE key NOT IN (
          'schemaVersion', 'kind', 'checkSpecRef', 'observedResult', 'detailCode'
        )
      )
      AND EXISTS (
        SELECT 1 FROM attempts
        WHERE id = NEW.attempt_id
          AND phase = 'EVIDENCE_BUILD'
          AND status = 'RUNNING'
      )
      AND EXISTS (
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
      ))
  )
  AND EXISTS (
    SELECT 1
    FROM audit_events
    WHERE aggregate_type = 'EVIDENCE'
      AND aggregate_id = NEW.id
      AND event_type = 'EVIDENCE_RECORDED_ELIGIBLE'
      AND actor_type = 'RUNTIME'
      AND payload_digest = NEW.record_digest
      AND occurred_at = NEW.recorded_at
  )
  , 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Evidence record');
END;

CREATE TRIGGER evidence_eligibility_slice5_insert_guard
BEFORE INSERT ON evidence_eligibility
WHEN COALESCE(
  (
    NEW.version = 1
    AND NEW.state = 'ELIGIBLE'
    AND NEW.reason_code IS NULL
    AND NEW.source_ref IS NULL
    AND EXISTS (
      SELECT 1 FROM evidence_records
      WHERE id = NEW.evidence_id AND recorded_at = NEW.changed_at
    )
    AND EXISTS (
      SELECT 1
      FROM audit_events
      WHERE aggregate_type = 'EVIDENCE'
        AND aggregate_id = NEW.evidence_id
        AND event_type = 'EVIDENCE_RECORDED_ELIGIBLE'
        AND actor_type = 'RUNTIME'
        AND after_version = 1
        AND occurred_at = NEW.changed_at
    )
  )
  OR
  (
    NEW.version = 2
    AND NEW.state = 'INELIGIBLE'
    AND length(trim(NEW.reason_code)) > 0
    AND length(trim(NEW.source_ref)) > 0
    AND EXISTS (
      SELECT 1
      FROM evidence_eligibility
      WHERE evidence_id = NEW.evidence_id
        AND version = 1
        AND state = 'ELIGIBLE'
    )
    AND EXISTS (
      SELECT 1
      FROM audit_events
      WHERE aggregate_type = 'EVIDENCE'
        AND aggregate_id = NEW.evidence_id
        AND event_type = 'EVIDENCE_ELIGIBILITY_CHANGED'
        AND actor_type = 'RUNTIME'
        AND before_version = 1
        AND after_version = 2
        AND occurred_at = NEW.changed_at
    )
  )
  , 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Evidence eligibility transition');
END;

CREATE TRIGGER evidence_sets_insert_guard
BEFORE INSERT ON evidence_sets
WHEN COALESCE(
  json_type(NEW.obligation_mappings_json) = 'array'
  AND json_array_length(NEW.obligation_mappings_json) > 0
  AND json_type(NEW.evidence_refs_json) = 'array'
  AND json_array_length(NEW.evidence_refs_json) > 0
  AND json_type(NEW.unresolved_requirements_json) = 'array'
  AND json_array_length(NEW.unresolved_requirements_json) = 0
  AND json_array_length(NEW.obligation_mappings_json) = (
    SELECT COUNT(*)
    FROM verification_obligations AS obligation
    WHERE obligation.goal_id = NEW.goal_id
      AND obligation.goal_revision = NEW.goal_revision
      AND obligation.candidate_generation_id = NEW.candidate_generation_id
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

CREATE TRIGGER evidence_sets_no_update
BEFORE UPDATE ON evidence_sets
BEGIN
  SELECT RAISE(ABORT, 'Evidence Sets are immutable');
END;

CREATE TRIGGER evidence_sets_no_delete
BEFORE DELETE ON evidence_sets
BEGIN
  SELECT RAISE(ABORT, 'Evidence Sets cannot be deleted');
END;

DROP TRIGGER context_manifests_m1_source_insert_guard;

CREATE TRIGGER context_manifests_m1_source_insert_guard
BEFORE INSERT ON context_manifests
WHEN COALESCE(
  json_type(NEW.entries_json) = 'array'
  AND json_type(NEW.omission_decisions_json) = 'array'
  AND json_array_length(NEW.omission_decisions_json) = 0
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(NEW.entries_json) AS entry
    WHERE COALESCE(
      json_type(entry.value) = 'object'
      AND json_type(entry.value, '$.kind') = 'text'
      AND json_type(entry.value, '$.authorityClass') = 'text'
      AND (
        (
          json_extract(entry.value, '$.kind') IN ('GOAL', 'SUCCESS_CRITERION')
          AND json_extract(entry.value, '$.authorityClass') = 'GOAL_AUTHORITY'
        )
        OR (
          json_extract(entry.value, '$.kind') = 'CANDIDATE'
          AND json_extract(entry.value, '$.authorityClass') = 'PROJECT_OBSERVATION'
        )
      ),
      0
    ) = 0
  )
  AND (
    (
      NEW.phase IN ('DISCOVERY', 'PLAN')
      AND NEW.candidate_generation_id IS NULL
      AND NEW.candidate_digest IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.entries_json)
        WHERE json_extract(value, '$.kind') = 'CANDIDATE'
      )
    )
    OR (
      NEW.phase = 'IMPLEMENT'
      AND EXISTS (
        SELECT 1
        FROM candidate_generations AS generation
        JOIN candidates AS candidate ON candidate.id = generation.candidate_id
        JOIN workflows AS workflow ON workflow.id = generation.workflow_id
        WHERE generation.id = NEW.candidate_generation_id
          AND generation.state = 'MUTABLE'
          AND generation.base_digest = NEW.candidate_digest
          AND workflow.id = NEW.workflow_id
          AND workflow.goal_id = NEW.goal_id
          AND workflow.goal_revision = NEW.goal_revision
          AND workflow.version = NEW.workflow_version
          AND workflow.active_candidate_generation_id = generation.id
          AND candidate.goal_id = workflow.goal_id
          AND (
            SELECT count(*)
            FROM json_each(NEW.entries_json)
            WHERE json_extract(value, '$.kind') = 'CANDIDATE'
          ) = 1
          AND (
            SELECT count(*)
            FROM json_each(NEW.entries_json)
            WHERE json_extract(value, '$.kind') = 'CANDIDATE'
              AND json_extract(value, '$.authorityClass') = 'PROJECT_OBSERVATION'
              AND json_extract(value, '$.sourceRef') = generation.id
              AND json_extract(value, '$.sourceRevision') = CAST(workflow.version AS TEXT)
              AND json_extract(value, '$.sourceDigest') = generation.base_digest
          ) = 1
      )
    )
  ),
  0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'M1 Context source authority is not exact and current');
END;
