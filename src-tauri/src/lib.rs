use tauri_plugin_sql::{Migration, MigrationKind};

/// One SQL migration. Each `.sql` file in `src-tauri/migrations/` is embedded
/// at compile time via `include_str!`, making the files the single source of
/// truth for the schema — `scripts/smoke-sql.mjs` reads the same directory and
/// drift-checks it against the `include_str!` references below.
fn migration(version: i64, description: &'static str, sql: &'static str) -> Migration {
    Migration {
        version,
        description,
        sql,
        kind: MigrationKind::Up,
    }
}

/// The full migration chain, embedded at compile time from `src-tauri/migrations/`.
/// Both the sql plugin (see `run()`) and the `repair_migrations` self-heal
/// command read this list, so the checksums they compare are always the ones
/// this build ships.
fn migrations() -> Vec<Migration> {
    vec![
        migration(
            1,
            "create_rooms_table",
            include_str!("../migrations/001-create_rooms_table.sql"),
        ),
        migration(
            2,
            "create_tenants_table",
            include_str!("../migrations/002-create_tenants_table.sql"),
        ),
        migration(
            3,
            "room_occupied_on_tenant_insert",
            include_str!("../migrations/003-room_occupied_on_tenant_insert.sql"),
        ),
        migration(
            4,
            "room_vacant_on_tenant_delete",
            include_str!("../migrations/004-room_vacant_on_tenant_delete.sql"),
        ),
        migration(
            5,
            "enforce_room_capacity_on_insert",
            include_str!("../migrations/005-enforce_room_capacity_on_insert.sql"),
        ),
        migration(
            6,
            "add_last_paid_date_to_tenants",
            include_str!("../migrations/006-add_last_paid_date_to_tenants.sql"),
        ),
        migration(
            7,
            "create_payments_history_table",
            include_str!("../migrations/007-create_payments_history_table.sql"),
        ),
        migration(
            8,
            "add_deposit_amount_to_tenants",
            include_str!("../migrations/008-add_deposit_amount_to_tenants.sql"),
        ),
        migration(
            9,
            "add_deposit_refunded_to_tenants",
            include_str!("../migrations/009-add_deposit_refunded_to_tenants.sql"),
        ),
        migration(
            10,
            "add_advance_months_to_tenants",
            include_str!("../migrations/010-add_advance_months_to_tenants.sql"),
        ),
        migration(
            11,
            "add_moved_out_date_to_tenants",
            include_str!("../migrations/011-add_moved_out_date_to_tenants.sql"),
        ),
        migration(
            12,
            "add_maintenance_to_rooms",
            include_str!("../migrations/012-add_maintenance_to_rooms.sql"),
        ),
        migration(
            13,
            "create_reservations_table",
            include_str!("../migrations/013-create_reservations_table.sql"),
        ),
        migration(
            14,
            "reservations_one_active_per_room",
            include_str!("../migrations/014-reservations_one_active_per_room.sql"),
        ),
        migration(
            15,
            "drop_legacy_room_capacity_trigger",
            include_str!("../migrations/015-drop_legacy_room_capacity_trigger.sql"),
        ),
        migration(
            16,
            "enforce_room_capacity_with_reservations",
            include_str!("../migrations/016-enforce_room_capacity_with_reservations.sql"),
        ),
        migration(
            17,
            "enforce_reservation_room_state",
            include_str!("../migrations/017-enforce_reservation_room_state.sql"),
        ),
        migration(
            18,
            "drop_legacy_occupied_trigger",
            include_str!("../migrations/018-drop_legacy_occupied_trigger.sql"),
        ),
        migration(
            19,
            "drop_legacy_vacant_trigger",
            include_str!("../migrations/019-drop_legacy_vacant_trigger.sql"),
        ),
        // Room status is query-derived (see src/lib/roomStatus.ts). These
        // one-time updates normalize the legacy stored status column.
        migration(
            20,
            "normalize_stored_room_status_vacant",
            include_str!("../migrations/020-normalize_stored_room_status_vacant.sql"),
        ),
        migration(
            21,
            "normalize_stored_room_status_occupied",
            include_str!("../migrations/021-normalize_stored_room_status_occupied.sql"),
        ),
        migration(
            22,
            "normalize_stored_room_status_reserved",
            include_str!("../migrations/022-normalize_stored_room_status_reserved.sql"),
        ),
        migration(
            23,
            "create_settings_table",
            include_str!("../migrations/023-create_settings_table.sql"),
        ),
        migration(
            24,
            "create_notifications_log_table",
            include_str!("../migrations/024-create_notifications_log_table.sql"),
        ),
        migration(
            25,
            "seed_settings_reminder_days",
            include_str!("../migrations/025-seed_settings_reminder_days.sql"),
        ),
        migration(
            26,
            "seed_settings_notifications_enabled",
            include_str!("../migrations/026-seed_settings_notifications_enabled.sql"),
        ),
        // The INSERT-only trigger above (v16) leaves a gap: a tenant moved to a
        // different room via UPDATE bypasses every guard, so a landlord could
        // move a tenant into a maintenance room, a whole-reserved room, or a
        // full room (violating "tenants and whole-room reservations can't
        // co-occur"). This trigger enforces the same rules on room changes.
        // `OLD.room_id != NEW.room_id` scopes the maintenance/reservation
        // checks to actual moves (the app always writes room_id on save), and
        // `id != NEW.id` excludes the tenant themselves so a same-room save in
        // a full room is not blocked.
        migration(
            27,
            "enforce_room_state_on_tenant_room_change",
            include_str!("../migrations/027-enforce_room_state_on_tenant_room_change.sql"),
        ),
        // REPAIR migrations: re-assert schema invariants idempotently. Databases
        // created by an older build can be missing the reservations schema (or
        // carry a legacy misspelled `reserveation` table), which surfaces as
        // "no such table" when the dashboard queries `reservations`. These are
        // new version numbers, so sqlx always runs them exactly once on any
        // database — the IF NOT EXISTS / IF EXISTS guards make them no-ops on
        // healthy databases.
        migration(
            28,
            "repair_reservations_table",
            include_str!("../migrations/028-repair_reservations_table.sql"),
        ),
        migration(
            29,
            "repair_reservations_active_index",
            include_str!("../migrations/029-repair_reservations_active_index.sql"),
        ),
        migration(
            30,
            "drop_legacy_reserveation_table",
            include_str!("../migrations/030-drop_legacy_reserveation_table.sql"),
        ),
        // Billing features (billing-features-spec.md): per-tenant rates and
        // payment month coverage. Rates snapshot from the room at move-in;
        // payments log the covered month, method, and receipt number so the
        // Earnings page stays accurate with advance payments. All new columns
        // are backfilled for databases created by older builds.
        migration(
            31,
            "add_monthly_rate_to_tenants",
            include_str!("../migrations/031-add_monthly_rate_to_tenants.sql"),
        ),
        migration(
            32,
            "backfill_tenant_monthly_rate",
            include_str!("../migrations/032-backfill_tenant_monthly_rate.sql"),
        ),
        migration(
            33,
            "add_covers_month_to_payments",
            include_str!("../migrations/033-add_covers_month_to_payments.sql"),
        ),
        migration(
            34,
            "backfill_payment_covers_month",
            include_str!("../migrations/034-backfill_payment_covers_month.sql"),
        ),
        migration(
            35,
            "add_payment_method_to_payments",
            include_str!("../migrations/035-add_payment_method_to_payments.sql"),
        ),
        migration(
            36,
            "add_receipt_no_to_payments",
            include_str!("../migrations/036-add_receipt_no_to_payments.sql"),
        ),
        migration(
            37,
            "backfill_payment_receipt_no",
            include_str!("../migrations/037-backfill_payment_receipt_no.sql"),
        ),
        migration(
            38,
            "seed_settings_house_name",
            include_str!("../migrations/038-seed_settings_house_name.sql"),
        ),
        // Hold types (reservations-hold-type): reservations grow from a
        // whole/slot boolean into a full Hold Type — 'whole' (entire room),
        // 'bed' (one bed), or 'custom' (an explicit bed count) — with a
        // `bed_count` column carrying the number of beds a partial hold
        // reserves. The old `scope` column (whole/slot) can't express
        // 'custom', and its CHECK constraint can't be widened in place, so
        // these migrations rebuild the table. They also DROP the
        // `idx_reservations_one_active` unique index (by dropping the table
        // that owns it): a room may now hold several active reservations as
        // long as beds remain, instead of exactly one per room.
        migration(
            39,
            "create_reservations_new_table",
            include_str!("../migrations/039-create_reservations_new_table.sql"),
        ),
        migration(
            40,
            "copy_reservations_to_new_table",
            include_str!("../migrations/040-copy_reservations_to_new_table.sql"),
        ),
        migration(
            41,
            "drop_legacy_reservation_trigger",
            include_str!("../migrations/041-drop_legacy_reservation_trigger.sql"),
        ),
        migration(
            42,
            "drop_legacy_capacity_trigger",
            include_str!("../migrations/042-drop_legacy_capacity_trigger.sql"),
        ),
        migration(
            43,
            "drop_legacy_room_change_trigger",
            include_str!("../migrations/043-drop_legacy_room_change_trigger.sql"),
        ),
        migration(
            44,
            "drop_legacy_reservations_table",
            include_str!("../migrations/044-drop_legacy_reservations_table.sql"),
        ),
        migration(
            45,
            "rename_reservations_new_table",
            include_str!("../migrations/045-rename_reservations_new_table.sql"),
        ),
        migration(
            46,
            "add_reservations_room_id_index",
            include_str!("../migrations/046-add_reservations_room_id_index.sql"),
        ),
        migration(
            47,
            "enforce_room_capacity_with_holds",
            include_str!("../migrations/047-enforce_room_capacity_with_holds.sql"),
        ),
        migration(
            48,
            "enforce_reservation_hold_state",
            include_str!("../migrations/048-enforce_reservation_hold_state.sql"),
        ),
        migration(
            49,
            "enforce_room_state_on_tenant_room_change_holds",
            include_str!("../migrations/049-enforce_room_state_on_tenant_room_change_holds.sql"),
        ),
        // Multi-bed occupancy (room-bed-view-spec): tenants gain a per-tenant
        // `beds_occupied` column (default 1, so every existing tenant keeps the
        // legacy one-tenant-one-bed behavior). The three capacity triggers are
        // dropped and recreated to SUM beds_occupied instead of counting
        // people — a tenant occupying 3 beds in a 5-slot room shows 3/5 with 2
        // free — and a new UPDATE guard blocks raising a tenant's bed count
        // past the room's free beds at the database level.
        migration(
            50,
            "add_beds_occupied_to_tenants",
            include_str!("../migrations/050-add_beds_occupied_to_tenants.sql"),
        ),
        migration(
            51,
            "drop_legacy_room_capacity_trigger",
            include_str!("../migrations/051-drop_legacy_room_capacity_trigger.sql"),
        ),
        migration(
            52,
            "drop_legacy_reservation_state_trigger",
            include_str!("../migrations/052-drop_legacy_reservation_state_trigger.sql"),
        ),
        migration(
            53,
            "drop_legacy_room_change_trigger",
            include_str!("../migrations/053-drop_legacy_room_change_trigger.sql"),
        ),
        migration(
            54,
            "enforce_room_capacity_with_beds",
            include_str!("../migrations/054-enforce_room_capacity_with_beds.sql"),
        ),
        migration(
            55,
            "enforce_reservation_hold_state_with_beds",
            include_str!("../migrations/055-enforce_reservation_hold_state_with_beds.sql"),
        ),
        migration(
            56,
            "enforce_room_state_on_tenant_room_change_with_beds",
            include_str!("../migrations/056-enforce_room_state_on_tenant_room_change_with_beds.sql"),
        ),
        migration(
            57,
            "enforce_beds_occupied_guard",
            include_str!("../migrations/057-enforce_beds_occupied_guard.sql"),
        ),
        // Held Balance (held-balance-spec): tenants gain two balance pots —
        // `advance_held` (advance money, consumed FIRST when the landlord
        // applies the balance to months) and `deposit_held` (the deposit,
        // consumed LAST). Both are REAL columns defaulting to 0, so legacy
        // tenants keep the old one-tenant-one-deposit behavior until the
        // backfill copies their original `deposit_amount` into `deposit_held`.
        // A settings seed makes the move-out refund configurable
        // (`deposit_refund_allowed`, default ON — keeps today's behavior).
        migration(
            58,
            "add_advance_held_to_tenants",
            include_str!("../migrations/058-add_advance_held_to_tenants.sql"),
        ),
        migration(
            59,
            "add_deposit_held_to_tenants",
            include_str!("../migrations/059-add_deposit_held_to_tenants.sql"),
        ),
        migration(
            60,
            "backfill_deposit_held",
            include_str!("../migrations/060-backfill_deposit_held.sql"),
        ),
        migration(
            61,
            "seed_settings_deposit_refund_allowed",
            include_str!("../migrations/061-seed_settings_deposit_refund_allowed.sql"),
        ),
        // Sales Report (sales-report-spec.md): a manual `total_capacity`
        // setting (beds) seeds the occupancy denominator, and tenants gain an
        // exact `deposit_refunded_amount` so the report nets out the real cash
        // returned at move-out (NOT NULL DEFAULT 0; legacy refunds are
        // approximated with deposit_amount in v64 — exact history is
        // unrecoverable because refundDeposit() never stored it).
        migration(
            62,
            "seed_settings_total_capacity",
            include_str!("../migrations/062-seed_settings_total_capacity.sql"),
        ),
        migration(
            63,
            "add_deposit_refunded_amount_to_tenants",
            include_str!("../migrations/063-add_deposit_refunded_amount_to_tenants.sql"),
        ),
        migration(
            64,
            "backfill_deposit_refunded_amount",
            include_str!("../migrations/064-backfill_deposit_refunded_amount.sql"),
        ),
    ]
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
fn repair_migrations(app: tauri::AppHandle) -> Result<usize, String> {
    use rusqlite::Connection;
    use sha2::{Digest, Sha384};
    use tauri::Manager;

    // Same resolution the sql plugin uses: app_config_dir() + "boarding-house.db".
    let app_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("boarding-house.db");
    if !db_path.exists() {
        // Fresh install — the plugin creates the file and applies everything.
        return Ok(0);
    }

    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let has_tracker = conn
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'")
        .map_err(|e| e.to_string())?
        .exists(rusqlite::params![])
        .map_err(|e| e.to_string())?;
    if !has_tracker {
        return Ok(0); // Pre-migration database — the plugin creates the tracker and applies all.
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
    Ok(fixed)
}

/// Holds the Android GallerySaver plugin handle (registered on mobile so a Rust
/// command can save a receipt PNG straight into the Photos/Gallery app via
/// MediaStore). On desktop this state is never created — the command falls back
/// to writing the image into the Downloads folder instead.
#[cfg(target_os = "android")]
struct GalleryHandle(tauri::plugin::PluginHandle<tauri::Wry>);

/// Holds the Android PDFSaver plugin handle (registered on mobile so a Rust
/// command can write a sales-report PDF into the Downloads folder via
/// MediaStore.Downloads — see gen/android/app/src/main/java/com/rentease/app/
/// PDFSaver.kt). On desktop this state is never created — the command falls
/// back to writing the file into the Downloads folder directly.
#[cfg(target_os = "android")]
struct PdfHandle(tauri::plugin::PluginHandle<tauri::Wry>);

/// Persist a receipt image for the user: Android → device gallery (Photos),
/// desktop → Downloads folder. `base64` is the raw PNG bytes (no data: URL
/// prefix) and `fileName` the archive name, both produced by src/lib/share.ts.
#[tauri::command]
async fn save_receipt_to_gallery(
    app: tauri::AppHandle,
    base64: String,
    file_name: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let state = app.state::<GalleryHandle>();
        let _uri = state
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "saveImage",
                serde_json::json!({ "base64": base64, "fileName": file_name }),
            )
            .map_err(|e| format!("GallerySaver: {e}"))?;
        return Ok("saved-to-gallery".into());
    }

    #[cfg(not(target_os = "android"))]
    {
        use base64::Engine;
        use tauri::Manager;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&base64)
            .map_err(|e| format!("invalid image data: {e}"))?;
        let dir = app
            .path()
            .download_dir()
            .map_err(|e| format!("could not locate Downloads: {e}"))?;
        let path = dir.join(&file_name);
        std::fs::write(&path, &bytes).map_err(|e| format!("could not write file: {e}"))?;
        Ok("downloaded".into())
    }
}

