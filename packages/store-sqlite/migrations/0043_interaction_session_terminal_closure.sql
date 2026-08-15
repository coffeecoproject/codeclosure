CREATE TABLE interaction_session_terminal_closure_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO interaction_session_terminal_closure_migration_guard(valid)
SELECT CASE WHEN EXISTS (
  SELECT 1
    FROM interaction_sessions AS session
   WHERE session.state IN ('CLOSED', 'INTERRUPTED')
     AND (
       EXISTS (
         SELECT 1
           FROM interaction_operations AS operation
          WHERE operation.session_id = session.id
            AND operation.state = 'RESERVED'
       ) OR
       EXISTS (
         SELECT 1
           FROM interaction_pending_actions AS action
           LEFT JOIN interaction_pending_action_resolutions AS resolution
             ON resolution.pending_action_id = action.id
          WHERE action.session_id = session.id
            AND resolution.id IS NULL
       ) OR
       EXISTS (
         SELECT 1
           FROM interaction_action_reservations AS reservation
           LEFT JOIN interaction_action_outcomes AS outcome
             ON outcome.reservation_id = reservation.id
          WHERE reservation.session_id = session.id
            AND outcome.id IS NULL
       )
     )
) THEN 0 ELSE 1 END;

DROP TABLE interaction_session_terminal_closure_migration_guard;

CREATE TRIGGER interaction_sessions_terminal_work_guard
BEFORE UPDATE ON interaction_sessions
WHEN NEW.state IN ('CLOSED', 'INTERRUPTED')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM interaction_operations AS operation
     WHERE operation.session_id = OLD.id
       AND operation.state = 'RESERVED'
  ) THEN RAISE(ABORT, 'terminal Interaction Session has a reserved Operation') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM interaction_pending_actions AS action
      LEFT JOIN interaction_pending_action_resolutions AS resolution
        ON resolution.pending_action_id = action.id
     WHERE action.session_id = OLD.id
       AND resolution.id IS NULL
  ) THEN RAISE(ABORT, 'terminal Interaction Session has an unresolved Pending Action') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM interaction_action_reservations AS reservation
      LEFT JOIN interaction_action_outcomes AS outcome
        ON outcome.reservation_id = reservation.id
     WHERE reservation.session_id = OLD.id
       AND outcome.id IS NULL
  ) THEN RAISE(ABORT, 'terminal Interaction Session has an unresolved Action Reservation') END;
END;

CREATE TRIGGER interaction_operations_open_session_insert_guard
BEFORE INSERT ON interaction_operations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_sessions AS session
     WHERE session.id = NEW.session_id
       AND session.state = 'OPEN'
  ) THEN RAISE(ABORT, 'Interaction Operation requires an OPEN Session') END;
END;

CREATE TRIGGER interaction_action_reservations_open_session_insert_guard
BEFORE INSERT ON interaction_action_reservations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM interaction_sessions AS session
     WHERE session.id = NEW.session_id
       AND session.state = 'OPEN'
  ) THEN RAISE(ABORT, 'Interaction Action Reservation requires an OPEN Session') END;
END;
