//! Platform file writers: receipts, sales-report PDFs and everything that has
//! to land in the user's Downloads folder or gallery.
//!
//! There are three cases, and they are deliberately distinct:
//!
//! - **Android** routes these through the Kotlin MediaStore plugins
//!   (`GallerySaver`, `PDFSaver`, `BackupSaver`, `BackupSharer`), because
//!   app-private storage is not readable by other apps.
//! - **Desktop** (Windows, macOS, Linux) writes straight into the Downloads
//!   folder, which is already somewhere the user can find.
//! - **iOS** has no writer yet and says so out loud.
//!
//! That third case exists because the old guard was `#[cfg(not(target_os =
//! "android"))]`, which is *also true on iOS*. An iOS build therefore took the
//! desktop branch, called `download_dir()` against its own app sandbox, and
//! returned `"downloaded"` for a file that would never appear in the Files app.
//! Reporting success there is worse than failing: the landlord would believe a
//! backup existed. See docs/apple-build.md for what the real iOS implementation
//! needs (a Swift writer plus the `UIFileSharingEnabled` and
//! `LSSupportsOpeningDocumentsInPlace` Info.plist keys).
//!
//! The plugin handles live here because `run()` is the only place that can
//! register them, and both `backup` and this module need them.

/// Holds the Android GallerySaver plugin handle (registered on mobile so a Rust
/// command can save a receipt PNG straight into the Photos/Gallery app via
/// MediaStore). On desktop this state is never created — the command falls back
/// to writing the image into the Downloads folder instead.
#[cfg(target_os = "android")]
pub(crate) struct GalleryHandle(pub(crate) tauri::plugin::PluginHandle<tauri::Wry>);

/// Holds the Android PDFSaver plugin handle (registered on mobile so a Rust
/// command can write a sales-report PDF into the Downloads folder via
/// MediaStore.Downloads — see gen/android/app/src/main/java/com/digal/rentease/
/// PDFSaver.kt). On desktop this state is never created — the command falls
/// back to writing the file into the Downloads folder directly.
#[cfg(target_os = "android")]
pub(crate) struct PdfHandle(pub(crate) tauri::plugin::PluginHandle<tauri::Wry>);

/// Holds the Android BackupSaver plugin handle (registered on mobile so a Rust
/// command can write a `.digal` backup into Downloads via MediaStore — see
/// gen/android/app/src/main/java/com/digal/rentease/BackupSaver.kt).
#[cfg(target_os = "android")]
pub(crate) struct BackupSaverHandle(pub(crate) tauri::plugin::PluginHandle<tauri::Wry>);

/// Holds the Android BackupSharer plugin handle (ACTION_SEND share sheet for a
/// saved backup — see .../BackupSharer.kt).
#[cfg(target_os = "android")]
pub(crate) struct BackupSharerHandle(pub(crate) tauri::plugin::PluginHandle<tauri::Wry>);

/// What every iOS build reports until it has a real file writer.
///
/// Deliberately not a silent success — see the module docs. This is a plain
/// const rather than a `cfg`-gated one because `platform_capabilities()` uses it
/// inside `cfg!`, which the compiler checks on every target.
pub(crate) const IOS_NO_FILE_WRITER: &str =
    "Saving files isn't available in this iOS build yet. Export from RentEase on Android or desktop instead.";

/// The share-sheet half of the same story. iOS has no
/// `UIActivityViewController` writer yet, and a silent `Ok(())` there would read
/// as "the file was handed off" when nothing happened at all.
///
/// Only the `#[cfg(target_os = "ios")]` branches read this, so anywhere else it
/// is deliberately unused.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub(crate) const IOS_NO_SHARE_SHEET: &str =
    "Sharing files isn't available in this iOS build yet.";

/// Which "hand this file to the user" actions this build can really perform.
///
/// The UI asks before it draws the button, so an action this platform cannot do
/// is disabled with an explanation rather than failing after the tap.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformCapabilities {
    /// Can a file be put somewhere the user can find it again?
    pub(crate) save_to_device: bool,
    /// Is there a system share sheet for passing a file to another app?
    pub(crate) share_sheet: bool,
    /// Plain-language reason, when an action is unavailable.
    pub(crate) unavailable_reason: Option<String>,
}

#[tauri::command]
pub(crate) fn platform_capabilities() -> PlatformCapabilities {
    if cfg!(target_os = "ios") {
        PlatformCapabilities {
            save_to_device: false,
            share_sheet: false,
            unavailable_reason: Some(IOS_NO_FILE_WRITER.to_string()),
        }
    } else if cfg!(target_os = "android") {
        PlatformCapabilities {
            save_to_device: true,
            share_sheet: true,
            unavailable_reason: None,
        }
    } else {
        // Desktop writes into Downloads, which is enough to find the file again,
        // but has no system share sheet — the file is simply already on disk.
        PlatformCapabilities {
            save_to_device: true,
            share_sheet: false,
            unavailable_reason: None,
        }
    }
}

/// Persist a receipt image for the user: Android → device gallery (Photos),
/// desktop → Downloads folder. `base64` is the raw PNG bytes (no data: URL
/// prefix) and `fileName` the archive name, both produced by src/lib/share.ts.
#[tauri::command]
pub(crate) async fn save_receipt_to_gallery(
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

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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

    #[cfg(target_os = "ios")]
    {
        let _ = (app, base64, file_name);
        Err(IOS_NO_FILE_WRITER.to_string())
    }
}

/// Persist a sales-report PDF for the user: Android → Downloads via the Kotlin
/// PDFSaver plugin (MediaStore.Downloads, runtime permission request on
/// API 24-28), desktop → Downloads folder. `base64` is the raw PDF bytes (no
/// data: URL prefix) and `fileName` the `sales-report-YYYY-MM(.pdf)` name, both
/// produced by src/lib/pdf-export.ts.
#[tauri::command]
pub(crate) async fn save_pdf_to_downloads(
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

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
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

    #[cfg(target_os = "ios")]
    {
        let _ = (app, base64, file_name);
        Err(IOS_NO_FILE_WRITER.to_string())
    }
}
