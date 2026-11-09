ALTER TABLE amenity_bill_tenants
  ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0 CHECK(is_manual IN (0,1))
