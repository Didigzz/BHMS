use super::install::{install_in_place, swap_database_file, SwapBlocked};
use super::snapshot::build_database_from_backup;
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
