CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    reservation_date TEXT NOT NULL,
    target_move_in_date TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'whole' CHECK (scope IN ('whole','slot')),
    deposit REAL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','cancelled'))
);
