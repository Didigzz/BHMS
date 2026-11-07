//! Two ledger self-heals for databases this build did not write.
//!
//! 1. **Checksums** — sqlx records a SHA-384 digest of every migration's SQL and
//!    refuses to open a database whose digest no longer matches the SQL embedded
//!    in this binary. Rewriting them keeps a database from an older build usable.
//! 2. **A ledger that is missing or behind the schema** — see `seed_ledger` and
//!    `ledger_is_behind_the_schema`. This is the repair for databases built by the
//!    restore path, which used to produce a complete schema with no ledger at all.

use crate::db::database_path;
use crate::migrations::migrations;

/// Record every migration this build ships as applied, as far as the ledger is
/// concerned.
///
/// sqlx keeps its own ledger (`_sqlx_migrations`) and refuses to open a database
/// whose ledger disagrees with the SQL embedded in this binary. A database built
/// by the restore path has the *whole* schema but **no ledger** — so the next
/// launch looks like a first run, re-applies from version 1, and dies on the
/// first non-idempotent migration: 006 does `ALTER TABLE tenants ADD COLUMN
/// last_paid_date`, which fails with "duplicate column name" against a schema that
/// already has it. sqlx then returns an error, `Database.load` rejects, and the
/// app cannot open its own data at all — with the data sitting there intact, which
/// makes it look like everything was lost.
///
/// `INSERT OR IGNORE` makes this safe over a partial ledger, which is exactly the
/// state a launch that died this way leaves behind.
pub(crate) fn seed_ledger(conn: &rusqlite::Connection) -> Result<usize, String> {
    use sha2::{Digest, Sha384};

    // The schema sqlx creates for itself, so it recognises the table as its own.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN NOT NULL,
            checksum BLOB NOT NULL,
            execution_time BIGINT NOT NULL
        )",
    )
    .map_err(|e| e.to_string())?;

    let mut inserted = 0usize;
    for m in migrations() {
        let digest: Vec<u8> = Sha384::digest(m.sql.as_bytes()).to_vec();
        inserted += conn
            .execute(
                "INSERT OR IGNORE INTO _sqlx_migrations
                   (version, description, success, checksum, execution_time)
                 VALUES (?1, ?2, 1, ?3, 0)",
                rusqlite::params![m.version, m.description, digest],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(inserted)
}

/// Does this migration's SQL create `table`?
///
/// Matched loosely on purpose: the migrations are hand-written, so the spelling
/// varies (`CREATE TABLE rooms`, `CREATE TABLE IF NOT EXISTS "rooms"`). Quotes,
/// parentheses and newlines are flattened away and the result lower-cased before
/// substring-matching. A miss is not dangerous — it only means that table
/// contributes no floor to the check below — and `every_backup_table_has_an_origin`
/// fails loudly if a rename ever breaks the match.
fn creates_table(sql: &str, table: &str) -> bool {
    let flat: String = sql
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c.to_ascii_lowercase() } else { ' ' })
        .collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.contains(&format!("create table if not exists {table}"))
        || flat.contains(&format!("create table {table}"))
}

/// Which migration version first creates each of the app's tables.
///
/// Derived from the chain rather than hard-coded, so a new migration or a
/// renumbered file cannot silently invalidate it.
fn table_origins() -> Vec<(&'static str, i64)> {
    let chain = migrations();
    crate::backup::BACKUP_TABLES
        .iter()
        .filter_map(|table| {
            chain
                .iter()
                .find(|m| creates_table(&m.sql, table))
                .map(|m| (*table, m.version))
        })
        .collect()
}

fn table_exists(conn: &rusqlite::Connection, table: &str) -> Result<bool, String> {
    conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1")
        .map_err(|e| e.to_string())?
        .exists(rusqlite::params![table])
        .map_err(|e| e.to_string())
}

