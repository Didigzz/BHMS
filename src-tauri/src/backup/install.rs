//! Installing a restore: file swap with retries, in-place transaction fallback.

use crate::db::database_path;

use super::envelope::verify_backup_envelope;
use super::sidecar;
use super::snapshot::{build_database_from_backup, load_backup_rows, verify_database};

/// How a restore installed its data. Used for logging only — the UI says
/// nothing, because which of the two paths ran is not the user's problem.
#[derive(serde::Serialize)]
pub(crate) struct RestoreReport {
    /// `"swap"` (the database file was replaced) or `"in-place"` (the rows were
    /// applied through SQLite because the file could not be replaced).
    method: String,
    /// Why the file swap was unavailable, when it was.
    fallback_reason: Option<String>,
}

/// Why replacing the database file could not be used.
pub(super) enum SwapBlocked {
    /// Nothing was changed, so applying the rows in place is still safe.
    Unavailable(String),
    /// The file was replaced but is not safe to open. There is no safe fallback
    /// and this must be reported loudly.
    Unsafe(String),
}

/// Confirm that no committed data lives only in the `-wal` before the main
/// database file is replaced.
///
/// A non-empty journal is a real hazard: the swap removes the file it belongs
/// to, so if the rename then failed the app would report that nothing had
/// changed while committed transactions had already been discarded. Truncating
/// it first makes the main file the single source of truth, and refusing to
/// continue while the journal is busy keeps the swap honest.
fn checkpoint_before_swap(db_path: &std::path::Path) -> Result<(), String> {
    // The connection is a local: it must be gone before the rename, or this
    // process would be the one holding the file open.
    if !db_path.exists() {
        return Ok(());
    }
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("could not open the database to flush it: {e}"))?;
    let busy: i64 = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
        .map_err(|e| format!("could not flush the database journal: {e}"))?;
    if busy != 0 {
        return Err("the database journal is in use by another program".to_string());
    }
    Ok(())
}

/// Replace the live database file with the rebuilt one.
///
/// The rename goes **first** and the journal sidecars are removed only after it
/// has succeeded. Deleting them first — which is what this used to do — destroys
/// committed data that still lives in the `-wal` if the rename then fails.
pub(super) fn swap_database_file(
    db_path: &std::path::Path,
    tmp_path: &std::path::Path,
) -> Result<(), SwapBlocked> {
    checkpoint_before_swap(db_path).map_err(SwapBlocked::Unavailable)?;

    if let Err(error) = std::fs::rename(tmp_path, db_path) {
        // The live file is untouched: another program is holding it open, or the
        // destination is not replaceable. Either way the in-place path can take
        // over, so this is not a failure.
        return Err(SwapBlocked::Unavailable(format!(
            "the database file could not be replaced ({error})"
        )));
    }

    // Only now are the sidecars ours to remove: they belong to the file that was
    // just replaced, and a stale non-empty `-wal` beside the new database would
    // corrupt it on the next open.
    let mut stuck: Vec<String> = Vec::new();
    for path in [sidecar(db_path, "-wal"), sidecar(db_path, "-shm")] {
        if path.exists() {
            if let Err(error) = std::fs::remove_file(&path) {
                stuck.push(format!("{} ({error})", path.display()));
            }
        }
    }
    if !stuck.is_empty() {
        return Err(SwapBlocked::Unsafe(format!(
            "the database was replaced but its journal files could not be removed: {}",
            stuck.join(", ")
        )));
    }
    Ok(())
}

/// How many times the file swap is attempted before the in-place path takes
/// over, and how long to wait between attempts.
const SWAP_ATTEMPTS: u32 = 5;
const SWAP_BACKOFF: std::time::Duration = std::time::Duration::from_millis(500);

