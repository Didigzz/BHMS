-- Recreated with multi-bed math (v050): occupancy is the SUM of active
-- tenants' beds_occupied (not a head count), plus beds held by partial
-- holds. `NEW.beds_occupied` is included so a tenant INSERTED with more than
-- one bed (e.g. from a reservation convert) is also checked — with the
-- default 1 bed this is exactly the legacy `existing >= capacity` rule.
CREATE TRIGGER enforce_room_capacity
BEFORE INSERT ON tenants
BEGIN
    SELECT CASE
        WHEN (SELECT maintenance FROM rooms WHERE id = NEW.room_id) = 1
            THEN RAISE(ABORT, 'Room is under maintenance')
        WHEN EXISTS(SELECT 1 FROM reservations WHERE room_id = NEW.room_id
                    AND status = 'active' AND hold_type = 'whole')
            THEN RAISE(ABORT, 'Room is reserved')
        WHEN (SELECT COALESCE(SUM(beds_occupied), 0) FROM tenants
              WHERE room_id = NEW.room_id AND moved_out_date IS NULL)
           + (SELECT COALESCE(SUM(bed_count), 0) FROM reservations WHERE room_id = NEW.room_id
              AND status = 'active' AND hold_type IN ('bed','custom'))
           + NEW.beds_occupied
           > (SELECT capacity FROM rooms WHERE id = NEW.room_id)
            THEN RAISE(ABORT, 'Room is at full capacity')
    END;
END;
