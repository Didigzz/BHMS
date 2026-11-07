//! Backup export / restore (the `.digal` format).
//!
//! A backup is a readable JSON document (`.digal`) whose shape is defined by
//! src/lib/backup-format.ts. Export writes it into the device Downloads folder;
//! restore rebuilds a fresh database from this build's own `migrations()`,
//! loads the backup's rows into it, verifies it, and only then swaps the file
//! in — so a failed restore never leaves the live database half-written.
//!
//! The format's canonical spec (`backup-digal-format-spec.md`) is referenced by
//! this module's history but is not in the repo; the contract lives in
//! src/lib/backup-format.ts, README → Backups, and here.

use crate::db::database_path;
use crate::migrations::migrations;

/// Format marker of a `.digal` backup (mirrors FORMAT in backup-format.ts).
const BACKUP_FORMAT: &str = "bhms-backup";
/// Highest envelope version this build understands (mirrors FORMAT_VERSION).
const BACKUP_FORMAT_VERSION: i64 = 1;
/// Tables every backup must carry, in insert order (parents before children).
///
/// Also the definition of "this database has the app's schema", used by
/// `migrations_repair::schema_is_complete` to tell a restored database (schema
/// present, ledger missing) from a fresh one.
pub(crate) const BACKUP_TABLES: [&str; 9] = [
    "rooms",
    "tenants",
    "payments",
    "reservations",
    "settings",
    "notifications_log",
    "amenity_bills",
    "amenity_bill_tenants",
    "amenity_bill_rooms",
];
/// Tables whose AUTOINCREMENT counters are restored from MAX(id).
const BACKUP_AUTOINCREMENT_TABLES: [&str; 8] = [
    "rooms",
    "tenants",
    "payments",
    "reservations",
    "notifications_log",
    "amenity_bills",
    "amenity_bill_tenants",
    "amenity_bill_rooms",
];

/// What the platform writer reports about the file it just saved, so the
/// frontend can prove the bytes on the device are the bytes it produced.
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct BackupSaveReport {
    location: String,
    uri: String,
    bytes: usize,
    sha256: String,
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Keep a backup file name filesystem-safe and force the `.digal` extension.
///
/// The extension is forced rather than preserved: a name that arrives already
/// doubled (`X.digal.json`) must not be able to carry a `.json` extension onto
/// the device, because the importer refuses any file that is not a `.digal`.
fn sanitize_file_name(raw: &str) -> String {
    let stem = raw.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(raw);
    let cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "BHMS-Backup.digal".to_string()
    } else {
        format!("{cleaned}.digal")
    }
}

/// `<db>` → `<db>-wal` / `<db>-shm` (SQLite appends to the full file name).
fn sidecar(path: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    std::path::PathBuf::from(name)
}

