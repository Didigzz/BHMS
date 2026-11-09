//! Building the restored database: schema, row load, integrity checks.

use crate::migrations::migrations;

use super::{BACKUP_AUTOINCREMENT_TABLES, BACKUP_TABLES};

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
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
pub(super) fn load_backup_rows(
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
pub(super) fn verify_database(conn: &rusqlite::Connection) -> Result<(), String> {
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
pub(super) fn build_database_from_backup(
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
