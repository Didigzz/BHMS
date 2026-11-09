CREATE TABLE IF NOT EXISTS amenity_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_tenant_id INTEGER NOT NULL REFERENCES amenity_bill_tenants(id) ON DELETE CASCADE,
  bill_id INTEGER NOT NULL REFERENCES amenity_bills(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- Amount frozen at the moment the share was settled. Bills with payments
  -- cannot be edited, so this can never disagree with the share it points at.
  amount REAL NOT NULL CHECK(amount >= 0),
  paid_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','reversed')),
  reversal_reason TEXT,
  reversed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
