CREATE INDEX IF NOT EXISTS amenity_payments_paid_date
  ON amenity_payments(paid_date DESC, id DESC);
