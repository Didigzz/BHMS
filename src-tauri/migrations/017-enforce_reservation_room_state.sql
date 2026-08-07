CREATE TRIGGER enforce_reservation_room_state
BEFORE INSERT ON reservations
BEGIN
    SELECT CASE
        WHEN (SELECT maintenance FROM rooms WHERE id = NEW.room_id) = 1
            THEN RAISE(ABORT, 'Room is under maintenance')
        WHEN NEW.scope = 'whole' AND EXISTS(SELECT 1 FROM tenants
                    WHERE room_id = NEW.room_id AND moved_out_date IS NULL)
            THEN RAISE(ABORT, 'Room already has tenants')
        WHEN NEW.scope = 'slot' AND
            (SELECT COUNT(*) FROM tenants WHERE room_id = NEW.room_id AND moved_out_date IS NULL)
            + (SELECT COUNT(*) FROM reservations WHERE room_id = NEW.room_id
               AND status = 'active' AND scope = 'slot')
            >= (SELECT capacity FROM rooms WHERE id = NEW.room_id)
            THEN RAISE(ABORT, 'Room is at full capacity')
    END;
END;
