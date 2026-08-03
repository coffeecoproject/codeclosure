DROP TRIGGER intake_runs_versioned_update_guard;

CREATE TRIGGER intake_runs_versioned_update_guard
BEFORE UPDATE ON intake_runs
WHEN
  NEW.id <> OLD.id OR
  NEW.schema_version <> OLD.schema_version OR
  NEW.principal_ref <> OLD.principal_ref OR
  NEW.created_at <> OLD.created_at OR
  NEW.version <> OLD.version + 1 OR
  NEW.updated_at < OLD.updated_at OR
  NEW.active_raw_request_id <> OLD.active_raw_request_id OR
  NEW.active_raw_request_revision < OLD.active_raw_request_revision OR
  NEW.active_raw_request_revision > OLD.active_raw_request_revision + 1 OR
  (
    (NEW.project_path IS NOT OLD.project_path OR
      NEW.project_identity_digest IS NOT OLD.project_identity_digest) AND
    NOT (
      OLD.status = 'NEEDS_CLARIFICATION' AND
      NEW.status = 'ANALYZING' AND
      NEW.project_path IS NOT NULL AND
      NEW.project_identity_digest IS NOT NULL AND
      NEW.active_raw_request_revision = OLD.active_raw_request_revision + 1 AND
      EXISTS (
        SELECT 1
          FROM raw_request_revisions AS revision
          JOIN clarification_answer_bindings AS answer_binding
            ON answer_binding.raw_request_id = revision.raw_request_id
           AND answer_binding.raw_request_revision = revision.revision
           AND answer_binding.raw_request_digest = revision.raw_request_digest
          JOIN clarification_questions AS question
            ON question.id = answer_binding.question_id
         WHERE revision.raw_request_id = NEW.active_raw_request_id
           AND revision.revision = NEW.active_raw_request_revision
           AND revision.raw_request_digest = NEW.active_raw_request_digest
           AND revision.intake_run_id = NEW.id
           AND revision.declared_project_path IS NEW.project_path
           AND revision.declared_project_identity_digest IS NEW.project_identity_digest
           AND answer_binding.intake_run_id = NEW.id
           AND answer_binding.question_id = OLD.active_question_id
           AND json_extract(question.record_json, '$.answerSchema.kind') = 'PROJECT_PATH'
           AND json_type(question.record_json, '$.affectedFields') = 'array'
           AND json_array_length(question.record_json, '$.affectedFields') = 1
           AND json_extract(question.record_json, '$.affectedFields[0]') = 'PROJECT_IDENTITY'
      )
    )
  ) OR
  (OLD.active_projection_id IS NOT NULL AND
    (NEW.active_projection_id IS NOT OLD.active_projection_id OR
      NEW.active_projection_revision < OLD.active_projection_revision)) OR
  OLD.status IN ('MATERIALIZED', 'NO_EXECUTION', 'FAILED')
BEGIN
  SELECT RAISE(ABORT, 'invalid versioned Intake Run update');
END;