/// Try the file swap a few times before accepting that it is not available.
///
/// A transient holder — antivirus scanning the freshly written file, the search
/// indexer — lets go within a moment, and a replaced file is the cleaner outcome,
/// so it is worth a bounded wait before falling back to writing in place. An
/// `Unsafe` result is returned immediately: the file has already been replaced
/// and retrying would compound that, not fix it.
pub(super) fn swap_with_retry(db_path: &std::path::Path, tmp_path: &std::path::Path) -> Result<(), SwapBlocked> {
    let mut last = SwapBlocked::Unavailable("the database file could not be replaced".to_string());
    for attempt in 0..SWAP_ATTEMPTS {
        match swap_database_file(db_path, tmp_path) {
            Ok(()) => return Ok(()),
            Err(SwapBlocked::Unsafe(reason)) => return Err(SwapBlocked::Unsafe(reason)),
            // Nothing was changed, so trying again is safe.
            Err(SwapBlocked::Unavailable(reason)) => last = SwapBlocked::Unavailable(reason),
        }
        if attempt + 1 < SWAP_ATTEMPTS {
            std::thread::sleep(SWAP_BACKOFF);
        }
    }
    Err(last)
}

/// Apply the backup's rows to the live database inside one transaction.
///
/// This is the path taken when the database file cannot be replaced: another
/// copy of the app, a database browser, antivirus, or a sync client holding it
/// open. It never touches the filesystem, so it works whoever has the file, and
/// because every change happens in a single SQLite transaction, a failure rolls
/// back and leaves the current data exactly as it was.
pub(super) fn install_in_place(
    db_path: &std::path::Path,
    tables: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("could not open your database to restore into it: {e}"))?;
    // Another program may be holding a lock; wait for it rather than giving up.
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| e.to_string())?;

    // Must be set outside the transaction — inside one the pragma is a no-op.
    conn.execute_batch("PRAGMA foreign_keys = OFF")
        .map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("could not start restoring your data: {e}"))?;

    match load_backup_rows(&conn, tables).and_then(|()| verify_database(&conn)) {
        Ok(()) => conn
            .execute_batch("COMMIT")
            .map_err(|e| format!("could not finish restoring your data: {e}")),
        Err(error) => {
            // Everything above is discarded; the live data is untouched.
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

/// Replace the live database with a validated backup. The caller has already
/// closed the SQL plugin's connection.
///
/// The file swap is preferred because a replaced file is the cleanest possible
/// outcome. It is not *required*, though: when the file cannot be replaced —
/// most often on Windows, where another process holding it open makes the rename
/// fail with "Access is denied" — the same rows are applied through SQLite
/// instead, so a held-open database no longer blocks a restore.
pub(super) fn install_backup(app: &tauri::AppHandle, payload: &str) -> Result<RestoreReport, String> {
    let envelope = verify_backup_envelope(payload)?;
    let tables = envelope
        .get("tables")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "This backup is incomplete — its data tables are missing or damaged.".to_string())?
        .clone();

    let db_path = database_path(app)?;
    let tmp_path = sidecar(&db_path, ".rebuild.tmp");
    let _ = std::fs::remove_file(&tmp_path);

    if let Err(error) = build_database_from_backup(&tmp_path, &tables) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(error);
    }

    match swap_with_retry(&db_path, &tmp_path) {
        Ok(()) => Ok(RestoreReport {
            method: "swap".to_string(),
            fallback_reason: None,
        }),
        Err(SwapBlocked::Unsafe(reason)) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(reason)
        }
        Err(SwapBlocked::Unavailable(reason)) => {
            let _ = std::fs::remove_file(&tmp_path);
            // Recorded for diagnosis, silent for the user: a held-open database
            // is worth knowing about even though the restore now succeeds.
            eprintln!(
                "restore: database file unavailable for swap, installing in place ({reason})"
            );
            install_in_place(&db_path, &tables).map_err(|error| {
                format!("{error} — and the database file could not be replaced either ({reason})")
            })?;
            Ok(RestoreReport {
                method: "in-place".to_string(),
                fallback_reason: Some(reason),
            })
        }
    }
}

/// Restore a `.digal` backup: validate → rebuild → verify → swap (or, when the
/// file cannot be replaced, apply in place).
#[tauri::command]
pub(crate) async fn install_backup_file(
    app: tauri::AppHandle,
    payload: String,
) -> Result<RestoreReport, String> {
    tauri::async_runtime::spawn_blocking(move || install_backup(&app, &payload))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Preflight, safety copies and the missing-database guard
// ---------------------------------------------------------------------------
