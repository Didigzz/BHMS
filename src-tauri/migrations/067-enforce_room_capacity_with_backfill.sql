-- Recreated from v054 with one addition: `NEW.backfilled = 1` (a tenant
-- entered via the Add modal's "Already boarding?" toggle — already physically
-- in the room before the system existed) bypasses ALL room checks. Everything
-- else is byte-for-byte the v054 math: maintenance, whole-room reservations,
-- and capacity (occupied beds + held beds + NEW beds > capacity).
CREATE TRIGGER enforce_room_capacity
BEFORE INSERT ON tenants
BEGIN
    SELECT CASE
        WHEN NEW.backfilled = 1 THEN NULL
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