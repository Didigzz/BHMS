//! rentease (Digal Boarding House) — Tauri crate root.
//!
//! Every module below is one slice of what used to be a single 1,583-line file.
//! The seams are the natural ones: the schema ledger (`migrations`), checksum
//! repair (`migrations_repair`), platform file I/O (`media`), the backup engine
//! (`backup`), amenity billing (`amenity`), and the shared database path (`db`).
//! See rentease-audit.md → Phase 2 for the rationale and boundaries.
//!
//! `run()` stays here because Tauri's mobile entry point must. Command function
//! names are part of the app's contract — the frontend invokes them by string
//! (src/lib/db.ts, src/lib/backup.ts) — so `invoke_handler!` keeps resolving the
//! same eight identifiers it always did.

mod amenity;
mod backup;
mod db;
mod media;
mod migrations;
mod migrations_repair;

// Brought into scope for `generate_handler!` at the bottom of this file.
use amenity::{
    cancel_amenity_bill, record_amenity_bill_payments, record_amenity_payment, save_amenity_bill,
    update_amenity_payment_date, void_amenity_payment,
};
use backup::{
    database_state, install_backup_file, mark_database_initialised, restore_preflight,
    restore_safety_copy, save_backup_to_downloads, save_safety_copy, share_backup_file,
};
use media::{platform_capabilities, save_pdf_to_downloads, save_receipt_to_gallery};
use migrations::migrations;
use migrations_repair::repair_migrations;

/// The builder, with one-instance enforcement on desktop.
///
/// Two copies of the app hold the same database file open. On Windows that makes
/// the database un-replaceable, which is what used to fail a restore with
/// "Access is denied". A second launch now focuses the window that is already
/// running instead of starting another copy.
///
/// Mobile is exempt: the platform already gives an app a single task, and the
/// plugin is desktop-only, so it is not even in the mobile dependency graph
/// (see Cargo.toml).
fn builder_with_one_instance() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: tauri-plugin-sql (via sqlx) executes each migration as a SINGLE
    // prepared statement. Every migration file must contain exactly one
    // statement — multi-statement SQL would silently run only the first.
    builder_with_one_instance()
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
        // gen/android/app/src/main/java/com/digal/rentease/GallerySaver.kt).
        // No-op on desktop.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("gallery-saver")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    {
                        use tauri::Manager;
                        let handle =
                            _api.register_android_plugin("com.digal.rentease", "GallerySaver")?;
                        _app.manage(crate::media::GalleryHandle(handle));
                    }
                    Ok(())
                })
                .build(),
        )
        // Registers the Kotlin PDFSaver plugin so `save_pdf_to_downloads` can
        // write the sales-report PDF into Downloads via MediaStore.Downloads
        // (see gen/android/app/src/main/java/com/digal/rentease/PDFSaver.kt).
        // No-op on desktop.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("pdf-saver")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    {
                        use tauri::Manager;
                        let handle =
                            _api.register_android_plugin("com.digal.rentease", "PDFSaver")?;
                        _app.manage(crate::media::PdfHandle(handle));
                    }
                    Ok(())
                })
                .build(),
        )
        // Registers the Kotlin BackupSaver plugin so `save_backup_to_downloads`
        // can write a .digal backup into Downloads via MediaStore.
        // No-op on desktop.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("backup-saver")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    {
                        use tauri::Manager;
                        let handle =
                            _api.register_android_plugin("com.digal.rentease", "BackupSaver")?;
                        _app.manage(crate::media::BackupSaverHandle(handle));
                    }
                    Ok(())
                })
                .build(),
        )
        // Registers the Kotlin BackupSharer plugin (share sheet for a backup).
        // No-op on desktop.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("backup-sharer")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    {
                        use tauri::Manager;
                        let handle =
                            _api.register_android_plugin("com.digal.rentease", "BackupSharer")?;
                        _app.manage(crate::media::BackupSharerHandle(handle));
                    }
                    Ok(())
                })
                .build(),
        )
        // One-time move of an existing install into the renamed config folder
        // (see db.rs). This runs before the webview exists, so no frontend call
        // can open — and therefore create — a database ahead of the landlord's
        // real one arriving.
        //
        // A failure is deliberately not fatal here. Exiting would show a Windows
        // GUI user an error they cannot see, so instead the startup guard reads
        // `legacy_database_stranded()` and puts the recovery screen in front of
        // the app — which is the whole point: never present an empty RentEase as
        // though the data had simply gone.
        .setup(|app| {
            use tauri::Manager;
            if let Err(error) = crate::db::migrate_legacy_config_dir(app.app_handle()) {
                eprintln!("{error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            repair_migrations,
            platform_capabilities,
            save_receipt_to_gallery,
            save_pdf_to_downloads,
            save_backup_to_downloads,
            share_backup_file,
            install_backup_file,
            restore_preflight,
            save_safety_copy,
            database_state,
            mark_database_initialised,
            restore_safety_copy,
            save_amenity_bill,
            cancel_amenity_bill,
            record_amenity_payment,
            record_amenity_bill_payments,
            void_amenity_payment,
            update_amenity_payment_date
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
