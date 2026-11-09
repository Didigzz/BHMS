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
//!
//! Layout: the `#[tauri::command]` wrappers stay in this file so `lib.rs`'s
//! import list and `generate_handler!` paths are unchanged; each wrapper is a
//! thin `spawn_blocking` over one transaction in `bills` or `payments`.

mod bills;
mod conn;
mod dates;
mod payments;
mod shares;
mod types;
mod validation;

use types::AmenityBillInput;

/// Create or edit an amenity bill atomically (single connection, one
/// transaction). Returns the bill id.
#[tauri::command]
pub(crate) async fn save_amenity_bill(
    app: tauri::AppHandle,
    input: AmenityBillInput,
) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || bills::save_amenity_bill_sync(&app, &input))
        .await
        .map_err(|e| e.to_string())?
}

/// Soft-cancel an amenity bill and reverse its balance effects atomically.
#[tauri::command]
pub(crate) async fn cancel_amenity_bill(app: tauri::AppHandle, bill_id: i64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || bills::cancel_amenity_bill_sync(&app, bill_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn record_amenity_payment(
    app: tauri::AppHandle,
    bill_tenant_id: i64,
    paid_date: String,
    today: String,
) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        payments::record_amenity_payment_sync(&app, bill_tenant_id, &paid_date, &today)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn record_amenity_bill_payments(
    app: tauri::AppHandle,
    bill_id: i64,
    paid_date: String,
    today: String,
) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        payments::record_amenity_bill_payments_sync(&app, bill_id, &paid_date, &today)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn void_amenity_payment(
    app: tauri::AppHandle,
    payment_id: i64,
    reason: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        payments::void_amenity_payment_sync(&app, payment_id, reason.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn update_amenity_payment_date(
    app: tauri::AppHandle,
    payment_id: i64,
    paid_date: String,
    today: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        payments::update_amenity_payment_date_sync(&app, payment_id, &paid_date, &today)
    })
    .await
    .map_err(|e| e.to_string())?
}
