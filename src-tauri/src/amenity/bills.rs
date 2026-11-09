//! Bill create/edit and soft-cancel, each in one rusqlite transaction.

use super::conn::amenity_db_connection;
use super::shares::reverse_payment_row;
use super::types::AmenityBillInput;
use super::validation::{round2, validate_amenity_input};

/// Name + room number frozen on the bill so history survives a rename, a room
/// change, or (eventually) a tenant delete.
fn amenity_tenant_snapshot(conn: &rusqlite::Connection, tenant_id: i64) -> (String, String) {
    conn.query_row(
        "SELECT t.name, r.room_number FROM tenants t JOIN rooms r ON r.id = t.room_id WHERE t.id = ?1",
        [tenant_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .unwrap_or_else(|_| (format!("Tenant {tenant_id}"), "—".to_string()))
}

/// Create (bill_id = None) or edit (bill_id = Some) a bill with its tenant
/// shares and balance deltas, all inside one transaction. Returns the bill id.
pub(crate) fn save_amenity_bill_sync(
    app: &tauri::AppHandle,
    input: &AmenityBillInput,
) -> Result<i64, String> {
    validate_amenity_input(input)?;

    let mut conn = amenity_db_connection(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("could not start the transaction: {e}"))?;

    // A tenant on both lists is excluded, exactly like the frontend computes it.
    let excluded_ids: std::collections::HashSet<i64> =
        input.excluded.iter().map(|row| row.tenant_id).collect();

    // What the tenants were charged before this save, so editing applies only
    // the difference (spec §8.2).
    let previous: std::collections::HashMap<i64, f64> = match input.bill_id {
        Some(bill_id) => {
            let status: String = tx
                .query_row("SELECT status FROM amenity_bills WHERE id = ?1", [bill_id], |row| {
                    row.get(0)
                })
                .map_err(|_| "amenity:not-found".to_string())?;
            if status == "cancelled" {
                return Err("amenity:cancelled".to_string());
            }
            // Decision 11: once money is recorded, the bill's shares are
            // evidence. Void the payments first; the UI disables Edit too, but
            // this is the enforcement that matters.
            let active_payments: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM amenity_payments WHERE bill_id = ?1 AND status = 'active'",
                    [bill_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if active_payments > 0 {
                return Err("amenity:paid-locked".to_string());
            }
            let mut statement = tx
                .prepare(
                    "SELECT tenant_id, amount, is_excluded FROM amenity_bill_tenants WHERE bill_id = ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([bill_id], |row| {
                    let tenant_id: i64 = row.get(0)?;
                    let amount: f64 = row.get(1)?;
                    let is_excluded: i64 = row.get(2)?;
                    Ok((tenant_id, if is_excluded == 1 { 0.0 } else { amount }))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<std::collections::HashMap<i64, f64>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        }
        None => std::collections::HashMap::new(),
    };

    let bill_id = match input.bill_id {
        Some(bill_id) => {
            tx.execute(
                "UPDATE amenity_bills SET amenity_name = ?1, billing_method = ?2, total_amount = ?3, billing_date = ?4, billing_period = ?5, notes = ?6, division_mode = ?7, meter_start = ?8, meter_end = ?9, price_per_unit = ?10, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?11",
                rusqlite::params![
                    input.amenity_name.trim(),
                    input.billing_method,
                    input.total_amount,
                    input.billing_date,
                    input.billing_period,
                    input.notes,
                    input.division_mode,
                    input.meter_start,
                    input.meter_end,
                    input.price_per_unit,
                    bill_id,
                ],
            )
            .map_err(|e| format!("could not update the amenity bill: {e}"))?;
            tx.execute("DELETE FROM amenity_bill_tenants WHERE bill_id = ?1", [bill_id])
                .map_err(|e| format!("could not rewrite the bill's tenants: {e}"))?;
            tx.execute("DELETE FROM amenity_bill_rooms WHERE bill_id = ?1", [bill_id])
                .map_err(|e| format!("could not rewrite the bill's rooms: {e}"))?;
            bill_id
        }
        None => {
            tx.execute(
                "INSERT INTO amenity_bills (amenity_name, billing_method, total_amount, billing_date, billing_period, notes, division_mode, status, meter_start, meter_end, price_per_unit, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'active',?8,?9,?10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                rusqlite::params![
                    input.amenity_name.trim(),
                    input.billing_method,
                    input.total_amount,
                    input.billing_date,
                    input.billing_period,
                    input.notes,
                    input.division_mode,
                    input.meter_start,
                    input.meter_end,
                    input.price_per_unit,
                ],
            )
            .map_err(|e| format!("could not create the amenity bill: {e}"))?;
            tx.last_insert_rowid()
        }
    };

    // Exactly one row per tenant: included tenants carry their share, excluded
    // tenants carry ₱0 plus the reason (spec delta D5).
    for tenant in &input.tenants {
        if excluded_ids.contains(&tenant.tenant_id) {
            continue;
        }
        let (name, room_number) = amenity_tenant_snapshot(&tx, tenant.tenant_id);
        tx.execute(
            "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot, is_manual) VALUES (?1,?2,?3,0,NULL,'Unpaid',?4,?5,?6)",
            rusqlite::params![
                bill_id,
                tenant.tenant_id,
                tenant.amount,
                name,
                room_number,
                if tenant.is_manual { 1 } else { 0 },
            ],
        )
        .map_err(|e| format!("could not save a tenant share: {e}"))?;
    }
    for excluded in &input.excluded {
        let (name, room_number) = amenity_tenant_snapshot(&tx, excluded.tenant_id);
        tx.execute(
            "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot, is_manual) VALUES (?1,?2,0,1,?3,'Unpaid',?4,?5,0)",
            rusqlite::params![
                bill_id,
                excluded.tenant_id,
                excluded.reason.trim(),
                name,
                room_number
            ],
        )
        .map_err(|e| format!("could not save an excluded tenant: {e}"))?;
    }

    let mut room_ids: Vec<i64> = Vec::new();
    for room_id in &input.room_ids {
        if room_ids.contains(room_id) {
            continue; // UNIQUE(bill_id, room_id)
        }
        room_ids.push(*room_id);
        let room_number: String = tx
            .query_row("SELECT room_number FROM rooms WHERE id = ?1", [room_id], |row| {
                row.get(0)
            })
            .unwrap_or_else(|_| format!("Room {room_id}"));
        tx.execute(
            "INSERT INTO amenity_bill_rooms (bill_id, room_id, room_number_snapshot) VALUES (?1,?2,?3)",
            rusqlite::params![bill_id, room_id, room_number],
        )
        .map_err(|e| format!("could not save a bill room: {e}"))?;
    }

    let mut next: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();
    for tenant in &input.tenants {
        if excluded_ids.contains(&tenant.tenant_id) {
            continue;
        }
        next.insert(tenant.tenant_id, tenant.amount);
    }
    for excluded in &input.excluded {
        next.insert(excluded.tenant_id, 0.0);
    }

    let mut affected: std::collections::HashSet<i64> = std::collections::HashSet::new();
    affected.extend(previous.keys().copied());
    affected.extend(next.keys().copied());
    for tenant_id in affected {
        let old = previous.get(&tenant_id).copied().unwrap_or(0.0);
        let new = next.get(&tenant_id).copied().unwrap_or(0.0);
        let delta = round2(new - old);
        if delta != 0.0 {
            tx.execute(
                "UPDATE tenants SET amenity_balance = amenity_balance + ?1 WHERE id = ?2",
                rusqlite::params![delta, tenant_id],
            )
            .map_err(|e| format!("could not update an amenity balance: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("could not save the amenity bill: {e}"))?;
    Ok(bill_id)
}

/// Soft-cancel: keep every row, reverse all non-excluded shares (including
/// ones already marked Paid — spec §11).
pub(crate) fn cancel_amenity_bill_sync(app: &tauri::AppHandle, bill_id: i64) -> Result<(), String> {
    let mut conn = amenity_db_connection(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("could not start the transaction: {e}"))?;

    let status: String = tx
        .query_row("SELECT status FROM amenity_bills WHERE id = ?1", [bill_id], |row| {
            row.get(0)
        })
        .map_err(|_| "amenity:not-found".to_string())?;
    if status == "cancelled" {
        return Err("amenity:already-cancelled".to_string());
    }

    tx.execute(
        "UPDATE amenity_bills SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        [bill_id],
    )
    .map_err(|e| format!("could not cancel the bill: {e}"))?;

    // Reverse active payments BEFORE removing the shares' charges: a paid
    // tenant then nets +paid − share = 0, while an unpaid share only loses its
    // charge (spec §3.5).
    let payment_ids: Vec<i64> = {
        let mut statement = tx
            .prepare("SELECT id FROM amenity_payments WHERE bill_id = ?1 AND status = 'active'")
            .map_err(|e| e.to_string())?;
        let collected = statement
            .query_map([bill_id], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<i64>, _>>()
            .map_err(|e| e.to_string())?;
        collected
    };
    for payment_id in payment_ids {
        reverse_payment_row(&tx, payment_id, Some("Bill cancelled"))?;
    }

    let rows: Vec<(i64, f64)> = {
        let mut statement = tx
            .prepare("SELECT tenant_id, amount FROM amenity_bill_tenants WHERE bill_id = ?1")
            .map_err(|e| e.to_string())?;
        let collected = statement
            .query_map([bill_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<(i64, f64)>, _>>()
            .map_err(|e| e.to_string())?;
        collected
    };

    for (tenant_id, amount) in rows {
        if amount > 0.0 {
            tx.execute(
                "UPDATE tenants\n                 SET amenity_balance = CASE\n                     WHEN ROUND(amenity_balance - ?1, 2) = 0 THEN 0\n                     ELSE ROUND(amenity_balance - ?1, 2)\n                 END\n                 WHERE id = ?2",
                rusqlite::params![amount, tenant_id],
            )
            .map_err(|e| format!("could not reverse an amenity balance: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("could not cancel the bill: {e}"))?;
    Ok(())
}
