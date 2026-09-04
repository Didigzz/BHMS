CREATE TRIGGER enforce_room_capacity
BEFORE INSERT ON tenants
BEGIN
    SELECT CASE
        WHEN (SELECT maintenance FROM rooms WHERE id = NEW.room_id) = 1
            THEN RAISE(ABORT, 'Room is under maintenance')
        WHEN EXISTS(SELECT 1 FROM reservations WHERE room_id = NEW.room_id
                    AND status = 'active' AND hold_type = 'whole')
            THEN RAISE(ABORT, 'Room is reserved')
        WHEN (SELECT COUNT(*) FROM tenants WHERE room_id = NEW.room_id AND moved_out_date IS NULL)
           + (SELECT COALESCE(SUM(bed_count), 0) FROM reservations WHERE room_id = NEW.room_id
              AND status = 'active' AND hold_type IN ('bed','custom'))
           >= (SELECT capacity FROM rooms WHERE id = NEW.room_id)
            THEN RAISE(ABORT, 'Room is at full capacity')
    END;
END;
