//! A tenant's share row, and the reversal that the void command and bill
//! cancellation both apply.

/// The reversal note is truncated, never rejected: a long explanation should
/// not cost the landlord the void (spec R12).
const AMENITY_REVERSAL_NOTE_MAX: usize = 200;

/// One tenant share plus the bill state every payment command has to re-check.
pub(crate) struct AmenityShare {
    pub(crate) bill_tenant_id: i64,
    pub(crate) bill_id: i64,
    pub(crate) tenant_id: i64,
    pub(crate) amount: f64,
    pub(crate) is_excluded: bool,
    pub(crate) bill_status: String,
}

pub(crate) fn load_amenity_share(
    tx: &rusqlite::Transaction,
    bill_tenant_id: i64,
) -> Result<AmenityShare, String> {
    tx.query_row(
        "SELECT abt.id, abt.bill_id, abt.tenant_id, abt.amount, abt.is_excluded, ab.status\n         FROM amenity_bill_tenants abt\n         JOIN amenity_bills ab ON ab.id = abt.bill_id\n         WHERE abt.id = ?1",
        [bill_tenant_id],
        |row| {
            Ok(AmenityShare {
                bill_tenant_id: row.get(0)?,
                bill_id: row.get(1)?,
                tenant_id: row.get(2)?,
                amount: row.get(3)?,
                is_excluded: row.get::<_, i64>(4)? == 1,
                bill_status: row.get(5)?,
            })
        },
    )
    .map_err(|_| "amenity:payment-not-found".to_string())
}

/// Flip one active payment to `reversed` and undo its balance effect. Shared by
/// the void command and by bill cancellation, so both leave the same trail.
pub(crate) fn reverse_payment_row(
    tx: &rusqlite::Transaction,
    payment_id: i64,
    reason: Option<&str>,
) -> Result<(i64, f64), String> {
    let (bill_tenant_id, tenant_id, amount, status): (i64, i64, f64, String) = tx
        .query_row(
            "SELECT bill_tenant_id, tenant_id, amount, status FROM amenity_payments WHERE id = ?1",
            [payment_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| "amenity:payment-not-found".to_string())?;
    if status != "active" {
        return Err("amenity:payment-not-active".to_string());
    }

    let note: Option<String> = reason
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.chars().take(AMENITY_REVERSAL_NOTE_MAX).collect());

    tx.execute(
        "UPDATE amenity_payments\n         SET status = 'reversed', reversal_reason = ?1,\n             reversed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),\n             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')\n         WHERE id = ?2 AND status = 'active'",
        rusqlite::params![note, payment_id],
    )
    .map_err(|e| format!("could not reverse the payment: {e}"))?;

    tx.execute(
        "UPDATE amenity_bill_tenants SET payment_status = 'Unpaid' WHERE id = ?1",
        [bill_tenant_id],
    )
    .map_err(|e| format!("could not reopen the tenant share: {e}"))?;

    tx.execute(
        "UPDATE tenants\n         SET amenity_balance = CASE\n             WHEN ROUND(amenity_balance + ?1, 2) = 0 THEN 0\n             ELSE ROUND(amenity_balance + ?1, 2)\n         END\n         WHERE id = ?2",
        rusqlite::params![amount, tenant_id],
    )
    .map_err(|e| format!("could not restore an amenity balance: {e}"))?;

    Ok((tenant_id, amount))
}
