UPDATE rooms SET status = 'Occupied'
WHERE id IN (SELECT DISTINCT room_id FROM tenants WHERE moved_out_date IS NULL);