/// Save a `.digal` document for the user: Android → MediaStore Downloads via the
/// Kotlin `BackupSaver` plugin (the same route receipts and PDFs use — app-private
/// storage is not readable by other apps); desktop → the Downloads folder.
///
/// iOS is listed separately and refuses (see `crate::media`): the old
/// `not(target_os = "android")` guard also matched iOS, which would have written
/// the backup into the app sandbox and reported it as saved — the one outcome a
/// backup feature must never produce.
#[tauri::command]
pub(crate) async fn save_backup_to_downloads(
    app: tauri::AppHandle,
    content: String,
    file_name: String,
) -> Result<BackupSaveReport, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let state = app.state::<crate::media::BackupSaverHandle>();
        return state
            .0
            .run_mobile_plugin::<BackupSaveReport>(
                "saveBackup",
                serde_json::json!({ "content": content, "fileName": file_name }),
            )
            .map_err(|e| format!("BackupSaver: {e}"));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use sha2::{Digest, Sha256};
        use tauri::Manager;

        let name = sanitize_file_name(&file_name);
        let dir = app
            .path()
            .download_dir()
            .map_err(|e| format!("could not locate Downloads: {e}"))?
            .join("RentEase");
        std::fs::create_dir_all(&dir).map_err(|e| format!("could not create the backup folder: {e}"))?;
        let path = dir.join(&name);
        std::fs::write(&path, content.as_bytes())
            .map_err(|e| format!("could not write the file: {e}"))?;

        // Read it back: the frontend refuses to report success on an unverified
        // file, and it refuses to import a file that is not a `.digal`. Report
        // the name that is really on disk, never the one we asked for, and leave
        // nothing behind if the name came out wrong.
        let stored = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "the saved backup has no usable file name".to_string())?
            .to_string();
        if !stored.ends_with(".digal") {
            let _ = std::fs::remove_file(&path);
            return Err(format!(
                "the backup was saved as \"{stored}\" instead of a .digal file, so it was removed"
            ));
        }
        let written = std::fs::read(&path).map_err(|e| format!("could not re-open the file: {e}"))?;
        Ok(BackupSaveReport {
            location: format!("Downloads/RentEase/{stored}"),
            uri: String::new(),
            bytes: written.len(),
            sha256: hex_lower(&Sha256::digest(&written)),
        })
    }

    #[cfg(target_os = "ios")]
    {
        let _ = (app, content, file_name);
        Err(crate::media::IOS_NO_FILE_WRITER.to_string())
    }
}

/// Offer the saved backup through the Android share sheet (no-op on desktop,
/// which has no share sheet and already put the file in Downloads).
#[tauri::command]
pub(crate) async fn share_backup_file(
    app: tauri::AppHandle,
    uri: String,
    file_name: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let state = app.state::<crate::media::BackupSharerHandle>();
        return state
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "shareBackup",
                serde_json::json!({ "uri": uri, "fileName": file_name }),
            )
            .map_err(|e| format!("BackupSharer: {e}"))
            .map(|_| ());
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = (app, uri, file_name);
        Ok(())
    }

    #[cfg(target_os = "ios")]
    {
        let _ = (app, uri, file_name);
        Err(crate::media::IOS_NO_SHARE_SHEET.to_string())
    }
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Re-validate a backup payload before anything is built from it. The frontend
/// has already validated it; this is the same gate applied to the exact bytes
/// that arrived over IPC (defence in depth).
fn verify_backup_envelope(payload: &str) -> Result<serde_json::Value, String> {
    let envelope: serde_json::Value = serde_json::from_str(payload).map_err(|_| {
        "That file is not a BHMS backup — it isn't valid JSON.".to_string()
    })?;
    let object = envelope
        .as_object()
        .ok_or_else(|| "That file isn't a BHMS backup.".to_string())?;

    if object.get("format").and_then(|v| v.as_str()) != Some(BACKUP_FORMAT) {
        return Err("That file isn't a BHMS backup.".to_string());
    }
    let version = object
        .get("format_version")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "That file isn't a BHMS backup.".to_string())?;
    if version > BACKUP_FORMAT_VERSION {
        return Err(format!(
            "This backup was made by a newer version of BHMS (format v{version}). Update the app, then restore it."
        ));
    }

    let tables = object
        .get("tables")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "This backup is incomplete — its data tables are missing or damaged.".to_string())?;
    // Tables a backup legitimately lacks (it was written before they existed)
    // are restored as empty, not rejected — amenity-billing-spec.md §13,
    // decision #30. A table that is present but malformed is still an error in
    // load_backup_rows below.

    // The checksum covers the canonical (key-sorted) serialization of `tables`.
    // serde_json's Value uses a BTreeMap for objects, so this output is byte-
    // identical to JSON.stringify(canonicalize(tables)) on the TypeScript side.
    let checksum = object
        .get("checksum")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "This backup is damaged — it has no checksum.".to_string())?;
    if checksum.get("algorithm").and_then(|v| v.as_str()) != Some("SHA-256") {
        return Err("This backup is damaged — it has no checksum.".to_string());
    }
    let recorded = checksum
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "This backup is damaged — it has no checksum.".to_string())?;
    let canonical = serde_json::to_string(tables)
        .map_err(|e| format!("could not read the backup payload: {e}"))?;
    let digest = {
        use sha2::{Digest, Sha256};
        Sha256::digest(canonical.as_bytes())
    };
    if !hex_lower(&digest).eq_ignore_ascii_case(recorded) {
        return Err(
            "This backup file is damaged or incomplete (checksum mismatch). Try another copy."
                .to_string(),
        );
    }

    Ok(envelope)
}

