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


/// Format marker of a `.digal` backup (mirrors FORMAT in backup-format.ts).
const BACKUP_FORMAT: &str = "bhms-backup";
/// Highest envelope version this build understands (mirrors FORMAT_VERSION).
const BACKUP_FORMAT_VERSION: i64 = 1;
/// Tables every backup must carry, in insert order (parents before children).
///
/// Also the definition of "this database has the app's schema", used by
/// `migrations_repair::schema_is_complete` to tell a restored database (schema
/// present, ledger missing) from a fresh one.
pub(crate) const BACKUP_TABLES: [&str; 10] = [
    "rooms",
    "tenants",
    "payments",
    "reservations",
    "settings",
    "notifications_log",
    "amenity_bills",
    "amenity_bill_tenants",
    "amenity_bill_rooms",
    // Last: its bill_tenant_id parent must exist before the rows load.
    "amenity_payments",
];
/// Tables whose AUTOINCREMENT counters are restored from MAX(id).
const BACKUP_AUTOINCREMENT_TABLES: [&str; 9] = [
    "rooms",
    "tenants",
    "payments",
    "reservations",
    "notifications_log",
    "amenity_bills",
    "amenity_bill_tenants",
    "amenity_bill_rooms",
    "amenity_payments",
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

mod envelope;
mod install;
mod safety;
mod snapshot;
#[cfg(test)]
mod tests;

pub(crate) use install::install_backup_file;
pub(crate) use safety::{
    database_state, mark_database_initialised, restore_preflight, restore_safety_copy,
    save_safety_copy,
};

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
