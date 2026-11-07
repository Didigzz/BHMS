CREATE TABLE IF NOT EXISTS amenity_bill_tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES amenity_bills(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
  is_excluded INTEGER NOT NULL DEFAULT 0 CHECK(is_excluded IN (0,1)),
  exclusion_reason TEXT,
  payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK(payment_status IN ('Paid','Unpaid')),
  tenant_name_snapshot TEXT NOT NULL,
  room_number_snapshot TEXT NOT NULL
)
