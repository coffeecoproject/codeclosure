-- The contained M2.5.1 execution Profile keeps ADR 0044 freeze-v2 semantics.
-- Recreate only the affected guards so both exact retained and contained
-- Profile tuples are accepted without weakening any other relationship.

DROP TRIGGER check_specifications_insert_guard;

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
        NEW.version = 'm1.2'
        AND json_extract(NEW.canonical_json, '$.environmentPolicy') =
          'M1_LOGICAL_DETERMINISTIC'
        AND json_extract(NEW.canonical_json, '$.timeoutMilliseconds') = 1000
        AND json_extract(NEW.canonical_json, '$.outputLimitBytes') = 65536
        AND json_extract(NEW.canonical_json, '$.cleanupPolicy') =
          'M1_LOGICAL_NO_EXTERNAL_RESOURCES'
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
            AND json_extract(NEW.canonical_json, '$.operation') =
              'm1.logical.fake-verification'
            AND json_extract(NEW.canonical_json, '$.expectedObservationSchema') =
              'codeclosure.fake-verification-observation.v1'
          )
        )
      )
      OR
      (
        NEW.version = 'm2.5.1.1'
        AND json_extract(NEW.canonical_json, '$.kind') = 'CANDIDATE_FREEZE'
        AND json_extract(NEW.canonical_json, '$.producerType') = 'CANDIDATE_MANAGER'
        AND json_extract(NEW.canonical_json, '$.producerIdentity') =
          'candidate-manager:m2.5.1'
        AND json_extract(NEW.canonical_json, '$.operation') =
          'm2.5.1.candidate.freeze-contained'
        AND json_extract(NEW.canonical_json, '$.environmentPolicy') =
          'M2_5_1_CONTROLLED_COPY_STABLE_CHANGE_SET_V2'
        AND json_extract(NEW.canonical_json, '$.timeoutMilliseconds') = 10000
        AND json_extract(NEW.canonical_json, '$.outputLimitBytes') = 4194304
        AND json_extract(NEW.canonical_json, '$.expectedObservationSchema') =
          'codeclosure.candidate-freeze-observation.v2'
        AND json_extract(NEW.canonical_json, '$.cleanupPolicy') =
          'M2_5_1_CANDIDATE_WORKSPACE_OWNED'
        AND EXISTS (
          SELECT 1
          FROM candidate_generations AS generation
          JOIN workflow_execution_profile_bindings AS binding
            ON binding.workflow_id = generation.workflow_id
          JOIN execution_profiles AS profile
            ON profile.id = binding.profile_id AND profile.profile_digest = binding.profile_digest
          JOIN external_execution_profile_extensions AS extension
            ON extension.profile_id = profile.id
          WHERE generation.id = json_extract(NEW.canonical_json, '$.inputRefs[0]')
            AND (
              (
                profile.id = 'profile_m2-5-1-real-codex'
                AND profile.profile_version = 'codeclosure-m2-5-1-real-codex-profile-v1'
              )
              OR (
                profile.id = 'profile_m2-5-1-contained-real-codex'
                AND profile.profile_version =
                  'codeclosure-m2-5-1-contained-real-codex-profile-v2'
              )
            )
            AND json_extract(profile.canonical_content_json, '$.candidateSource') =
              'controlled-copy-candidate'
            AND json_extract(profile.canonical_content_json, '$.candidateSourceVersion') =
              'candidate-freeze-v2'
            AND json_extract(profile.canonical_content_json, '$.verificationRunner') =
              'protected-local-verification'
            AND json_extract(profile.canonical_content_json, '$.verificationRunnerVersion') = 'v1'
            AND extension.logical_schema_version = 2
            AND json_extract(extension.external_execution_json, '$.schemaVersion') = 3
        )
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

DROP TRIGGER evidence_records_candidate_freeze_v2_insert_guard;

CREATE TRIGGER evidence_records_candidate_freeze_v2_insert_guard
BEFORE INSERT ON evidence_records
WHEN NEW.schema_version = 2 AND NEW.kind = 'CANDIDATE_FREEZE'
  AND COALESCE(
    NEW.producer_type = 'CANDIDATE_MANAGER'
    AND NEW.producer_identity = 'candidate-manager:m2.5.1'
    AND NEW.policy_bundle_id IS NOT NULL
    AND NEW.verification_obligation_id IS NULL
    AND NEW.fact_snapshot_digest IS NULL
    AND NEW.workspace_lease_id IS NULL
    AND NEW.workspace_lease_digest IS NULL
    AND NEW.environment_identity_json IS NULL
    AND NEW.acceptance_critical_verification_plan_id IS NULL
    AND NEW.acceptance_critical_verification_plan_digest IS NULL
    AND NEW.protected_asset_manifest_digest IS NULL
    AND NEW.protected_asset_read_lease_digest IS NULL
    AND NEW.result_status = 'OBSERVED'
    AND NEW.ended_at >= NEW.started_at
    AND NEW.recorded_at >= NEW.ended_at
    AND json_type(NEW.check_spec_json) = 'object'
    AND json_extract(NEW.check_spec_json, '$.schemaVersion') = 1
    AND json_extract(NEW.check_spec_json, '$.version') = 'm2.5.1.1'
    AND json_extract(NEW.check_spec_json, '$.kind') = 'CANDIDATE_FREEZE'
    AND json_extract(NEW.check_spec_json, '$.producerType') = 'CANDIDATE_MANAGER'
    AND json_extract(NEW.check_spec_json, '$.producerIdentity') =
      'candidate-manager:m2.5.1'
    AND json_extract(NEW.check_spec_json, '$.operation') =
      'm2.5.1.candidate.freeze-contained'
    AND json_extract(NEW.check_spec_json, '$.environmentPolicy') =
      'M2_5_1_CONTROLLED_COPY_STABLE_CHANGE_SET_V2'
    AND json_extract(NEW.check_spec_json, '$.expectedObservationSchema') =
      'codeclosure.candidate-freeze-observation.v2'
    AND json_extract(NEW.check_spec_json, '$.cleanupPolicy') =
      'M2_5_1_CANDIDATE_WORKSPACE_OWNED'
    AND json_array_length(json_extract(NEW.check_spec_json, '$.inputRefs')) = 1
    AND json_extract(NEW.check_spec_json, '$.inputRefs[0]') = NEW.candidate_generation_id
    AND json_type(NEW.observation_json) = 'object'
    AND json_extract(NEW.observation_json, '$.schemaVersion') = 2
    AND json_extract(NEW.observation_json, '$.kind') = 'CANDIDATE_FREEZE'
    AND json_extract(NEW.observation_json, '$.changeSetProfile') = 'candidate-change-set-v2'
    AND json_extract(NEW.observation_json, '$.firstSourceDigest') =
      json_extract(NEW.observation_json, '$.secondSourceDigest')
    AND json_extract(NEW.observation_json, '$.secondSourceDigest') = NEW.candidate_digest
    AND json_type(NEW.observation_json, '$.changes') = 'array'
    AND json_array_length(json_extract(NEW.observation_json, '$.changes')) BETWEEN 1 AND 8192
    AND (SELECT COUNT(*) FROM json_each(NEW.observation_json)) = 9
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.observation_json)
      WHERE key NOT IN (
        'schemaVersion', 'kind', 'allowedPathPolicyDigest', 'baseSourceDigest',
        'changeSetDigest', 'changeSetProfile', 'changes', 'firstSourceDigest',
        'secondSourceDigest'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(json_extract(NEW.observation_json, '$.changes')) AS change
      WHERE json_type(change.value) <> 'object'
        OR (SELECT COUNT(*) FROM json_each(change.value)) <> 4
        OR json_type(change.value, '$.kind') IS NOT 'text'
        OR json_extract(change.value, '$.kind') NOT IN ('ADDED', 'DELETED', 'MODIFIED')
        OR json_type(change.value, '$.path') IS NOT 'text'
        OR length(trim(json_extract(change.value, '$.path'))) = 0
        OR (
          json_extract(change.value, '$.kind') = 'ADDED'
          AND (
            json_type(change.value, '$.before') IS NOT 'null'
            OR json_type(change.value, '$.after') IS NOT 'object'
          )
        )
        OR (
          json_extract(change.value, '$.kind') = 'DELETED'
          AND (
            json_type(change.value, '$.before') IS NOT 'object'
            OR json_type(change.value, '$.after') IS NOT 'null'
          )
        )
        OR (
          json_extract(change.value, '$.kind') = 'MODIFIED'
          AND (
            json_type(change.value, '$.before') IS NOT 'object'
            OR json_type(change.value, '$.after') IS NOT 'object'
          )
        )
        OR EXISTS (
          SELECT 1 FROM json_each(change.value)
          WHERE key NOT IN ('after', 'before', 'kind', 'path')
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(change.value) AS identity
          WHERE identity.key IN ('after', 'before')
            AND identity.type = 'object'
            AND (
              (SELECT COUNT(*) FROM json_each(identity.value)) <> 3
              OR json_type(identity.value, '$.byteLength') IS NOT 'integer'
              OR json_extract(identity.value, '$.byteLength') < 0
              OR json_extract(identity.value, '$.byteLength') > 9007199254740991
              OR json_type(identity.value, '$.contentDigest') IS NOT 'text'
              OR length(json_extract(identity.value, '$.contentDigest')) <> 71
              OR substr(json_extract(identity.value, '$.contentDigest'), 1, 7) <> 'sha256:'
              OR substr(json_extract(identity.value, '$.contentDigest'), 8)
                GLOB '*[^0-9a-f]*'
              OR json_extract(identity.value, '$.mode') NOT IN ('EXECUTABLE', 'REGULAR')
              OR EXISTS (
                SELECT 1 FROM json_each(identity.value)
                WHERE key NOT IN ('byteLength', 'contentDigest', 'mode')
              )
            )
        )
    )
    AND json_type(NEW.payload_refs_json) = 'array'
    AND json_array_length(NEW.payload_refs_json) = 1
    AND json_extract(NEW.payload_refs_json, '$[0]') =
      json_extract(NEW.observation_json, '$.changeSetDigest')
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
      JOIN workflow_execution_profile_bindings AS binding
        ON binding.workflow_id = workflow.id
      JOIN execution_profiles AS profile
        ON profile.id = binding.profile_id AND profile.profile_digest = binding.profile_digest
      JOIN external_execution_profile_extensions AS extension
        ON extension.profile_id = profile.id
      WHERE generation.id = NEW.candidate_generation_id
        AND generation.state = 'FROZEN'
        AND generation.base_digest = json_extract(NEW.observation_json, '$.baseSourceDigest')
        AND generation.frozen_digest = NEW.candidate_digest
        AND candidate.goal_id = NEW.goal_id
        AND workflow.id = NEW.workflow_id
        AND workflow.goal_revision = NEW.goal_revision
        AND attempt.workflow_id = workflow.id
        AND attempt.phase = 'SOURCE_FREEZE'
        AND attempt.status = 'RUNNING'
        AND policy.bundle_digest = NEW.policy_bundle_digest
        AND (
          (
            profile.id = 'profile_m2-5-1-real-codex'
            AND profile.profile_version = 'codeclosure-m2-5-1-real-codex-profile-v1'
          )
          OR (
            profile.id = 'profile_m2-5-1-contained-real-codex'
            AND profile.profile_version =
              'codeclosure-m2-5-1-contained-real-codex-profile-v2'
          )
        )
        AND json_extract(profile.canonical_content_json, '$.candidateSource') =
          'controlled-copy-candidate'
        AND json_extract(profile.canonical_content_json, '$.candidateSourceVersion') =
          'candidate-freeze-v2'
        AND json_extract(profile.canonical_content_json, '$.verificationRunner') =
          'protected-local-verification'
        AND json_extract(profile.canonical_content_json, '$.verificationRunnerVersion') = 'v1'
        AND extension.logical_schema_version = 2
        AND json_extract(extension.external_execution_json, '$.schemaVersion') = 3
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
  SELECT RAISE(ABORT, 'invalid Candidate freeze-v2 Evidence record');
END;
