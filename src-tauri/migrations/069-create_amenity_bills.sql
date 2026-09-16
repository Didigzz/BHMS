CREATE TABLE IF NOT EXISTS amenity_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amenity_name TEXT NOT NULL,
  amenity_type TEXT NOT NULL CHECK(amenity_type IN ('Electricity','Water','Internet','Gas','Air-conditioning','Parking','Maintenance','Cleaning','Other')),
  billing_method TEXT NOT NULL CHECK(billing_method IN ('shared','per_room','connected')),
  total_amount REAL NOT NULL CHECK(total_amount > 0),
  billing_date TEXT NOT NULL,
  billing_period TEXT,
  notes TEXT,
  division_mode TEXT NOT NULL DEFAULT 'auto' CHECK(division_mode IN ('auto','manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  meter_start REAL,
  meter_end REAL,
  price_per_unit REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