/// Does this database already carry the app's full schema?
///
/// Used only to answer "is this a fresh database, or one that is missing its
/// ledger?" — a database with none of the tables must be left for sqlx to apply
/// from scratch.
fn schema_is_complete(conn: &rusqlite::Connection) -> Result<bool, String> {
    for table in crate::backup::BACKUP_TABLES {
        if !table_exists(conn, table)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Is the ledger behind the schema it is supposed to describe?
///
/// True when the database already contains a table whose creating migration the
/// ledger does not list. That is the signature of a restored database: the schema
/// is at the head of the chain while the ledger claims only a handful of
/// migrations. It is `false` for the ordinary upgrade case — an older database
/// has the *older* schema and a ledger to match, so `migration > ledger_max` and
/// the table simply is not there yet, and sqlx applies the new migrations itself.
///
/// Being precise here matters in both directions. Too eager and a genuine upgrade
/// gets skipped, silently leaving a column missing; too shy and the app cannot
/// open at all. Comparing each present table against the migration that creates
/// it is what separates the two without a threshold.
fn ledger_is_behind_the_schema(
    conn: &rusqlite::Connection,
    ledger_max: i64,
) -> Result<bool, String> {
    for (table, version) in table_origins() {
        if version > ledger_max && table_exists(conn, table)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Self-heal for the "migration N was previously applied but has been modified"
/// failure. tauri-plugin-sql (sqlx) records a SHA-384 checksum of every
/// migration's SQL in `_sqlx_migrations` and refuses to open the database when
/// an applied migration no longer matches the SQL embedded in this binary — a
/// database created by an older build bricks every page. The mismatch is pure
/// bookkeeping: the schema was already applied and is unchanged by the rewrite,
/// so we update the recorded checksums to match what this build ships.
///
/// Safety note: this is only sound because migration edits are expected to be
/// cosmetic/idempotent (e.g. adding IF NOT EXISTS), per the "never edit an
/// applied migration" discipline — the schema actually applied to the database
/// is the source of truth. A non-cosmetic edit to an applied migration would
/// boot, but queries against the new schema would fail at runtime, so keep
/// schema changes in new migration versions instead. A `success = 0` (dirty)
/// row is a different sqlx failure and is NOT repaired here.
///
/// The frontend calls this (see src/lib/db.ts) BEFORE the sql plugin opens the
/// database, so the plugin's validation always sees matching checksums.
#[tauri::command]
pub(crate) fn repair_migrations(app: tauri::AppHandle) -> Result<usize, String> {
    use rusqlite::Connection;
    use sha2::{Digest, Sha384};

    // Same resolution the sql plugin uses: app_config_dir() + "boarding-house.db".
    let db_path = database_path(&app)?;
    if !db_path.exists() {
        // Fresh install — the plugin creates the file and applies everything.
        return Ok(0);
    }

    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let ledger_max: Option<i64> = if table_exists(&conn, "_sqlx_migrations")? {
        conn.query_row("SELECT MAX(version) FROM _sqlx_migrations", [], |row| {
            row.get::<_, Option<i64>>(0)
        })
        .map_err(|e| e.to_string())?
    } else {
        None
    };

    let mut seeded = 0usize;
    match ledger_max {
        // No ledger at all: only heal it if the schema is genuinely here, or a
        // fresh database would be recorded as fully applied and created empty.
        None => {
            if schema_is_complete(&conn)? {
                seeded = seed_ledger(&conn)?;
            }
        }
        // A ledger that exists but disagrees with the schema it describes.
        Some(max) => {
            if ledger_is_behind_the_schema(&conn, max)? {
                seeded = seed_ledger(&conn)?;
            }
        }
    }

    let mut applied = conn
        .prepare("SELECT version, checksum FROM _sqlx_migrations WHERE success = 1")
        .map_err(|e| e.to_string())?;
    let rows = applied
        .query_map(rusqlite::params![], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut fixed = 0usize;
    for m in migrations() {
        let Some((_, stored)) = rows.iter().find(|(version, _)| *version == m.version) else {
            continue; // Not applied yet — the plugin applies it on this run.
        };
        let digest: Vec<u8> = Sha384::digest(m.sql.as_bytes()).to_vec();
        if *stored != digest {
            conn.execute(
                "UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = ?2",
                rusqlite::params![digest.as_slice(), m.version],
            )
            .map_err(|e| e.to_string())?;
            fixed += 1;
            eprintln!(
                "repair_migrations: rewrote checksum for migration {} ({})",
                m.version, m.description
            );
        }
    }
    Ok(seeded + fixed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build an in-memory database with the whole chain applied and, optionally,
    /// a ledger — the two shapes this module has to tell apart.
    fn database_from_chain() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        for m in migrations() {
            conn.execute_batch(m.sql)
                .unwrap_or_else(|e| panic!("migration {} failed: {e}", m.version));
        }
        conn
    }

    #[test]
    fn every_backup_table_has_an_origin() {
        // If a migration is renamed so `creates_table` stops matching, the floor
        // would silently lose a table and the heal could miss the case it exists
        // for. Fail loudly instead.
        let origins = table_origins();
        assert_eq!(
            origins.len(),
            crate::backup::BACKUP_TABLES.len(),
            "every BACKUP_TABLE must be traceable to a migration, found {origins:?}"
        );
        for (table, version) in origins {
            assert!(version >= 1, "{table} has no plausible origin version");
        }
    }

    #[test]
    fn seed_ledger_records_every_migration_and_is_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let total = migrations().len();

        assert_eq!(seed_ledger(&conn).unwrap(), total, "every migration recorded");
        let applied: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(applied as usize, total, "all rows are marked successful");

        // A second pass must not duplicate anything — the state a retry leaves.
        assert_eq!(seed_ledger(&conn).unwrap(), 0, "nothing new to insert");
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM _sqlx_migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows as usize, total, "still exactly one row per migration");
    }

    #[test]
    fn a_database_built_from_the_chain_is_recognised_as_complete() {
        assert!(schema_is_complete(&database_from_chain()).unwrap());
    }

    #[test]
    fn an_empty_database_is_not_complete() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        assert!(!schema_is_complete(&conn).unwrap());
        conn.execute_batch("CREATE TABLE rooms(x INTEGER);").unwrap();
        assert!(
            !schema_is_complete(&conn).unwrap(),
            "one table is not the whole schema"
        );
    }

    #[test]
    fn a_ledger_that_stops_short_of_the_schema_is_detected() {
        // The real failure: a restored database whose launch died at 006, leaving
        // a partial ledger behind. The schema is complete, so the ledger is lying.
        let conn = database_from_chain();
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY, description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL, checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            );
            INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
            VALUES (1,'a',1,x'00',0),(2,'b',1,x'00',0),(3,'c',1,x'00',0),
                   (4,'d',1,x'00',0),(5,'e',1,x'00',0);",
        )
        .unwrap();

        assert!(
            ledger_is_behind_the_schema(&conn, 5).unwrap(),
            "5 of 75 applied against a complete schema must be treated as a broken ledger"
        );

        // Seeding fixes it, and the result is a ledger up to the head of the chain.
        seed_ledger(&conn).unwrap();
        let max: i64 = conn
            .query_row("SELECT MAX(version) FROM _sqlx_migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(max, migrations().last().unwrap().version);
        assert!(!ledger_is_behind_the_schema(&conn, max).unwrap());
    }

    #[test]
    fn an_ordinary_upgrade_is_left_to_sqlx() {
        // A database one migration behind, with a ledger to match, must NOT be
        // seeded: migration 75 would then never run. This is the case that makes
        // the check worth deriving rather than guessing.
        let conn = database_from_chain();
        conn.execute_batch("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY);")
            .unwrap();
        assert!(
            !ledger_is_behind_the_schema(&conn, 74).unwrap(),
            "a truthful ledger that is merely one step behind must be left alone"
        );
    }
}
