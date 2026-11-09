//! Safety copies, preflight checks and the missing-database startup guard.

use crate::db::database_path;

use super::install::install_backup;
use super::sanitize_file_name;

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
