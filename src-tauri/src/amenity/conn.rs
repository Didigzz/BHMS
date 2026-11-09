//! One blocking rusqlite connection for the amenity write transactions.

use crate::db::database_path;

pub(crate) fn amenity_db_connection(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
    let path = database_path(app)?;
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| format!("could not open the database: {e}"))?;
    // The sql plugin holds its own pooled connection; wait rather than fail if
    // a write is in flight.
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}
