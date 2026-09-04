CREATE TRIGGER enforce_reservation_room_state
BEFORE INSERT ON reservations
BEGIN
    SELECT CASE
        WHEN (SELECT maintenance FROM rooms WHERE id = NEW.room_id) = 1
            THEN RAISE(ABORT, 'Room is under maintenance')
        WHEN NEW.hold_type = 'whole' AND EXISTS(SELECT 1 FROM tenants
                    WHERE room_id = NEW.room_id AND moved_out_date IS NULL)
            THEN RAISE(ABORT, 'Room already has tenants')
        WHEN NEW.hold_type = 'whole' AND EXISTS(SELECT 1 FROM reservations
                    WHERE room_id = NEW.room_id AND status = 'active')
            THEN RAISE(ABORT, 'Room is already reserved')
        WHEN NEW.hold_type IN ('bed','custom') AND EXISTS(SELECT 1 FROM reservations
                    WHERE room_id = NEW.room_id AND status = 'active' AND hold_type = 'whole')
            THEN RAISE(ABORT, 'Room is reserved')
        WHEN NEW.hold_type IN ('bed','custom') AND
            (SELECT COUNT(*) FROM tenants WHERE room_id = NEW.room_id AND moved_out_date IS NULL)
            + (SELECT COALESCE(SUM(bed_count), 0) FROM reservations WHERE room_id = NEW.room_id
               AND status = 'active' AND hold_type IN ('bed','custom'))
            + COALESCE(NEW.bed_count, 0)
            > (SELECT capacity FROM rooms WHERE id = NEW.room_id)
            THEN RAISE(ABORT, 'Room is at full capacity')
        WHEN NEW.hold_type IN ('bed','custom') AND COALESCE(NEW.bed_count, 0) < 1
            THEN RAISE(ABORT, 'Hold must reserve at least one bed')
    END;
END;
