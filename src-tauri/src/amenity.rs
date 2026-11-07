//! Amenity billing writes (amenity-billing-spec.md §10).
//!
//! Creating, editing and cancelling a bill each touch the bill row, its tenant
//! and room rows, and every affected tenant's Amenity Balance. They run HERE,
//! inside one rusqlite transaction, so a failure halfway leaves no rows and no
//! balance change behind.
//!
//! Why not in TypeScript: tauri-plugin-sql hands every `execute` a connection
//! from its pool, so a `BEGIN` there does not guard the statements that follow
//! (and `SELECT last_insert_rowid()` can answer from the wrong connection).
//!
//! Errors handed back to the frontend are stable codes ("amenity:manual-sum"),
//! never prose — the locked user-facing messages live in
//! src/lib/amenity-billing.ts (spec §12, todo T10) and the caller maps codes to
//! them, so no message text is duplicated.

use crate::db::database_path;

#[derive(serde::Deserialize)]
pub(crate) struct AmenityTenantInput {
    tenant_id: i64,
    amount: f64,
}

#[derive(serde::Deserialize)]
pub(crate) struct AmenityExcludedInput {
    tenant_id: i64,
    reason: String,
}

#[derive(serde::Deserialize)]
pub(crate) struct AmenityBillInput {
    bill_id: Option<i64>,
    amenity_name: String,
    billing_method: String,
    total_amount: f64,
    billing_date: String,
    billing_period: Option<String>,
    notes: Option<String>,
    division_mode: String,
    meter_start: Option<f64>,
    meter_end: Option<f64>,
    price_per_unit: Option<f64>,
    tenants: Vec<AmenityTenantInput>,
    excluded: Vec<AmenityExcludedInput>,
    room_ids: Vec<i64>,
}

/// Shares may run up to ₱1 below the bill total (the landlord absorbs the
/// leftover centavos, spec §8.1) but never above it. Mirrors MAX_ABSORBED in
/// src/lib/amenity-billing.ts.
const AMENITY_MAX_ABSORBED: f64 = 1.0;

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// Structural re-check of the exact payload that arrived over IPC. Returns a
/// code the frontend translates into a locked message.
fn validate_amenity_input(input: &AmenityBillInput) -> Result<(), String> {
    if input.amenity_name.trim().is_empty() {
        return Err("amenity:name".to_string());
    }
    if !input.total_amount.is_finite() || input.total_amount <= 0.0 {
        return Err("amenity:amount".to_string());
    }
    if !matches!(input.billing_method.as_str(), "shared" | "per_room" | "connected") {
        return Err("amenity:method".to_string());
    }
    if input.division_mode != "auto" && input.division_mode != "manual" {
        return Err("amenity:division-mode".to_string());
    }
    if input.billing_method != "shared" && input.room_ids.is_empty() {
        return Err("amenity:selection".to_string());
    }
    if input.billing_method == "shared" && input.tenants.is_empty() && input.excluded.is_empty() {
        return Err("amenity:selection".to_string());
    }
    if input.billing_method == "connected" && input.room_ids.len() < 2 {
        return Err("amenity:connected-rooms".to_string());
    }
    if input.excluded.iter().any(|row| row.reason.trim().is_empty()) {
        return Err("amenity:exclusion-reason".to_string());
    }
    if input.tenants.iter().any(|row| !row.amount.is_finite() || row.amount < 0.0) {
        return Err("amenity:negative-amount".to_string());
    }
    if input.division_mode == "manual" {
        let sum: f64 = input.tenants.iter().map(|row| row.amount).sum();
        let shortfall = round2(input.total_amount - round2(sum));
        if shortfall < -0.005 || shortfall > AMENITY_MAX_ABSORBED + 0.005 {
            return Err("amenity:manual-sum".to_string());
        }
    }
    Ok(())
}

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

fn amenity_db_connection(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
    let path = database_path(app)?;
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| format!("could not open the database: {e}"))?;
    // The sql plugin holds its own pooled connection; wait rather than fail if
    // a write is in flight.
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Create (bill_id = None) or edit (bill_id = Some) a bill with its tenant
/// shares and balance deltas, all inside one transaction. Returns the bill id.
fn save_amenity_bill_sync(app: &tauri::AppHandle, input: &AmenityBillInput) -> Result<i64, String> {
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
            "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot) VALUES (?1,?2,?3,0,NULL,'Unpaid',?4,?5)",
            rusqlite::params![bill_id, tenant.tenant_id, tenant.amount, name, room_number],
        )
        .map_err(|e| format!("could not save a tenant share: {e}"))?;
    }
    for excluded in &input.excluded {
        let (name, room_number) = amenity_tenant_snapshot(&tx, excluded.tenant_id);
        tx.execute(
            "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot) VALUES (?1,?2,0,1,?3,'Unpaid',?4,?5)",
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
fn cancel_amenity_bill_sync(app: &tauri::AppHandle, bill_id: i64) -> Result<(), String> {
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
                "UPDATE tenants SET amenity_balance = amenity_balance - ?1 WHERE id = ?2",
                rusqlite::params![amount, tenant_id],
            )
            .map_err(|e| format!("could not reverse an amenity balance: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("could not cancel the bill: {e}"))?;
    Ok(())
}

/// Create or edit an amenity bill atomically (single connection, one
/// transaction). Returns the bill id.
#[tauri::command]
pub(crate) async fn save_amenity_bill(
    app: tauri::AppHandle,
    input: AmenityBillInput,
) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || save_amenity_bill_sync(&app, &input))
        .await
        .map_err(|e| e.to_string())?
}

/// Soft-cancel an amenity bill and reverse its balance effects atomically.
#[tauri::command]
pub(crate) async fn cancel_amenity_bill(app: tauri::AppHandle, bill_id: i64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cancel_amenity_bill_sync(&app, bill_id))
        .await
        .map_err(|e| e.to_string())?
}
