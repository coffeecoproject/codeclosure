-- Slice 7 protected verification authority. Existing Context v2/v3, local
-- command v2, Evidence v1/v2, and Acceptance Manifest v1 meanings are kept.

-- The outer Execution Profile remains logical schema v2. Slice 7 extends only
-- its nested external-execution definition so trusted composition can bind a
-- repair-only dispatch policy. Preserve the Slice 6 nested v1 meaning and
-- admit the closed nested v2 enum without relabelling retained profiles.
DROP TRIGGER external_execution_profile_extensions_insert_guard;
CREATE TRIGGER external_execution_profile_extensions_insert_guard
BEFORE INSERT ON external_execution_profile_extensions
WHEN NOT EXISTS (
  SELECT 1 FROM execution_profiles AS profile
   WHERE profile.id = NEW.profile_id
     AND profile.schema_version = 1
     AND json_extract(NEW.external_execution_json, '$.capabilityRecordDigest') =
       NEW.capability_record_digest
     AND (
       (
         json_extract(NEW.external_execution_json, '$.schemaVersion') = 1
         AND json_type(NEW.external_execution_json, '$.workerDispatchPolicy') IS NULL
       )
       OR (
         json_extract(NEW.external_execution_json, '$.schemaVersion') = 2
         AND json_extract(NEW.external_execution_json, '$.workerDispatchPolicy') IN (
           'ALL_SELECTED_ATTEMPTS', 'ACCEPTANCE_REPAIR_ONLY'
         )
       )
     )
)
BEGIN
  SELECT RAISE(ABORT, 'External Execution Profile extension has no compatible base authority');
END;

CREATE TABLE acceptance_critical_verification_plans (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  goal_revision INTEGER NOT NULL,
  workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version_at_lock INTEGER NOT NULL,
  policy_bundle_id TEXT NOT NULL REFERENCES policy_bundles(id) ON DELETE RESTRICT,
  policy_bundle_digest TEXT NOT NULL,
  execution_profile_id TEXT NOT NULL REFERENCES execution_profiles(id) ON DELETE RESTRICT,
  execution_profile_digest TEXT NOT NULL,
  protected_asset_manifest_digest TEXT NOT NULL,
  canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json) AND json_type(canonical_json) = 'object'),
  plan_digest TEXT NOT NULL UNIQUE,
  audit_sequence INTEGER NOT NULL UNIQUE REFERENCES audit_events(sequence) ON DELETE RESTRICT,
  UNIQUE (id, plan_digest),
  CHECK (length(plan_digest) = 71 AND substr(plan_digest, 1, 7) = 'sha256:'),
  CHECK (
    length(protected_asset_manifest_digest) = 71 AND
    substr(protected_asset_manifest_digest, 1, 7) = 'sha256:'
  )
) STRICT;

