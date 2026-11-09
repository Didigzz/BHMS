UPDATE tenants
SET amenity_balance =
  COALESCE((
    SELECT SUM(abt.amount)
    FROM amenity_bill_tenants abt
    JOIN amenity_bills ab ON ab.id = abt.bill_id
    WHERE abt.tenant_id = tenants.id
      AND abt.is_excluded = 0
      AND ab.status = 'active'
  ), 0)
  - COALESCE((
    SELECT SUM(p.amount) FROM amenity_payments p
    WHERE p.tenant_id = tenants.id AND p.status = 'active'
  ), 0);
