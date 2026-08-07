UPDATE rooms SET status = 'Reserved'
WHERE id IN (SELECT room_id FROM reservations WHERE status = 'active' AND scope = 'whole');
