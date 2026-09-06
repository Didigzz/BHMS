-- Sales Report (sales-report-spec.md §4.4) LEGACY BACKFILL: rows already
-- deposit_refunded = 1 predate the exact-refund column, so their exact return
-- amount is unrecoverable — refundDeposit() never stored it. deposit_amount is
-- the best guess available (past refunds are rare and the approximation only
-- affects historical periods, per the review-2 assumptions). Tenants with no
-- deposit keep the DEFAULT 0 — the NOT NULL column would reject NULL here.
UPDATE tenants SET deposit_refunded_amount = deposit_amount
WHERE deposit_refunded = 1 AND deposit_amount IS NOT NULL;