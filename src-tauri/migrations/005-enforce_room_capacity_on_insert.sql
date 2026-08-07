CREATE TRIGGER IF NOT EXISTS enforce_room_capacity
BEFORE INSERT ON tenants
BEGIN
    SELECT CASE
        WHEN (SELECT COUNT(*) FROM tenants WHERE room_id = NEW.room_id)
             >= (SELECT capacity FROM rooms WHERE id = NEW.room_id)
        THEN RAISE(ABORT, 'Room is at full capacity')
    END;
END;
