//! Where the live SQLite database lives.
//!
//! Three separate Rust call sites need this path — the migration self-heal, the
//! backup restore swap, and amenity billing's own `rusqlite` connection — and
//! all of them must resolve it exactly as `tauri-plugin-sql` does, or they
//! would open a different file than the app is using. It lives here once.
//!
//! It also owns the one-time move of an existing install into the new folder.
//! The bundle identifier is the *name of that folder*, so renaming the app
//! (`com.rentease.app` → `com.digal.rentease`, done so Apple builds stop
//! colliding with the reserved `.app` bundle extension) silently relocates
//! `app_config_dir()`. The database, the `.initialised` marker and the
//! `safety/` folder all live in there, so without this migration the startup
//! guard would see *both* "no database" and "never ran before" and open a
//! brand-new empty app — which looks exactly like the landlord's data having
//! vanished. That is the single failure mode this whole module exists to stop.

/// File name of the database inside `app_config_dir()` (the name the sql plugin
/// is registered with in `run()`).
const DATABASE_FILE_NAME: &str = "boarding-house.db";

/// The identifier this app used before it was renamed for the Apple targets.
/// Its folder is the previous install's home.
///
/// Only the desktop `legacy_config_dir` reads this — mobile identifies its
/// sandbox by package name, so on Android and iOS there is nothing to migrate
/// and the constant is deliberately unused.
#[cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]
const LEGACY_IDENTIFIER: &str = "com.rentease.app";

/// Absolute path of the live database (same resolution the sql plugin uses).
pub(crate) fn database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(DATABASE_FILE_NAME))
}

/// The pre-rename folder for this platform, whether or not it exists.
///
/// `app_config_dir()` is `config_dir()/<identifier>` on every desktop platform
/// — `%APPDATA%` on Windows, `Application Support` on macOS, `~/.config` on
/// Linux — so the previous install is simply the same parent with the old
/// identifier. Mobile returns `None`: Android identifies its sandbox by package
/// name (unchanged by this rename), and there is no prior iOS install.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn legacy_config_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path()
        .config_dir()
        .ok()
        .map(|dir| dir.join(LEGACY_IDENTIFIER))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn legacy_config_dir(_app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    None
}

/// Is there a database in the old folder that the new folder does not have?
///
/// True means an install is sitting in the old location and has not been picked
/// up. The startup guard treats it as "this install has run before", so a failed
/// or skipped migration shows the recovery screen instead of a plausible-looking
/// empty app.
pub(crate) fn legacy_database_stranded(app: &tauri::AppHandle) -> bool {
    let Some(legacy) = legacy_config_dir(app) else {
        return false;
    };
    if !legacy.join(DATABASE_FILE_NAME).is_file() {
        return false;
    }
    // Once the new folder has its own database the old one is just a leftover.
    !matches!(database_path(app), Ok(current) if current.is_file())
}

/// Copy anything the new folder is missing from the old one, one time.
///
/// Returns the folder it migrated from, or `None` when there was nothing to do
/// (a fresh install, or one already migrated). The old folder is **read only and
/// never deleted** — it stays behind as the safety net a worried landlord can
/// point at, and deleting it is not this code's call to make.
///
/// Existing files in the new folder always win, so re-running is harmless.
///
/// The whole folder is copied rather than just `boarding-house.db`, because the
/// meaningful parts are siblings: the `-wal` file holds commits that have not
/// been checkpointed into the database yet (dropping it would silently lose the
/// most recent work), and `.initialised` plus `safety/` are what the recovery
/// screen needs to prove an earlier install existed and to restore it.
pub(crate) fn migrate_legacy_config_dir(
    app: &tauri::AppHandle,
) -> Result<Option<std::path::PathBuf>, String> {
    use tauri::Manager;

    let Some(legacy) = legacy_config_dir(app) else {
        return Ok(None);
    };
    if !legacy.join(DATABASE_FILE_NAME).is_file() {
        return Ok(None);
    }

    let current = app.path().app_config_dir().map_err(|e| e.to_string())?;
    if current.join(DATABASE_FILE_NAME).is_file() {
        return Ok(None);
    }

    copy_missing(&legacy, &current).map_err(|e| {
        format!(
            "RentEase found your data in {} but could not move it to {}: {e}. \
             Your original file has not been touched.",
            legacy.display(),
            current.display()
        )
    })?;

    // Prove the copy is usable before claiming victory: the app must not come up
    // acting as though there is nothing in the new folder.
    if !current.join(DATABASE_FILE_NAME).is_file() {
        return Err(format!(
            "RentEase could not copy {DATABASE_FILE_NAME} out of {}. \
             Your original file has not been touched.",
            legacy.display()
        ));
    }

    Ok(Some(legacy))
}

/// Recursively copy `from` into `to`, never overwriting what is already there.
fn copy_missing(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_missing(&entry.path(), &target)?;
        } else if !target.exists() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_missing_is_recursive_and_never_overwrites() {
        let root = std::env::temp_dir().join(format!("rentease-copy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let from = root.join("from");
        let to = root.join("to");
        std::fs::create_dir_all(from.join("safety")).unwrap();
        std::fs::write(from.join(DATABASE_FILE_NAME), b"old").unwrap();
        std::fs::write(from.join(DATABASE_FILE_NAME).with_extension("db-wal"), b"wal").unwrap();
        std::fs::write(from.join(".initialised"), b"initialised").unwrap();
        std::fs::write(from.join("safety").join("copy.digal"), b"{}").unwrap();

        // A file the new folder already has must survive untouched.
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(to.join(".initialised"), b"newer").unwrap();

        copy_missing(&from, &to).unwrap();

        assert_eq!(
            std::fs::read(to.join(DATABASE_FILE_NAME)).unwrap(),
            b"old",
            "the database is carried across"
        );
        assert_eq!(
            std::fs::read(to.join(DATABASE_FILE_NAME).with_extension("db-wal")).unwrap(),
            b"wal",
            "an uncheckpointed WAL is carried across, or commits are lost"
        );
        assert_eq!(
            std::fs::read(to.join(".initialised")).unwrap(),
            b"newer",
            "an existing file is never overwritten"
        );
        assert_eq!(
            std::fs::read(to.join("safety").join("copy.digal")).unwrap(),
            b"{}",
            "nested folders are copied"
        );

        // Idempotent: a second pass changes nothing.
        std::fs::write(to.join(DATABASE_FILE_NAME), b"edited").unwrap();
        copy_missing(&from, &to).unwrap();
        assert_eq!(std::fs::read(to.join(DATABASE_FILE_NAME)).unwrap(), b"edited");

        let _ = std::fs::remove_dir_all(&root);
    }
}
