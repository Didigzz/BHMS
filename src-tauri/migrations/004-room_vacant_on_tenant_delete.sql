CREATE TRIGGER IF NOT EXISTS room_vacant_on_delete
AFTER DELETE ON tenants
BEGIN
    UPDATE rooms SET status = 'Vacant'
    WHERE id = OLD.room_id
      AND (SELECT COUNT(*) FROM tenants WHERE room_id = OLD.room_id) = 0;
END;