/// One backup value → one SQLite value (BLOB is the `{ "__b64__": … }` marker).
fn json_to_sqlite(value: &serde_json::Value) -> Result<rusqlite::types::Value, String> {
    use rusqlite::types::Value as SqlValue;
    match value {
        serde_json::Value::Null => Ok(SqlValue::Null),
        serde_json::Value::Bool(b) => Ok(SqlValue::Integer(if *b { 1 } else { 0 })),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(SqlValue::Integer(i))
            } else if let Some(u) = n.as_u64() {
                Ok(SqlValue::Integer(i64::try_from(u).unwrap_or(i64::MAX)))
            } else {
                Ok(SqlValue::Real(n.as_f64().unwrap_or(0.0)))
            }
        }
        serde_json::Value::String(s) => Ok(SqlValue::Text(s.clone())),
        serde_json::Value::Object(o) => {
            use base64::Engine;
            let encoded = o
                .get("__b64__")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Unsupported value in the backup.".to_string())?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|e| format!("damaged binary value in the backup: {e}"))?;
            Ok(SqlValue::Blob(bytes))
        }
        serde_json::Value::Array(_) => Err("Unsupported value in the backup.".to_string()),
    }
}

fn table_columns(conn: &rusqlite::Connection, table: &str) -> Result<Vec<String>, String> {
    let sql = format!("SELECT name FROM pragma_table_info('{}')", table.replace('\'', "''"));
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(names)
}

