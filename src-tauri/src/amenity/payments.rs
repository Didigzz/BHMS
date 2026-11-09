//! Record, bulk-record, void and re-date amenity payments, each in one
//! transaction. The amount always comes from the share, never from the caller.

use super::conn::amenity_db_connection;
use super::dates::validate_amenity_paid_date;
use super::shares::{load_amenity_share, reverse_payment_row};

/// Record one tenant's amenity share as paid. The amount comes from the share,
/// never from the caller, and the date is the landlord's local date (validated
/// against the caller-supplied `today`).
pub(crate) fn record_amenity_payment_sync(
    app: &tauri::AppHandle,
    bill_tenant_id: i64,
    paid_date: &str,
    today: &str,
) -> Result<i64, String> {
    validate_amenity_paid_date(paid_date, today)?;

    let mut conn = amenity_db_connection(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("could not start the transaction: {e}"))?;

    let share = load_amenity_share(&tx, bill_tenant_id)?;
    if share.is_excluded {
        return Err("amenity:share-excluded".to_string());
    }
    if share.amount <= 0.0 {
        return Err("amenity:no-charge".to_string());
    }
    if share.bill_status != "active" {
        return Err("amenity:bill-cancelled".to_string());
    }

    let existing: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM amenity_payments WHERE bill_tenant_id = ?1 AND status = 'active'",
            [share.bill_tenant_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if existing > 0 {
        return Err("amenity:payment-exists".to_string());
    }

    tx.execute(
        "INSERT INTO amenity_payments\n           (bill_tenant_id, bill_id, tenant_id, amount, paid_date, status, created_at, updated_at)\n         VALUES (?1, ?2, ?3, ?4, ?5, 'active',\n                 strftime('%Y-%m-%dT%H:%M:%fZ','now'),\n                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        rusqlite::params![
            share.bill_tenant_id,
            share.bill_id,
            share.tenant_id,
            share.amount,
            paid_date,
        ],
    )
    .map_err(|e| format!("could not record the payment: {e}"))?;
    let payment_id = tx.last_insert_rowid();

    tx.execute(
        "UPDATE amenity_bill_tenants SET payment_status = 'Paid' WHERE id = ?1",
        [share.bill_tenant_id],
    )
    .map_err(|e| format!("could not mark the share paid: {e}"))?;

    tx.execute(
        "UPDATE tenants\n         SET amenity_balance = CASE\n             WHEN ROUND(amenity_balance - ?1, 2) = 0 THEN 0\n             ELSE ROUND(amenity_balance - ?1, 2)\n         END\n         WHERE id = ?2",
        rusqlite::params![share.amount, share.tenant_id],
    )
    .map_err(|e| format!("could not update the amenity balance: {e}"))?;

    tx.commit()
        .map_err(|e| format!("could not save the payment: {e}"))?;
    Ok(payment_id)
}

/// Mark every payable unpaid share on a bill as paid, in one transaction. One
/// invalid date rejects the whole batch; the count returned is what the UI
/// reports back to the landlord.
pub(crate) fn record_amenity_bill_payments_sync(
    app: &tauri::AppHandle,
    bill_id: i64,
    paid_date: &str,
    today: &str,
) -> Result<i64, String> {
    validate_amenity_paid_date(paid_date, today)?;

    let mut conn = amenity_db_connection(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("could not start the transaction: {e}"))?;

    let status: String = tx
        .query_row("SELECT status FROM amenity_bills WHERE id = ?1", [bill_id], |row| {
            row.get(0)
        })
        .map_err(|_| "amenity:not-found".to_string())?;
    if status != "active" {
        return Err("amenity:bill-cancelled".to_string());
    }

    let shares: Vec<(i64, i64, f64)> = {
        let mut statement = tx
            .prepare(
                "SELECT id, tenant_id, amount FROM amenity_bill_tenants\n                 WHERE bill_id = ?1 AND is_excluded = 0 AND amount > 0 AND payment_status = 'Unpaid'\n                 ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let collected = statement
            .query_map([bill_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, f64>(2)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<(i64, i64, f64)>, _>>()
            .map_err(|e| e.to_string())?;
        collected
    };
    if shares.is_empty() {
        return Err("amenity:no-unpaid".to_string());
    }

    let mut created = 0i64;
    for (bill_tenant_id, tenant_id, amount) in shares {
        tx.execute(
            "INSERT INTO amenity_payments\n               (bill_tenant_id, bill_id, tenant_id, amount, paid_date, status, created_at, updated_at)\n             VALUES (?1, ?2, ?3, ?4, ?5, 'active',\n                     strftime('%Y-%m-%dT%H:%M:%fZ','now'),\n                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            rusqlite::params![bill_tenant_id, bill_id, tenant_id, amount, paid_date],
        )
        .map_err(|e| format!("could not record a payment: {e}"))?;

        tx.execute(
            "UPDATE amenity_bill_tenants SET payment_status = 'Paid' WHERE id = ?1",
            [bill_tenant_id],
        )
        .map_err(|e| format!("could not mark a share paid: {e}"))?;

        tx.execute(
            "UPDATE tenants\n             SET amenity_balance = CASE\n                 WHEN ROUND(amenity_balance - ?1, 2) = 0 THEN 0\n                 ELSE ROUND(amenity_balance - ?1, 2)\n             END\n             WHERE id = ?2",
            rusqlite::params![amount, tenant_id],
        )
        .map_err(|e| format!("could not update an amenity balance: {e}"))?;

        created += 1;
    }

    tx.commit()
        .map_err(|e| format!("could not save the payments: {e}"))?;
    Ok(created)
}

/// Void one payment: keep the row, restore the share and the balance.
pub(crate) fn void_amenity_payment_sync(
    app: &tauri::AppHandle,
    payment_id: i64,
    reason: Option<&str>,
) -> Result<(), String> {
    let mut conn = amenity_db_connection(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("could not start the transaction: {e}"))?;
    reverse_payment_row(&tx, payment_id, reason)?;
    tx.commit()
        .map_err(|e| format!("could not void the payment: {e}"))?;
    Ok(())
}

/// Correct the date a payment was received on. No balance movement: the money
/// did not change, only the record of when it arrived.
pub(crate) fn update_amenity_payment_date_sync(
    app: &tauri::AppHandle,
    payment_id: i64,
    paid_date: &str,
    today: &str,
) -> Result<(), String> {
    validate_amenity_paid_date(paid_date, today)?;

    let mut conn = amenity_db_connection(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("could not start the transaction: {e}"))?;

    let status: String = tx
        .query_row(
            "SELECT status FROM amenity_payments WHERE id = ?1",
            [payment_id],
            |row| row.get(0),
        )
        .map_err(|_| "amenity:payment-not-found".to_string())?;
    if status != "active" {
        return Err("amenity:payment-not-active".to_string());
    }

    tx.execute(
        "UPDATE amenity_payments\n         SET paid_date = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')\n         WHERE id = ?2",
        rusqlite::params![paid_date, payment_id],
    )
    .map_err(|e| format!("could not update the paid date: {e}"))?;

    tx.commit()
        .map_err(|e| format!("could not save the paid date: {e}"))?;
    Ok(())
}
