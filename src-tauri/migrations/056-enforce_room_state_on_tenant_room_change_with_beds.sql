-- Recreated with multi-bed math (v050): a tenant moving rooms now brings
-- their bed count with them — the destination check sums the other tenants'
-- beds_occupied and adds NEW.beds_occupied. With the default 1 bed this is
-- exactly the legacy rule (others' head count + 1 > capacity).
CREATE TRIGGER enforce_room_state_on_room_change
BEFORE UPDATE OF room_id ON tenants
BEGIN
    SELECT CASE
        WHEN OLD.room_id != NEW.room_id
             AND (SELECT maintenance FROM rooms WHERE id = NEW.room_id) = 1
            THEN RAISE(ABORT, 'Room is under maintenance')
        WHEN OLD.room_id != NEW.room_id
             AND EXISTS(SELECT 1 FROM reservations WHERE room_id = NEW.room_id
                        AND status = 'active' AND hold_type = 'whole')
            THEN RAISE(ABORT, 'Room is reserved')
        WHEN (SELECT COALESCE(SUM(beds_occupied), 0) FROM tenants
              WHERE room_id = NEW.room_id AND moved_out_date IS NULL AND id != NEW.id)
           + (SELECT COALESCE(SUM(bed_count), 0) FROM reservations WHERE room_id = NEW.room_id
              AND status = 'active' AND hold_type IN ('bed','custom'))
           + NEW.beds_occupied
           > (SELECT capacity FROM rooms WHERE id = NEW.room_id)
            THEN RAISE(ABORT, 'Room is at full capacity')
    END;
END;
