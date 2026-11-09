CREATE UNIQUE INDEX IF NOT EXISTS amenity_payments_active_share
  ON amenity_payments(bill_tenant_id) WHERE status = 'active';
