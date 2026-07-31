CREATE TABLE evidence_payloads (
  digest TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (
    byte_length >= 0 AND byte_length <= 9007199254740991
  ),
  payload_bytes BLOB NOT NULL,
  PRIMARY KEY (digest, byte_length),
  CHECK (length(digest) = 71 AND substr(digest, 1, 7) = 'sha256:'),
  CHECK (substr(digest, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(payload_bytes) = byte_length)
) STRICT;

ALTER TABLE evidence_records ADD COLUMN workspace_lease_id TEXT;
ALTER TABLE evidence_records ADD COLUMN workspace_lease_digest TEXT;

CREATE TRIGGER evidence_payloads_no_update
BEFORE UPDATE ON evidence_payloads
BEGIN
  SELECT RAISE(ABORT, 'Evidence payloads are immutable');
END;

CREATE TRIGGER evidence_payloads_no_delete
BEFORE DELETE ON evidence_payloads
BEGIN
  SELECT RAISE(ABORT, 'Evidence payloads cannot be deleted');
END;

DROP TRIGGER check_specifications_insert_guard;

CREATE TRIGGER check_specifications_closed_version_guard
BEFORE INSERT ON check_specifications
WHEN COALESCE(
  json_valid(NEW.canonical_json)
  AND json_type(NEW.canonical_json) = 'object'
  AND json_extract(NEW.canonical_json, '$.schemaVersion') IN (1, 2),
  0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'unknown Check Specification schema version');
END;

CREATE TRIGGER check_specifications_insert_guard
BEFORE INSERT ON check_specifications
WHEN json_extract(NEW.canonical_json, '$.schemaVersion') = 1
  AND COALESCE(
    length(NEW.id) BETWEEN 7 AND 134
    AND substr(NEW.id, 1, 6) = 'check_'
    AND substr(NEW.id, 7) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 7, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND json_extract(NEW.canonical_json, '$.id') = NEW.id
    AND json_extract(NEW.canonical_json, '$.version') = NEW.version
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
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid Check Specification authority');
END;

CREATE TRIGGER check_specifications_local_command_insert_guard
BEFORE INSERT ON check_specifications
WHEN json_extract(NEW.canonical_json, '$.schemaVersion') = 2
  AND COALESCE(
    length(NEW.id) BETWEEN 7 AND 134
    AND substr(NEW.id, 1, 6) = 'check_'
    AND substr(NEW.id, 7) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 7, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND json_extract(NEW.canonical_json, '$.id') = NEW.id
    AND json_extract(NEW.canonical_json, '$.version') = NEW.version
    AND json_extract(NEW.canonical_json, '$.kind') = 'LOCAL_COMMAND'
    AND json_extract(NEW.canonical_json, '$.producerType') = 'VERIFICATION_RUNNER'
    AND length(trim(json_extract(NEW.canonical_json, '$.producerIdentity'))) > 0
    AND length(trim(json_extract(NEW.canonical_json, '$.runnerIdentity'))) > 0
    AND length(trim(json_extract(NEW.canonical_json, '$.runnerVersion'))) > 0
    AND json_extract(NEW.canonical_json, '$.environmentPolicy') =
      'LOCAL_COMMAND_EXPLICIT_V1'
    AND json_extract(NEW.canonical_json, '$.environmentInheritance') = 'NONE'
    AND json_extract(NEW.canonical_json, '$.expectedObservationSchema') =
      'LOCAL_COMMAND_OBSERVATION_V1'
    AND json_extract(NEW.canonical_json, '$.cleanupPolicy') = 'LOCAL_COMMAND_RUN_ROOT_V1'
    AND json_extract(NEW.canonical_json, '$.candidateAccess') = 'READ_ONLY'
    AND json_extract(NEW.canonical_json, '$.authorityAccess') = 'NONE'
    AND json_extract(NEW.canonical_json, '$.credentialAccess') = 'NONE'
    AND json_extract(NEW.canonical_json, '$.networkAccess') = 'DISABLED'
    AND substr(json_extract(NEW.canonical_json, '$.executablePath'), 1, 1) = '/'
    AND length(json_extract(NEW.canonical_json, '$.executableDigest')) = 71
    AND substr(json_extract(NEW.canonical_json, '$.executableDigest'), 1, 7) = 'sha256:'
    AND length(json_extract(NEW.canonical_json, '$.candidateDigest')) = 71
    AND substr(json_extract(NEW.canonical_json, '$.candidateDigest'), 1, 7) = 'sha256:'
    AND length(json_extract(NEW.canonical_json, '$.workspaceLeaseDigest')) = 71
    AND substr(json_extract(NEW.canonical_json, '$.workspaceLeaseDigest'), 1, 7) = 'sha256:'
    AND length(json_extract(NEW.canonical_json, '$.environmentDigest')) = 71
    AND substr(json_extract(NEW.canonical_json, '$.environmentDigest'), 1, 7) = 'sha256:'
    AND length(json_extract(NEW.canonical_json, '$.isolationProfileDigest')) = 71
    AND substr(json_extract(NEW.canonical_json, '$.isolationProfileDigest'), 1, 7) = 'sha256:'
    AND json_type(NEW.canonical_json, '$.argv') = 'array'
    AND json_type(NEW.canonical_json, '$.allowedEnvironmentVariables') = 'array'
    AND json_type(NEW.canonical_json, '$.acceptedExitCodes') = 'array'
    AND json_array_length(json_extract(NEW.canonical_json, '$.acceptedExitCodes')) > 0
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.canonical_json, '$.argv')
      WHERE type <> 'text'
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.canonical_json, '$.allowedEnvironmentVariables')
      WHERE type <> 'text'
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.canonical_json, '$.acceptedExitCodes')
      WHERE type <> 'integer' OR value < 0 OR value > 255
    )
    AND (
      SELECT COUNT(DISTINCT value)
      FROM json_each(NEW.canonical_json, '$.acceptedExitCodes')
    ) = json_array_length(json_extract(NEW.canonical_json, '$.acceptedExitCodes'))
    AND json_type(NEW.canonical_json, '$.inputRefs') = 'array'
    AND json_array_length(json_extract(NEW.canonical_json, '$.inputRefs')) = 1
    AND json_extract(NEW.canonical_json, '$.inputRefs[0]') =
      json_extract(NEW.canonical_json, '$.candidateGenerationId')
    AND json_extract(NEW.canonical_json, '$.outputLimitBytes') =
      json_extract(NEW.canonical_json, '$.totalOutputLimitBytes')
    AND json_extract(NEW.canonical_json, '$.timeoutMilliseconds') > 0
    AND json_extract(NEW.canonical_json, '$.terminationGraceMilliseconds') > 0
    AND json_extract(NEW.canonical_json, '$.stdoutLimitBytes') > 0
    AND json_extract(NEW.canonical_json, '$.stderrLimitBytes') > 0
    AND json_extract(NEW.canonical_json, '$.totalOutputLimitBytes') > 0
    AND json_extract(NEW.canonical_json, '$.payloadRetentionLimitBytes') > 0
    AND json_extract(NEW.canonical_json, '$.payloadRetentionLimitBytes') <=
      json_extract(NEW.canonical_json, '$.totalOutputLimitBytes')
    AND json_extract(NEW.canonical_json, '$.totalOutputLimitBytes') <=
      json_extract(NEW.canonical_json, '$.stdoutLimitBytes') +
      json_extract(NEW.canonical_json, '$.stderrLimitBytes')
    AND EXISTS (
      SELECT 1
      FROM candidate_generations AS generation
      WHERE generation.id = json_extract(NEW.canonical_json, '$.candidateGenerationId')
        AND generation.state = 'FROZEN'
        AND generation.frozen_digest = json_extract(NEW.canonical_json, '$.candidateDigest')
    )
    AND (SELECT COUNT(*) FROM json_each(NEW.canonical_json)) = 40
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.canonical_json)
      WHERE key NOT IN (
        'schemaVersion', 'id', 'version', 'kind', 'producerType', 'producerIdentity',
        'operation', 'cwdIdentity', 'inputRefs', 'environmentPolicy', 'timeoutMilliseconds',
        'outputLimitBytes', 'expectedObservationSchema', 'cleanupPolicy', 'runnerIdentity',
        'runnerVersion', 'executablePath', 'executableDigest', 'declaredToolVersion', 'argv',
        'candidateGenerationId', 'candidateDigest', 'workspaceLeaseId',
        'workspaceLeaseDigest', 'cwd', 'environmentInheritance',
        'allowedEnvironmentVariables', 'environmentDigest', 'isolationProfileId',
        'isolationProfileDigest', 'candidateAccess', 'authorityAccess', 'credentialAccess',
        'networkAccess', 'terminationGraceMilliseconds', 'stdoutLimitBytes',
        'stderrLimitBytes', 'totalOutputLimitBytes', 'payloadRetentionLimitBytes',
        'acceptedExitCodes'
      )
    )
    AND EXISTS (
      SELECT 1
      FROM audit_events
      WHERE aggregate_type = 'CHECK_SPECIFICATION'
        AND aggregate_id = NEW.id
        AND event_type = 'CHECK_SPECIFICATION_RECORDED'
        AND actor_type = 'RUNTIME'
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid local-command Check Specification authority');
END;

DROP TRIGGER verification_obligations_slice5_insert_guard;

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
  AND NEW.required_evidence_kind IN (
    'CANDIDATE_FREEZE', 'TEST_RESULT', 'LOCAL_COMMAND_TEST_RESULT'
  )
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
      AND (
        NEW.required_evidence_kind NOT IN ('TEST_RESULT', 'LOCAL_COMMAND_TEST_RESULT')
        OR (
          NEW.required_evidence_kind = 'TEST_RESULT'
          AND json_extract(specification.canonical_json, '$.schemaVersion') = 1
          AND json_extract(specification.canonical_json, '$.kind') = 'FAKE_VERIFICATION'
        )
        OR (
          NEW.required_evidence_kind = 'LOCAL_COMMAND_TEST_RESULT'
          AND NEW.strength = 'M2_LOCAL_COMMAND'
          AND json_extract(specification.canonical_json, '$.schemaVersion') = 2
          AND json_extract(specification.canonical_json, '$.kind') = 'LOCAL_COMMAND'
        )
      )
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
  ),
  0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid Verification Obligation authority');
