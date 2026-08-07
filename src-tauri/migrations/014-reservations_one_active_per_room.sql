CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_one_active
ON reservations(room_id) WHERE status = 'active';
