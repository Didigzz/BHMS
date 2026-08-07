UPDATE tenants SET monthly_rate = (SELECT r.monthly_rate FROM rooms r WHERE r.id = tenants.room_id) WHERE monthly_rate IS NULL;