END;

DROP TRIGGER evidence_records_slice5_insert_guard;

CREATE TRIGGER evidence_records_m1_insert_guard
BEFORE INSERT ON evidence_records
WHEN NEW.schema_version = 1
  AND COALESCE(
    NEW.policy_bundle_id IS NOT NULL
    AND length(NEW.id) BETWEEN 10 AND 137
    AND substr(NEW.id, 1, 9) = 'evidence_'
    AND substr(NEW.id, 10) NOT GLOB '*[^a-z0-9-]*'
    AND substr(NEW.id, 10, 1) GLOB '[a-z0-9]'
    AND substr(NEW.id, -1, 1) GLOB '[a-z0-9]'
    AND NEW.kind IN ('CANDIDATE_FREEZE', 'TEST_RESULT')
    AND NEW.producer_type IN ('CANDIDATE_MANAGER', 'VERIFICATION_RUNNER')
    AND length(trim(NEW.producer_identity)) > 0
    AND NEW.fact_snapshot_digest IS NULL
    AND NEW.workspace_lease_id IS NULL
    AND NEW.workspace_lease_digest IS NULL
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
            'schemaVersion', 'kind', 'firstSourceDigest', 'secondSourceDigest',
            'changeSetDigest'
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
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid or unaudited Evidence record');
END;

CREATE TRIGGER evidence_records_local_command_insert_guard
BEFORE INSERT ON evidence_records
WHEN NEW.schema_version = 2
  AND COALESCE(
    NEW.kind = 'LOCAL_COMMAND_TEST_RESULT'
    AND NEW.producer_type = 'VERIFICATION_RUNNER'
    AND length(trim(NEW.producer_identity)) > 0
    AND NEW.policy_bundle_id IS NOT NULL
    AND NEW.verification_obligation_id IS NOT NULL
    AND NEW.fact_snapshot_digest IS NULL
    AND length(trim(NEW.workspace_lease_id)) > 0
    AND length(NEW.workspace_lease_digest) = 71
    AND substr(NEW.workspace_lease_digest, 1, 7) = 'sha256:'
    AND NEW.result_status IN ('PASS', 'FAIL', 'RUNNER_ERROR', 'TIMEOUT')
    AND NEW.ended_at >= NEW.started_at
    AND NEW.recorded_at >= NEW.ended_at
    AND json_type(NEW.check_spec_json) = 'object'
    AND json_extract(NEW.check_spec_json, '$.schemaVersion') = 2
    AND json_extract(NEW.check_spec_json, '$.kind') = 'LOCAL_COMMAND'
    AND json_extract(NEW.check_spec_json, '$.producerType') = NEW.producer_type
    AND json_extract(NEW.check_spec_json, '$.producerIdentity') = NEW.producer_identity
    AND json_extract(NEW.check_spec_json, '$.candidateGenerationId') =
      NEW.candidate_generation_id
    AND json_extract(NEW.check_spec_json, '$.candidateDigest') = NEW.candidate_digest
    AND json_extract(NEW.check_spec_json, '$.workspaceLeaseId') = NEW.workspace_lease_id
    AND json_extract(NEW.check_spec_json, '$.workspaceLeaseDigest') =
      NEW.workspace_lease_digest
    AND json_type(NEW.environment_identity_json) = 'object'
    AND json_extract(NEW.environment_identity_json, '$.schemaVersion') = 1
    AND json_extract(NEW.environment_identity_json, '$.kind') =
      'LOCAL_COMMAND_ENVIRONMENT_V1'
    AND json_extract(NEW.environment_identity_json, '$.runnerIdentity') =
      json_extract(NEW.check_spec_json, '$.runnerIdentity')
    AND json_extract(NEW.environment_identity_json, '$.runnerVersion') =
      json_extract(NEW.check_spec_json, '$.runnerVersion')
    AND json_extract(NEW.environment_identity_json, '$.executableDigest') =
      json_extract(NEW.check_spec_json, '$.executableDigest')
    AND json_extract(NEW.environment_identity_json, '$.environmentDigest') =
      json_extract(NEW.check_spec_json, '$.environmentDigest')
    AND json_extract(NEW.environment_identity_json, '$.isolationProfileId') =
      json_extract(NEW.check_spec_json, '$.isolationProfileId')
    AND json_extract(NEW.environment_identity_json, '$.isolationProfileDigest') =
      json_extract(NEW.check_spec_json, '$.isolationProfileDigest')
    AND json_extract(NEW.environment_identity_json, '$.identity') =
      'local-command:' || json_extract(NEW.environment_identity_json, '$.digest')
    AND (SELECT COUNT(*) FROM json_each(NEW.environment_identity_json)) = 10
    AND json_type(NEW.observation_json) = 'object'
    AND json_extract(NEW.observation_json, '$.schemaVersion') = 1
    AND json_extract(NEW.observation_json, '$.kind') = 'LOCAL_COMMAND_OBSERVATION_V1'
    AND json_extract(NEW.observation_json, '$.terminationKind') IN (
      'EXITED', 'SIGNALED', 'TIMED_OUT', 'SPAWN_FAILED'
    )
    AND json_extract(NEW.observation_json, '$.diagnosticCode') IN (
      'NONE', 'PROCESS_SIGNALED', 'PROCESS_TIMED_OUT', 'PROCESS_SPAWN_FAILED',
      'OUTPUT_LIMIT_EXCEEDED'
    )
    AND json_type(NEW.payload_refs_json) = 'array'
    AND json_array_length(NEW.payload_refs_json) = 2
    AND json_extract(NEW.payload_refs_json, '$[0].stream') = 'STDOUT'
    AND json_extract(NEW.payload_refs_json, '$[1].stream') = 'STDERR'
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(NEW.payload_refs_json) AS reference
      WHERE json_type(reference.value) <> 'object'
        OR (SELECT COUNT(*) FROM json_each(reference.value)) <> 3
        OR EXISTS (
          SELECT 1 FROM json_each(reference.value)
          WHERE key NOT IN ('stream', 'digest', 'byteLength')
        )
        OR NOT EXISTS (
          SELECT 1
          FROM evidence_payloads AS payload
          WHERE payload.digest = json_extract(reference.value, '$.digest')
            AND payload.byte_length = json_extract(reference.value, '$.byteLength')
        )
    )
    AND json_extract(NEW.payload_refs_json, '$[0].byteLength') =
      json_extract(NEW.observation_json, '$.stdoutRetainedByteCount')
    AND json_extract(NEW.payload_refs_json, '$[1].byteLength') =
      json_extract(NEW.observation_json, '$.stderrRetainedByteCount')
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
        AND attempt.phase = 'EVIDENCE_BUILD'
        AND attempt.status = 'RUNNING'
        AND policy.bundle_digest = NEW.policy_bundle_digest
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
    ),
    0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid local-command Evidence record');
END;

CREATE TRIGGER evidence_records_closed_version_guard
BEFORE INSERT ON evidence_records
WHEN NEW.schema_version NOT IN (1, 2)
BEGIN
  SELECT RAISE(ABORT, 'unknown Evidence schema version');
END;
