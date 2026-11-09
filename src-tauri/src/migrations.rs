//! The migration ledger: every `.sql` file in `src-tauri/migrations/` embedded
//! at compile time, in filename order. This module is the Rust half of the
//! schema's single source of truth — `scripts/smoke-sql.mjs` and
//! `scripts/smoke-backup.mjs` drift-check it against that directory (see
//! README → Migrations).

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
pub(crate) fn migrations() -> Vec<Migration> {
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
        // Already-boarding backfill (already-boarding-spec.md): the Add Tenant
        // modal gains an "Already boarding?" toggle for tenants who moved in
        // before the system was introduced. A new invisible `backfilled` flag
        // (default 0) lets the capacity trigger distinguish those inserts and
        // skip the room checks for them — the tenant is already physically in
        // the room. v066 drops the v054 trigger; v067 recreates it with the
        // bypass. Non-backfilled inserts keep exactly today's behavior.
        migration(
            65,
            "add_backfilled_to_tenants",
            include_str!("../migrations/065-add_backfilled_to_tenants.sql"),
        ),
        migration(
            66,
            "drop_room_capacity_trigger",
            include_str!("../migrations/066-drop_room_capacity_trigger.sql"),
        ),
        migration(
            67,
            "enforce_room_capacity_with_backfill",
            include_str!("../migrations/067-enforce_room_capacity_with_backfill.sql"),
        ),
        migration(
            68,
            "add_amenity_balance_to_tenants",
            include_str!("../migrations/068-add_amenity_balance_to_tenants.sql"),
        ),
        migration(
            69,
            "create_amenity_bills",
            include_str!("../migrations/069-create_amenity_bills.sql"),
        ),
        migration(
            70,
            "create_amenity_bill_tenants",
            include_str!("../migrations/070-create_amenity_bill_tenants.sql"),
        ),
        migration(
            71,
            "create_amenity_bill_rooms",
            include_str!("../migrations/071-create_amenity_bill_rooms.sql"),
        ),
        migration(
            72,
            "create_amenity_bill_tenants_bill_index",
            include_str!("../migrations/072-create_amenity_bill_tenants_bill_index.sql"),
        ),
        migration(
            73,
            "create_amenity_bill_tenants_tenant_index",
            include_str!("../migrations/073-create_amenity_bill_tenants_tenant_index.sql"),
        ),
        migration(
            74,
            "create_amenity_bill_rooms_bill_index",
            include_str!("../migrations/074-create_amenity_bill_rooms_bill_index.sql"),
        ),
        migration(
            75,
            "drop_amenity_type",
            include_str!("../migrations/075-drop_amenity_type.sql"),
        ),
        // Amenity payments ledger (amenity-payment-flow-spec.md): one row per
        // settled share, plus the backfill that turns the old Paid flags into
        // dated payments and recomputes every balance as outstanding money.
        migration(
            76,
            "create_amenity_payments",
            include_str!("../migrations/076-create_amenity_payments.sql"),
        ),
        migration(
            77,
            "create_amenity_payments_active_index",
            include_str!("../migrations/077-create_amenity_payments_active_index.sql"),
        ),
        migration(
            78,
            "create_amenity_payments_paid_date_index",
            include_str!("../migrations/078-create_amenity_payments_paid_date_index.sql"),
        ),
        migration(
            79,
            "create_amenity_payments_bill_index",
            include_str!("../migrations/079-create_amenity_payments_bill_index.sql"),
        ),
        migration(
            80,
            "create_amenity_payments_tenant_index",
            include_str!("../migrations/080-create_amenity_payments_tenant_index.sql"),
        ),
        migration(
            81,
            "backfill_amenity_payments",
            include_str!("../migrations/081-backfill_amenity_payments.sql"),
        ),
        migration(
            82,
            "recompute_amenity_balances",
            include_str!("../migrations/082-recompute_amenity_balances.sql"),
        ),
        migration(
            83,
            "add_is_manual_to_amenity_bill_tenants",
            include_str!("../migrations/083-add_is_manual_to_amenity_bill_tenants.sql"),
        ),
    ]
}