/// Persist a sales-report PDF for the user: Android → Downloads via the Kotlin
/// PDFSaver plugin (MediaStore.Downloads, runtime permission request on
/// API 24-28), desktop → Downloads folder. `base64` is the raw PDF bytes (no
/// data: URL prefix) and `fileName` the `sales-report-YYYY-MM(.pdf)` name, both
/// produced by src/lib/pdf-export.ts.
#[tauri::command]
async fn save_pdf_to_downloads(
    app: tauri::AppHandle,
    base64: String,
    file_name: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let state = app.state::<PdfHandle>();
        let _uri = state
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "savePdf",
                serde_json::json!({ "base64": base64, "fileName": file_name }),
            )
            .map_err(|e| format!("PDFSaver: {e}"))?;
        return Ok("saved-to-downloads".into());
    }

    #[cfg(not(target_os = "android"))]
    {
        use base64::Engine;
        use tauri::Manager;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&base64)
            .map_err(|e| format!("invalid pdf data: {e}"))?;
        let dir = app
            .path()
            .download_dir()
            .map_err(|e| format!("could not locate Downloads: {e}"))?;
        let path = dir.join(&file_name);
        std::fs::write(&path, &bytes).map_err(|e| format!("could not write file: {e}"))?;
        Ok("downloaded".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: tauri-plugin-sql (via sqlx) executes each migration as a SINGLE
    // prepared statement. Every migration file must contain exactly one
    // statement — multi-statement SQL would silently run only the first.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:boarding-house.db", migrations())
                .build(),
        )
        // Registers the Kotlin GallerySaver plugin with the Android plugin
        // manager so `save_receipt_to_gallery` can call MediaStore (see
        // gen/android/app/src/main/java/com/rentease/app/GallerySaver.kt).
        // No-op on desktop.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("gallery-saver")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    {
                        use tauri::Manager;
                        let handle =
                            _api.register_android_plugin("com.rentease.app", "GallerySaver")?;
                        _app.manage(GalleryHandle(handle));
                    }
                    Ok(())
                })
                .build(),
        )
        // Registers the Kotlin PDFSaver plugin so `save_pdf_to_downloads` can
        // write the sales-report PDF into Downloads via MediaStore.Downloads
        // (see gen/android/app/src/main/java/com/rentease/app/PDFSaver.kt).
        // No-op on desktop.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("pdf-saver")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    {
                        use tauri::Manager;
                        let handle =
                            _api.register_android_plugin("com.rentease.app", "PDFSaver")?;
                        _app.manage(PdfHandle(handle));
                    }
                    Ok(())
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            repair_migrations,
            save_receipt_to_gallery,
            save_pdf_to_downloads
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
