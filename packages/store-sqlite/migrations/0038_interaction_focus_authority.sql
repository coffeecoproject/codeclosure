DROP TRIGGER interaction_sessions_update_guard;

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
      )) OR
      ((NEW.current_focus_id IS NOT OLD.current_focus_id OR
        NEW.current_focus_digest IS NOT OLD.current_focus_digest) AND
        NOT EXISTS (
          SELECT 1
            FROM interaction_focus_bindings AS focus
           WHERE focus.id = NEW.current_focus_id
             AND focus.session_id = OLD.id
             AND focus.focus_digest = NEW.current_focus_digest
             AND focus.based_on_session_version = OLD.version
             AND focus.created_at = NEW.updated_at
        ))
    THEN RAISE(ABORT, 'illegal Interaction Session transition')
  END;
END;
