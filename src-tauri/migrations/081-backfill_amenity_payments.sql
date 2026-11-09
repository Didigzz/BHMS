INSERT INTO amenity_payments
  (bill_tenant_id, bill_id, tenant_id, amount, paid_date, status, created_at, updated_at)
SELECT abt.id, abt.bill_id, abt.tenant_id, abt.amount, ab.billing_date, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM amenity_bill_tenants abt
JOIN amenity_bills ab ON ab.id = abt.bill_id
WHERE abt.payment_status = 'Paid'
  AND abt.is_excluded = 0
  AND abt.amount > 0
  AND ab.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM amenity_payments p
    WHERE p.bill_tenant_id = abt.id AND p.status = 'active'
  );
