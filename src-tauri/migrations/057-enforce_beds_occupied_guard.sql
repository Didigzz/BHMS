-- DB-level backstop for the room sheet's bed-count control: raising a
-- tenant's beds_occupied past the room's free beds (or below 1) is aborted
-- here, so the schema stays consistent even if a future UI path skips the
-- frontend guard. Same math as v054/v056: other tenants' beds + held beds +
-- NEW beds must fit the room's capacity.
CREATE TRIGGER enforce_beds_occupied_guard
BEFORE UPDATE OF beds_occupied ON tenants
BEGIN
    SELECT CASE
        WHEN NEW.beds_occupied < 1
            THEN RAISE(ABORT, 'Tenant must occupy at least one bed')
        WHEN (SELECT COALESCE(SUM(beds_occupied), 0) FROM tenants
              WHERE room_id = NEW.room_id AND moved_out_date IS NULL AND id != NEW.id)
           + (SELECT COALESCE(SUM(bed_count), 0) FROM reservations
              WHERE room_id = NEW.room_id AND status = 'active' AND hold_type IN ('bed','custom'))
           + NEW.beds_occupied
           > (SELECT capacity FROM rooms WHERE id = NEW.room_id)
            THEN RAISE(ABORT, 'Room is at full capacity')
    END;
END;