/// Load the backup's rows into the freshly migrated database.
///
/// Triggers are dropped for the load and recreated verbatim afterwards: the
/// rows were already validated by those same guards in the source database, and
/// some legal states cannot be replayed step by step (a tenant living in a room
/// that has since been flagged `maintenance = 1`, for example). This only ever
/// happens inside the private rebuild file — the live database keeps its guards
/// at all times — and the finished database is verified before it is swapped in.
fn load_backup_rows(
    conn: &rusqlite::Connection,
    tables: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let mut trigger_stmt = conn
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let triggers: Vec<(String, String)> = trigger_stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(trigger_stmt);

    for (name, _) in &triggers {
        conn.execute_batch(&format!("DROP TRIGGER IF EXISTS {}", quote_ident(name)))
            .map_err(|e| format!("could not prepare the restore: {e}"))?;
    }
    conn.execute_batch("PRAGMA foreign_keys = OFF")
        .map_err(|e| e.to_string())?;

    // The migration chain seeds rows (the settings defaults); a backup is the
    // authority for those tables, so clear them before loading. Children first.
    for table in BACKUP_TABLES.iter().rev() {
        conn.execute_batch(&format!("DELETE FROM {}", quote_ident(table)))
            .map_err(|e| format!("could not clear the {table} table: {e}"))?;
    }

    for table in BACKUP_TABLES {
        // Older backups simply do not carry every table (spec §13): treat an
        // absent payload as an empty table instead of failing the restore.
        let Some(payload) = tables.get(table) else {
            continue;
        };
        let rows = payload
            .get("rows")
            .and_then(|v| v.as_array())
            .ok_or_else(|| format!("This backup is incomplete — {table} is missing or damaged."))?;
        let columns: Vec<String> = payload
            .get("columns")
            .and_then(|v| v.as_array())
            .map(|c| {
                c.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .ok_or_else(|| format!("This backup is incomplete — {table} is missing or damaged."))?;
        let declared = payload.get("row_count").and_then(|v| v.as_u64());
        if declared != Some(rows.len() as u64) {
            return Err(format!("This backup is incomplete — {table} is missing or damaged."));
        }
        if rows.is_empty() {
            continue;
        }

        // Drop columns this build no longer has (e.g. a pre-075 backup's
        // amenity_type) instead of refusing the file; columns the backup lacks
        // take their schema defaults. Both are required by spec §13.
        let live = table_columns(conn, table)?;
        let columns: Vec<String> = columns
            .into_iter()
            .filter(|column| live.iter().any(|c| c == column))
            .collect();
        if columns.is_empty() {
            continue;
        }

        let names = columns
            .iter()
            .map(|c| quote_ident(c))
            .collect::<Vec<_>>()
            .join(", ");
        let placeholders = columns
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT INTO {} ({names}) VALUES ({placeholders})",
            quote_ident(table)
        );
        let mut insert = conn
            .prepare(&sql)
            .map_err(|e| format!("could not prepare the {table} insert: {e}"))?;
        for (index, row) in rows.iter().enumerate() {
            let row = row.as_object().ok_or_else(|| {
                format!("This backup is incomplete — {table} is missing or damaged.")
            })?;
            let values = columns
                .iter()
                .map(|column| {
                    let raw = row.get(column).unwrap_or(&serde_json::Value::Null);
                    json_to_sqlite(raw)
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("{e} ({table} row {})", index + 1))?;
            insert
                .execute(rusqlite::params_from_iter(values.iter()))
                .map_err(|e| format!("could not restore {table} row {}: {e}", index + 1))?;
        }
    }

    for (_, sql) in &triggers {
        conn.execute_batch(sql)
            .map_err(|e| format!("could not restore the database guards: {e}"))?;
    }

    for table in BACKUP_AUTOINCREMENT_TABLES {
        let max: i64 = conn
            .query_row(
                &format!("SELECT COALESCE(MAX(id), 0) FROM {}", quote_ident(table)),
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        conn.execute("DELETE FROM sqlite_sequence WHERE name = ?1", [table])
            .map_err(|e| e.to_string())?;
        if max > 0 {
            conn.execute(
                "INSERT INTO sqlite_sequence (name, seq) VALUES (?1, ?2)",
                rusqlite::params![table, max],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// The restored database must be healthy before it replaces the live one.
fn verify_database(conn: &rusqlite::Connection) -> Result<(), String> {
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        return Err("The backup failed SQLite's integrity check.".to_string());
    }
    let mut stmt = conn
        .prepare("PRAGMA foreign_key_check")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    if rows.next().map_err(|e| e.to_string())?.is_some() {
        return Err("The backup failed a foreign-key check (rows reference missing records)."
            .to_string());
    }
    Ok(())
}

/// Build a fresh database from the migration chain and load the backup's rows.
fn build_database_from_backup(
    tmp_path: &std::path::Path,
    tables: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let conn = rusqlite::Connection::open(tmp_path)
        .map_err(|e| format!("could not create the restore file: {e}"))?;
    for migration in migrations() {
        conn.execute_batch(migration.sql)
            .map_err(|e| format!("could not build the schema (v{}): {e}", migration.version))?;
    }

    // Record the chain in sqlx's ledger as part of building the database.
    //
    // Without this the restored file has the whole schema but no ledger, so the
    // *next launch* reads it as a first run, re-applies from version 1, and dies
    // on 006's `ALTER TABLE tenants ADD COLUMN last_paid_date` with "duplicate
    // column name" — leaving the app unable to open its own data. The restore
    // appears to succeed and the damage only shows up after a restart, which is
    // the worst shape a bug like this can have.
    crate::migrations_repair::seed_ledger(&conn)?;

    load_backup_rows(&conn, tables)?;
    verify_database(&conn)
}

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
enum SwapBlocked {
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
fn swap_database_file(
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
fn swap_with_retry(db_path: &std::path::Path, tmp_path: &std::path::Path) -> Result<(), SwapBlocked> {
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
fn install_in_place(
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
fn install_backup(app: &tauri::AppHandle, payload: &str) -> Result<RestoreReport, String> {
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

/// What a restore needs before it is worth starting.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestorePreflight {
    can_write_directory: bool,
    can_read_database: bool,
    /// A plain-language reason, when something is wrong.
    reason: Option<String>,
}

/// The state of the live database, as the startup guard sees it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseState {
    database_present: bool,
    /// Whether this install has opened its database before.
    has_run_before: bool,
    latest_safety_copy: Option<String>,
}

/// Folder holding the app's own copies of the pre-restore safety backups.
fn safety_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("safety"))
}

/// Marker proving the app has opened its database at least once, which is what
/// separates "this install lost its database" from "this is a first launch".
fn marker_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(".initialised"))
}

/// Newest safety backup in the app's own folder, by modification time.
fn newest_safety_copy(app: &tauri::AppHandle) -> Result<Option<std::path::PathBuf>, String> {
    let dir = safety_dir(app)?;
    if !dir.is_dir() {
        return Ok(None);
    }
    let mut newest: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("digal") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        if newest.as_ref().map(|(at, _)| modified > *at).unwrap_or(true) {
            newest = Some((modified, path));
        }
    }
    Ok(newest.map(|(_, path)| path))
}

/// Check the minimum conditions a restore needs, **before** the safety copy is
/// written, so an impossible restore is refused without touching anything.
///
/// Deliberately does not try to guess whether another program is holding the
/// file: this process still has the database open at this point, so the
/// question cannot be answered here — and it no longer matters, because a held
/// file now sends the restore down the in-place path instead.
#[tauri::command]
pub(crate) async fn restore_preflight(app: tauri::AppHandle) -> Result<RestorePreflight, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = database_path(&app)?;
        let dir = db_path
            .parent()
            .ok_or_else(|| "could not locate the app's data folder".to_string())?;

        // Probing by creating and removing a file is the only reliable way to
        // know the folder is writable; the file itself is gone immediately.
        let probe = dir.join(".restore-probe");
        let can_write_directory = match std::fs::write(&probe, b"probe") {
            Ok(()) => {
                let _ = std::fs::remove_file(&probe);
                true
            }
            Err(_) => false,
        };

        let can_read_database = if db_path.exists() {
            std::fs::File::open(&db_path).is_ok()
        } else {
            // A first-time restore has no database to read yet.
            true
        };

        let reason = if !can_write_directory {
            Some(
                "RentEase cannot write to its own data folder, so it cannot replace your data. \
                 Check that the folder is not read-only, then try again."
                    .to_string(),
            )
        } else if !can_read_database {
            Some(
                "Your RentEase data file cannot be opened, so a restore cannot start. \
                 Restart RentEase, then try again."
                    .to_string(),
            )
        } else {
            None
        };

        Ok(RestorePreflight {
            can_write_directory,
            can_read_database,
            reason,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Keep a copy of the pre-restore safety backup inside the app's own data
/// folder, so recovering never depends on finding or picking a file.
#[tauri::command]
pub(crate) async fn save_safety_copy(
    app: tauri::AppHandle,
    content: String,
    file_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = sanitize_file_name(&file_name);
        let dir = safety_dir(&app)?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("could not create the safety folder: {e}"))?;
        let path = dir.join(&name);
        std::fs::write(&path, content.as_bytes())
            .map_err(|e| format!("could not write the safety copy: {e}"))?;
        // Read it back: an unverified safety copy is worse than none, because it
        // is what a recovery would trust.
        let written = std::fs::read(&path)
            .map_err(|e| format!("could not re-open the safety copy: {e}"))?;
        if written.len() != content.len() {
            return Err("the safety copy was written incompletely".to_string());
        }
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// How the startup guard should treat the current database.
#[tauri::command]
pub(crate) async fn database_state(app: tauri::AppHandle) -> Result<DatabaseState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(DatabaseState {
            database_present: database_path(&app)?.exists(),
            // A database still sitting in the pre-rename folder counts as "has
            // run before" even though this folder has never seen a marker. The
            // identifier rename moves `app_config_dir()`, and both the marker and
            // the database move with it — so without this the guard would read
            // the pair as a first launch and open an empty app.
            has_run_before: marker_path(&app)?.exists() || crate::db::legacy_database_stranded(&app),
            latest_safety_copy: newest_safety_copy(&app)?
                .map(|path| path.to_string_lossy().to_string()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Record that this install has opened its database. Written once, after the
/// first successful open, so a later missing database can be recognised.
#[tauri::command]
pub(crate) async fn mark_database_initialised(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = marker_path(&app)?;
        std::fs::write(&path, b"initialised").map_err(|e| format!("could not write {path:?}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Put the newest safety copy back, for the recovery screen shown when the live
/// database has gone missing. Reuses the ordinary restore pipeline, so it is
/// subject to the same validation and the same always-succeeds guarantee.
#[tauri::command]
pub(crate) async fn restore_safety_copy(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = newest_safety_copy(&app)?
            .ok_or_else(|| "There is no safety copy to restore.".to_string())?;
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("could not read {}: {e}", path.display()))?;
        install_backup(&app, &text).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh temp directory, so parallel tests never share a database file.
    fn unique_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rentease-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A real SQLite file, because the swap checkpoints the live database.
    fn sqlite_file(path: &std::path::Path, sql: &str) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch(sql).unwrap();
    }

    fn rooms_payload(rooms: &[(i64, &str)]) -> serde_json::Value {
        let rows: Vec<serde_json::Value> = rooms
            .iter()
            .map(|(id, number)| {
                serde_json::json!({
                    "id": id,
                    "room_number": number,
                    "capacity": 2,
                    "monthly_rate": 2500,
                    "status": "Vacant",
                    "maintenance": 0,
                })
            })
            .collect();
        serde_json::json!({
            "columns": ["id", "room_number", "capacity", "monthly_rate", "status", "maintenance"],
            "row_count": rows.len(),
            "rows": rows,
        })
    }

    fn tables(rooms: &[(i64, &str)]) -> serde_json::Map<String, serde_json::Value> {
        let mut map = serde_json::Map::new();
        map.insert("rooms".to_string(), rooms_payload(rooms));
        map
    }

    fn room_numbers(db: &std::path::Path) -> Vec<String> {
        let conn = rusqlite::Connection::open(db).unwrap();
        let mut stmt = conn
            .prepare("SELECT room_number FROM rooms ORDER BY id")
            .unwrap();
        stmt.query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    fn marker(db: &std::path::Path) -> String {
        let conn = rusqlite::Connection::open(db).unwrap();
        conn.query_row("SELECT x FROM marker", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn keeps_a_canonical_backup_name() {
        assert_eq!(
            sanitize_file_name("BHMS-Backup-2026-09-14.digal"),
            "BHMS-Backup-2026-09-14.digal"
        );
        assert_eq!(
            sanitize_file_name("BHMS-Backup-2026-09-14-before-restore.digal"),
            "BHMS-Backup-2026-09-14-before-restore.digal"
        );
    }

    #[test]
    fn forces_the_digal_extension() {
        // A name that arrives already doubled must not carry `.json` through:
        // the importer would refuse the file the app had just written.
        assert_eq!(sanitize_file_name("X.digal.json"), "X_digal.digal");
        assert_eq!(sanitize_file_name("backup.json"), "backup.digal");
        assert_eq!(sanitize_file_name("backup"), "backup.digal");
        assert!(!sanitize_file_name("X.digal.json").ends_with(".json"));
    }

    #[test]
    fn falls_back_when_nothing_usable_is_left() {
        assert_eq!(sanitize_file_name(""), "BHMS-Backup.digal");
        assert_eq!(sanitize_file_name("."), "BHMS-Backup.digal");
    }

    #[test]
    fn replaces_unsafe_characters() {
        assert_eq!(sanitize_file_name("a/b c.digal"), "a_b_c.digal");
    }

    #[test]
    fn the_swap_replaces_the_database_and_only_then_clears_the_journal() {
        let dir = unique_dir("swap");
        let db = dir.join("boarding-house.db");
        let tmp = dir.join("boarding-house.db.rebuild.tmp");
        sqlite_file(&db, "CREATE TABLE marker(x); INSERT INTO marker VALUES('old');");
        sqlite_file(&tmp, "CREATE TABLE marker(x); INSERT INTO marker VALUES('new');");
        std::fs::write(dir.join("boarding-house.db-wal"), b"stale journal").unwrap();
        std::fs::write(dir.join("boarding-house.db-shm"), b"stale shm").unwrap();

        assert!(swap_database_file(&db, &tmp).is_ok());
        assert_eq!(marker(&db), "new");
        assert!(!tmp.exists(), "the rebuilt file is consumed by the rename");
        // A stale non-empty journal beside the new database would corrupt it.
        assert!(!dir.join("boarding-house.db-wal").exists());
        assert!(!dir.join("boarding-house.db-shm").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The reported failure: another process holding the database open.
    ///
    /// Windows refuses to replace a file that is open without sharing, which is
    /// exactly what a second copy of the app does. The swap must report that as
    /// *unavailable* — never as unsafe — and must leave the live database alone
    /// so the in-place path can take over.
    #[cfg(windows)]
    #[test]
    fn a_held_open_database_blocks_the_swap_and_is_left_untouched() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = unique_dir("locked");
        let db = dir.join("boarding-house.db");
        let tmp = dir.join("boarding-house.db.rebuild.tmp");
        sqlite_file(&db, "CREATE TABLE marker(x); INSERT INTO marker(x) VALUES('old');");
        sqlite_file(&tmp, "CREATE TABLE marker(x); INSERT INTO marker(x) VALUES('new');");

        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&db)
            .unwrap();

        assert!(
            matches!(swap_database_file(&db, &tmp), Err(SwapBlocked::Unavailable(_))),
            "a held-open database must be reported as unavailable, not unsafe"
        );
        // Release the lock to prove the live database survived the attempt.
        drop(held);
        assert_eq!(marker(&db), "old", "the live database must be untouched");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_in_place_fallback_replaces_the_rows() {
        let dir = unique_dir("inplace");
        let db = dir.join("boarding-house.db");
        // A real database built from this build's own migration chain.
        build_database_from_backup(&db, &serde_json::Map::new()).unwrap();

        install_in_place(&db, &tables(&[(1, "Old Room")])).unwrap();
        assert_eq!(room_numbers(&db), vec!["Old Room"]);

        // The imported file becomes the data: a full replace, not a merge.
        install_in_place(&db, &tables(&[(7, "Imported Room")])).unwrap();
        assert_eq!(room_numbers(&db), vec!["Imported Room"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_failed_in_place_restore_rolls_back_and_leaves_the_data_untouched() {
        let dir = unique_dir("rollback");
        let db = dir.join("boarding-house.db");
        build_database_from_backup(&db, &serde_json::Map::new()).unwrap();
        install_in_place(&db, &tables(&[(1, "Keep Me")])).unwrap();

        // The second row carries a value the format cannot express, so the
        // insert loop fails *after* the first row has already been written.
        let mut broken = tables(&[(2, "Lands Then Rolls Back")]);
        broken["rooms"]["rows"].as_array_mut().unwrap().push(serde_json::json!({
            "id": 3,
            "room_number": ["not", "text"],
            "capacity": 2,
            "monthly_rate": 1,
            "status": "Vacant",
            "maintenance": 0,
        }));
        broken["rooms"]["row_count"] = serde_json::json!(2);

        assert!(install_in_place(&db, &broken).is_err());
        assert_eq!(
            room_numbers(&db),
            vec!["Keep Me"],
            "a failed restore must leave the previous data exactly as it was"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
