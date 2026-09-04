INSERT INTO reservations_new (id, room_id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count, deposit, status)
SELECT id, room_id, name, contact, reservation_date, target_move_in_date,
       CASE scope WHEN 'whole' THEN 'whole' ELSE 'bed' END,
       CASE scope WHEN 'whole' THEN NULL ELSE 1 END,
       deposit, status
FROM reservations;
