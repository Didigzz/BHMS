CREATE INDEX IF NOT EXISTS amenity_payments_tenant
  ON amenity_payments(tenant_id, paid_date DESC);
