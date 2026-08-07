CREATE TRIGGER IF NOT EXISTS room_occupied_on_insert
AFTER INSERT ON tenants
BEGIN
    UPDATE rooms SET status = 'Occupied' WHERE id = NEW.room_id;
END;
