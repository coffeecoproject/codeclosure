-- M2.5.1 keeps the outer Execution Profile at logical schema v2 and adds only
-- the nested phase-discriminated external-execution definition v3. Historical
-- nested v1/v2 JSON retains its exact trigger contract.

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
       OR (
         json_extract(NEW.external_execution_json, '$.schemaVersion') = 3
         AND json_extract(NEW.external_execution_json, '$.workerDispatchPolicy') =
           'ALL_SELECTED_ATTEMPTS'
         AND json_extract(NEW.external_execution_json, '$.workerPhases') =
           json_array('DISCOVERY', 'IMPLEMENT', 'PLAN')
         AND json_type(NEW.external_execution_json, '$.phaseDispatch') = 'array'
         AND json_array_length(
           json_extract(NEW.external_execution_json, '$.phaseDispatch')
         ) = 3
         AND json_extract(NEW.external_execution_json, '$.phaseDispatch[0].phase') =
           'DISCOVERY'
         AND json_extract(NEW.external_execution_json, '$.phaseDispatch[1].phase') =
           'IMPLEMENT'
         AND json_extract(NEW.external_execution_json, '$.phaseDispatch[2].phase') =
           'PLAN'
         AND json_extract(
           NEW.external_execution_json, '$.phaseDispatch[0].responseSchemaPolicy'
         ) = 'PROPOSALS_V1'
         AND json_extract(
           NEW.external_execution_json, '$.phaseDispatch[1].responseSchemaPolicy'
         ) = 'COMPLETION_REQUEST_V1'
         AND json_extract(
           NEW.external_execution_json, '$.phaseDispatch[2].responseSchemaPolicy'
         ) = 'PROPOSALS_V1'
         AND json_type(NEW.external_execution_json, '$.configurationProfileDigest') IS NULL
         AND json_type(NEW.external_execution_json, '$.executionConfigDigest') IS NULL
         AND json_type(NEW.external_execution_json, '$.instructionSourceManifestDigest') IS NULL
         AND json_type(NEW.external_execution_json, '$.permissionProfileId') IS NULL
         AND json_type(NEW.external_execution_json, '$.permissionProfileDigest') IS NULL
         AND json_type(NEW.external_execution_json, '$.responseSchemaPolicy') IS NULL
         AND json_type(NEW.external_execution_json, '$.disabledIntegrationsDigest') IS NULL
         AND json_type(NEW.external_execution_json, '$.continuityPolicy') IS NULL
         AND json_type(NEW.external_execution_json, '$.compactionPolicy') IS NULL
         AND json_type(NEW.external_execution_json, '$.fallbackPolicy') IS NULL
       )
     )
)
BEGIN
  SELECT RAISE(ABORT, 'External Execution Profile extension has no compatible base authority');
END;