CREATE TRIGGER acceptance_critical_verification_plans_insert_guard
BEFORE INSERT ON acceptance_critical_verification_plans
WHEN COALESCE(
  json_extract(NEW.canonical_json, '$.schemaVersion') = 1
  AND json_extract(NEW.canonical_json, '$.id') = NEW.id
  AND json_extract(NEW.canonical_json, '$.goalId') = NEW.goal_id
  AND json_extract(NEW.canonical_json, '$.goalRevision') = NEW.goal_revision
  AND json_extract(NEW.canonical_json, '$.workflowId') = NEW.workflow_id
  AND json_extract(NEW.canonical_json, '$.workflowVersionAtLock') = NEW.workflow_version_at_lock
  AND json_extract(NEW.canonical_json, '$.policyBundleId') = NEW.policy_bundle_id
  AND json_extract(NEW.canonical_json, '$.policyBundleDigest') = NEW.policy_bundle_digest
  AND json_extract(NEW.canonical_json, '$.executionProfileId') = NEW.execution_profile_id
  AND json_extract(NEW.canonical_json, '$.executionProfileDigest') = NEW.execution_profile_digest
  AND json_extract(NEW.canonical_json, '$.protectedAssetManifestDigest') =
      NEW.protected_asset_manifest_digest
  AND json_extract(NEW.canonical_json, '$.planDigest') = NEW.plan_digest
  AND json_extract(NEW.canonical_json, '$.authoritySource') = 'TRUSTED_RUNTIME_COMPOSITION'
  AND json_extract(NEW.canonical_json, '$.derivationRule') =
      'BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1'
  AND json_extract(NEW.canonical_json, '$.protectedAssetReadLeasePolicy') =
      'EXACT_READ_ONLY_SINGLE_INVOCATION'
  AND json_array_length(json_extract(NEW.canonical_json, '$.acceptanceCriticalCriterionIds')) > 0
  AND json_array_length(json_extract(NEW.canonical_json, '$.acceptanceRuleIds')) > 0
  AND json_array_length(json_extract(NEW.canonical_json, '$.protectedAssets')) > 0
  AND EXISTS (
    SELECT 1
    FROM workflows AS workflow
    JOIN goals AS goal ON goal.id = workflow.goal_id
    JOIN policy_bundles AS policy ON policy.id = NEW.policy_bundle_id
    JOIN execution_profiles AS profile ON profile.id = NEW.execution_profile_id
    WHERE workflow.id = NEW.workflow_id
      AND workflow.goal_id = NEW.goal_id
      AND workflow.goal_revision = NEW.goal_revision
      AND workflow.version = NEW.workflow_version_at_lock
      AND goal.revision = NEW.goal_revision
      AND policy.bundle_digest = NEW.policy_bundle_digest
      AND profile.profile_digest = NEW.execution_profile_digest
  )
  AND EXISTS (
    SELECT 1 FROM audit_events AS audit
    WHERE audit.sequence = NEW.audit_sequence
      AND audit.aggregate_type = 'ACCEPTANCE_CRITICAL_VERIFICATION_PLAN'
      AND audit.aggregate_id = NEW.id
      AND audit.event_type = 'ACCEPTANCE_CRITICAL_VERIFICATION_PLAN_CREATED'
      AND audit.actor_type = 'RUNTIME'
      AND audit.payload_digest = NEW.plan_digest
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid protected Verification Plan authority');
END;

CREATE TRIGGER acceptance_critical_verification_plans_no_update
BEFORE UPDATE ON acceptance_critical_verification_plans
BEGIN
  SELECT RAISE(ABORT, 'protected Verification Plans are immutable');
END;

CREATE TRIGGER acceptance_critical_verification_plans_no_delete
BEFORE DELETE ON acceptance_critical_verification_plans
BEGIN
  SELECT RAISE(ABORT, 'protected Verification Plans cannot be deleted');
END;

CREATE TABLE protected_context_manifest_extensions (
  context_manifest_id TEXT PRIMARY KEY REFERENCES context_manifests(id) ON DELETE RESTRICT,
  logical_schema_version INTEGER NOT NULL CHECK (logical_schema_version = 4),
  verification_plan_id TEXT NOT NULL,
  verification_plan_digest TEXT NOT NULL,
  FOREIGN KEY (verification_plan_id, verification_plan_digest)
    REFERENCES acceptance_critical_verification_plans(id, plan_digest) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER protected_context_manifest_extensions_insert_guard
BEFORE INSERT ON protected_context_manifest_extensions
WHEN NOT EXISTS (
  SELECT 1
  FROM context_manifests AS context
  JOIN acceptance_critical_verification_plans AS plan
    ON plan.id = NEW.verification_plan_id
   AND plan.plan_digest = NEW.verification_plan_digest
  WHERE context.id = NEW.context_manifest_id
    AND context.schema_version = 2
    AND context.workflow_id = plan.workflow_id
    AND context.goal_id = plan.goal_id
    AND context.goal_revision = plan.goal_revision
    AND context.execution_profile_id = plan.execution_profile_id
    AND context.execution_profile_digest = plan.execution_profile_digest
    AND context.policy_bundle_id = plan.policy_bundle_id
    AND context.policy_bundle_digest = plan.policy_bundle_digest
)
BEGIN
  SELECT RAISE(ABORT, 'protected Context Manifest has no exact Plan authority');
END;

CREATE TRIGGER protected_context_manifest_extensions_no_update
BEFORE UPDATE ON protected_context_manifest_extensions
BEGIN
  SELECT RAISE(ABORT, 'protected Context Manifest extensions are immutable');
END;

CREATE TRIGGER protected_context_manifest_extensions_no_delete
BEFORE DELETE ON protected_context_manifest_extensions
BEGIN
  SELECT RAISE(ABORT, 'protected Context Manifest extensions cannot be deleted');
END;

ALTER TABLE evidence_records ADD COLUMN acceptance_critical_verification_plan_id TEXT;
ALTER TABLE evidence_records ADD COLUMN acceptance_critical_verification_plan_digest TEXT;
ALTER TABLE evidence_records ADD COLUMN protected_asset_manifest_digest TEXT;
ALTER TABLE evidence_records ADD COLUMN protected_asset_read_lease_digest TEXT;

DROP TRIGGER check_specifications_closed_version_guard;
CREATE TRIGGER check_specifications_closed_version_guard
BEFORE INSERT ON check_specifications
WHEN COALESCE(
  json_valid(NEW.canonical_json)
  AND json_type(NEW.canonical_json) = 'object'
  AND json_extract(NEW.canonical_json, '$.schemaVersion') IN (1, 2, 3),
  0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'unknown Check Specification schema version');
END;

CREATE TRIGGER check_specifications_protected_local_command_insert_guard
BEFORE INSERT ON check_specifications
WHEN json_extract(NEW.canonical_json, '$.schemaVersion') = 3
  AND COALESCE(
    json_extract(NEW.canonical_json, '$.id') = NEW.id
    AND json_extract(NEW.canonical_json, '$.version') = NEW.version
    AND json_extract(NEW.canonical_json, '$.kind') = 'LOCAL_COMMAND'
    AND json_extract(NEW.canonical_json, '$.producerType') = 'VERIFICATION_RUNNER'
    AND json_extract(NEW.canonical_json, '$.candidateAccess') = 'READ_ONLY'
    AND json_extract(NEW.canonical_json, '$.authorityAccess') = 'NONE'
    AND json_extract(NEW.canonical_json, '$.credentialAccess') = 'NONE'
    AND json_extract(NEW.canonical_json, '$.networkAccess') = 'DISABLED'
    AND json_extract(NEW.canonical_json, '$.inputRefs[0]') =
        json_extract(NEW.canonical_json, '$.candidateGenerationId')
    AND EXISTS (
      SELECT 1
      FROM candidate_generations AS generation
      JOIN acceptance_critical_verification_plans AS plan
        ON plan.id = json_extract(
          NEW.canonical_json, '$.acceptanceCriticalVerificationPlanId'
        )
       AND plan.plan_digest = json_extract(
          NEW.canonical_json, '$.acceptanceCriticalVerificationPlanDigest'
       )
      WHERE generation.id = json_extract(NEW.canonical_json, '$.candidateGenerationId')
        AND generation.workflow_id = plan.workflow_id
        AND generation.state = 'FROZEN'
        AND generation.frozen_digest = json_extract(NEW.canonical_json, '$.candidateDigest')
        AND plan.protected_asset_manifest_digest = json_extract(
          NEW.canonical_json, '$.protectedAssetManifestDigest'
        )
        AND json_extract(plan.canonical_json, '$.semanticCheckTemplate.isolationProfileId') =
          json_extract(NEW.canonical_json, '$.isolationProfileId')
        AND json_extract(plan.canonical_json, '$.semanticCheckTemplate.isolationProfileDigest') =
          json_extract(NEW.canonical_json, '$.isolationProfileDigest')
    )
    AND EXISTS (
      SELECT 1 FROM audit_events
      WHERE aggregate_type = 'CHECK_SPECIFICATION'
        AND aggregate_id = NEW.id
        AND event_type = 'CHECK_SPECIFICATION_RECORDED'
        AND actor_type = 'RUNTIME'
    ), 0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid protected local-command Check authority');
END;

-- Preserve the Slice 5 obligation contract while admitting the protected
-- schema-version-3 LOCAL_COMMAND family selected by the immutable Plan.
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
          AND json_extract(specification.canonical_json, '$.schemaVersion') IN (2, 3)
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

DROP TRIGGER evidence_records_closed_version_guard;
CREATE TRIGGER evidence_records_closed_version_guard
BEFORE INSERT ON evidence_records
WHEN NEW.schema_version NOT IN (1, 2, 3)
BEGIN
  SELECT RAISE(ABORT, 'unknown Evidence schema version');
END;

CREATE TRIGGER evidence_records_protected_local_command_insert_guard
BEFORE INSERT ON evidence_records
WHEN NEW.schema_version = 3
  AND COALESCE(
    NEW.kind = 'LOCAL_COMMAND_TEST_RESULT'
    AND NEW.producer_type = 'VERIFICATION_RUNNER'
    AND NEW.verification_obligation_id IS NOT NULL
    AND NEW.workspace_lease_id IS NOT NULL
    AND NEW.workspace_lease_digest IS NOT NULL
    AND NEW.acceptance_critical_verification_plan_id IS NOT NULL
    AND NEW.acceptance_critical_verification_plan_digest IS NOT NULL
    AND NEW.protected_asset_manifest_digest IS NOT NULL
    AND NEW.protected_asset_read_lease_digest IS NOT NULL
    AND json_extract(NEW.check_spec_json, '$.schemaVersion') = 3
    AND json_extract(NEW.check_spec_json, '$.acceptanceCriticalVerificationPlanId') =
        NEW.acceptance_critical_verification_plan_id
    AND json_extract(NEW.check_spec_json, '$.acceptanceCriticalVerificationPlanDigest') =
        NEW.acceptance_critical_verification_plan_digest
    AND json_extract(NEW.check_spec_json, '$.protectedAssetManifestDigest') =
        NEW.protected_asset_manifest_digest
    AND json_extract(NEW.check_spec_json, '$.protectedAssetReadLeaseDigest') =
        NEW.protected_asset_read_lease_digest
    AND EXISTS (
      SELECT 1
      FROM check_specifications AS specification
      JOIN acceptance_critical_verification_plans AS plan
        ON plan.id = NEW.acceptance_critical_verification_plan_id
       AND plan.plan_digest = NEW.acceptance_critical_verification_plan_digest
      JOIN verification_obligations AS obligation
        ON obligation.id = NEW.verification_obligation_id
      JOIN attempts AS attempt ON attempt.id = NEW.attempt_id
      WHERE specification.id = json_extract(NEW.check_spec_json, '$.id')
        AND specification.version = json_extract(NEW.check_spec_json, '$.version')
        AND json(specification.canonical_json) = json(NEW.check_spec_json)
        AND plan.workflow_id = NEW.workflow_id
        AND plan.goal_id = NEW.goal_id
        AND plan.goal_revision = NEW.goal_revision
        AND plan.protected_asset_manifest_digest = NEW.protected_asset_manifest_digest
        AND obligation.candidate_generation_id = NEW.candidate_generation_id
        AND obligation.check_spec_ref = specification.id || '@' || specification.version
        AND attempt.workflow_id = NEW.workflow_id
        AND attempt.phase = 'EVIDENCE_BUILD'
        AND attempt.status = 'RUNNING'
    )
    AND EXISTS (
      SELECT 1 FROM audit_events
      WHERE aggregate_type = 'EVIDENCE'
        AND aggregate_id = NEW.id
        AND event_type = 'EVIDENCE_RECORDED_ELIGIBLE'
        AND actor_type = 'RUNTIME'
        AND payload_digest = NEW.record_digest
    ), 0
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid protected local-command Evidence authority');
END;

ALTER TABLE acceptance_input_manifests
  ADD COLUMN acceptance_critical_verification_plan_id TEXT;
ALTER TABLE acceptance_input_manifests
  ADD COLUMN acceptance_critical_verification_plan_digest TEXT;

CREATE TRIGGER acceptance_input_manifests_protected_plan_guard
BEFORE INSERT ON acceptance_input_manifests
WHEN COALESCE(
  (
    NEW.schema_version = 1
    AND NEW.acceptance_critical_verification_plan_id IS NULL
    AND NEW.acceptance_critical_verification_plan_digest IS NULL
  )
  OR
  (
    -- The retained table keeps its physical schema-version-1 row contract;
    -- the exact Plan pair is the closed logical-version-2 extension marker.
    NEW.schema_version = 1
    AND EXISTS (
      SELECT 1
      FROM acceptance_critical_verification_plans AS plan
      JOIN check_specifications AS specification
        ON specification.id = json_extract(
          (SELECT evidence.check_spec_json
             FROM evidence_records AS evidence
             JOIN evidence_sets AS evidence_set
               ON evidence_set.digest = NEW.evidence_set_digest
             JOIN json_each(evidence_set.evidence_refs_json) AS reference
               ON json_extract(reference.value, '$.evidenceId') = evidence.id
            WHERE evidence.schema_version = 3
            LIMIT 1), '$.id'
        )
      WHERE plan.id = NEW.acceptance_critical_verification_plan_id
        AND plan.plan_digest = NEW.acceptance_critical_verification_plan_digest
        AND plan.workflow_id = NEW.workflow_id
        AND plan.goal_id = NEW.goal_id
        AND plan.goal_revision = NEW.goal_revision
    )
  ), 0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'Acceptance Input Manifest has invalid protected Plan authority');
END;
