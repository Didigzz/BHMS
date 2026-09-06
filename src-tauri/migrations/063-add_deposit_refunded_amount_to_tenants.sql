-- Sales Report (sales-report-spec.md §4.4): exact deposit-refund tracking.
-- refundDeposit() captures the tenant's deposit_held BEFORE zeroing it and
-- stores it here — that IS the exact cash returned at move-out, which the
-- report subtracts from sales in the period containing moved_out_date.
-- NOT NULL DEFAULT 0 keeps legacy rows (never refunded) at zero.
ALTER TABLE tenants ADD COLUMN deposit_refunded_amount REAL NOT NULL DEFAULT 0;