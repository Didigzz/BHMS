CREATE TRIGGER enforce_room_state_on_room_change
BEFORE UPDATE OF room_id ON tenants
BEGIN
    SELECT CASE
        WHEN OLD.room_id != NEW.room_id
             AND (SELECT maintenance FROM rooms WHERE id = NEW.room_id) = 1
            THEN RAISE(ABORT, 'Room is under maintenance')
        WHEN OLD.room_id != NEW.room_id
             AND EXISTS(SELECT 1 FROM reservations WHERE room_id = NEW.room_id
                        AND status = 'active' AND scope = 'whole')
            THEN RAISE(ABORT, 'Room is reserved')
        WHEN (SELECT COUNT(*) FROM tenants WHERE room_id = NEW.room_id
              AND moved_out_date IS NULL AND id != NEW.id)
           + (SELECT COUNT(*) FROM reservations WHERE room_id = NEW.room_id
              AND status = 'active' AND scope = 'slot')
           >= (SELECT capacity FROM rooms WHERE id = NEW.room_id)
            THEN RAISE(ABORT, 'Room is at full capacity')
    END;
END;
