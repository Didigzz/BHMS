CREATE TABLE IF NOT EXISTS amenity_bill_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES amenity_bills(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  room_number_snapshot TEXT NOT NULL,
  UNIQUE(bill_id, room_id)
)
