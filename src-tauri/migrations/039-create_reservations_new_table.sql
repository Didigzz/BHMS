CREATE TABLE reservations_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    reservation_date TEXT NOT NULL,
    target_move_in_date TEXT NOT NULL,
    hold_type TEXT NOT NULL DEFAULT 'whole' CHECK (hold_type IN ('whole','bed','custom')),
    bed_count INTEGER CHECK (bed_count IS NULL OR bed_count >= 1),
    deposit REAL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','cancelled')),
    CHECK ((hold_type = 'whole') = (bed_count IS NULL))
);
