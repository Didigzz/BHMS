# Apple platforms — build runbook

What RentEase supports across Apple's devices, what is already done in this
repository, and exactly what remains before a Mac is required.

> **Status of everything in this file: not verified.** Nothing here has been
> compiled or run. Apple builds need macOS + Xcode, and this repository has only
> ever been built on Windows (desktop) and Windows → Android. Treat the iOS half
> as a specification, not as working software. `digal-transfer-spec.md` §9
> records the same limitation for the backup path.

---

## 1. What is possible

| Apple target | Supported | How |
|---|---|---|
| **Mac** — Intel and Apple Silicon | ✅ | Native Tauri desktop build |
| **iPhone** | ✅ | `iOS` target |
| **iPad** | ✅ | The same `iOS` build — iPadOS *is* iOS |
| **Apple Vision Pro** | ⚠️ Compatibility | Runs the iPad app as-is |
| **Apple TV** | ❌ | Tauri has no tvOS target |
| **Apple Watch** | ❌ | Tauri has no watchOS target |

Tauri's own config schema (`src-tauri/gen/schemas/`) declares exactly five
platforms — `android`, `iOS`, `linux`, `macOS`, `windows` — which is the
authoritative list. Rust *does* have `aarch64-apple-watchos` and
`aarch64-apple-tvos` targets, but a Rust target is not a UI toolkit: Tauri cannot
render there. A watch app would have to be a separate SwiftUI project, and Apple
requires watchOS apps to ship as companions to an iOS app, so even that is only
possible after the iOS port below.

One consequence worth knowing: **a single iOS build covers four devices.** iPad
needs no separate target, an iOS app runs natively on Apple Silicon Macs when
"Designed for iPad" is enabled in App Store Connect, and visionOS runs iPad apps
in compatibility mode.

---

## 2. macOS

This is the cheap one — the desktop build path is already the same code that
runs on Windows.

### Prerequisites

- macOS with **Xcode** and its command line tools
- **Rust** with the Apple targets: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
- Node ≥ 20

### Build

```bash
npm install
npm run tauri build
```

Artifacts land in `src-tauri/target/release/bundle/` as `.app`, `.dmg` and `.pkg`.
A universal binary needs both `aarch64-apple-darwin` and `x86_64-apple-darwin`:

```bash
npm run tauri build -- --target universal-apple-darwin
```

### Identifier and the data folder

The identifier is **`com.digal.rentease`**. It was renamed from
`com.rentease.app` because Tauri warns that an identifier ending in `.app`
collides with Apple's bundle extension.

This matters beyond cosmetics: **the identifier is the name of the app's data
folder.** `app_config_dir()` resolves to
`~/Library/Application Support/com.digal.rentease` on macOS, and that folder holds
the database, the `.initialised` marker and `safety/`. The rename is safe for
existing Windows installs because `src-tauri/src/db.rs` copies the old folder
forward once, on first launch, and never deletes the original. macOS and Linux
have never had an install, so there is nothing to migrate there.

### The identifier reaches further than it looks

Tauri derives more from `identifier` than a bundle ID, and two consequences are
not obvious:

**1. Android requires the Kotlin package to equal it.** A build fails outright
with *"Project directory `gen/android/app/src/main/java/com/digal/rentease` does
not exist"* if the source tree does not match. After the rename the app's Kotlin
sources live in `com/digal/rentease/`, and the four
`register_android_plugin(...)` calls in `lib.rs` name that package too.

**2. `applicationId` is deliberately NOT the identifier.** In
`gen/android/app/build.gradle.kts`:

```kotlin
namespace = "com.digal.rentease"   // the Kotlin package — follows the identifier
applicationId = "com.rentease.app" // the installed package — pinned on purpose
```

They are independent in Android, and pinning `applicationId` is what lets an
existing phone **upgrade in place** instead of becoming a second app with an
empty database. Verified after the rename: `aapt2 dump badging` reports
`package: name='com.rentease.app'`.

> **Fragility to remember:** `src-tauri/gen/android` is gitignored. A future
> `tauri android init` regenerates it from the identifier and would drop both this
> pin and the four hand-written Kotlin plugins. Re-apply them after any regen.

### Signing and notarization

Unsigned builds run locally but Gatekeeper blocks them anywhere else. For
distribution:

1. An **Apple Developer Program** account ($99/yr) — required for a Developer ID
   certificate and for notarization.
2. Set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
   `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` in the environment; Tauri reads
   them during `tauri build` and signs and notarizes automatically.
3. Without notarization macOS shows *"RentEase is damaged and can't be opened"* —
   which reads as corruption rather than a missing signature, so it is worth
   doing properly.

### Window chrome

`tauri.conf.json` sets `titleBarStyle: "Overlay"` and `hiddenTitle: true`, the
full-height look that Finder and Notes use. With the title bar hidden there is no
draggable strip of the window's own, so — now that the app has no sidebar to drag
by — `+layout.svelte` renders a slim transparent `data-tauri-drag-region` strip
across the top, on macOS only. It stops short of the Settings gear's corner so the
gear still takes its own taps.

**This is the one macOS change that cannot be checked from Windows.** If it looks
wrong, the revert is one line — `"titleBarStyle": "Visible"` — and the drag strip
becomes unnecessary.

---

## 3. iOS

### Blocked on

macOS + Xcode. There is **no `src-tauri/gen/ios` directory** and **no Swift file
anywhere in this repository**. `tauri ios init` cannot run on Windows.

```bash
# macOS only, one time
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
brew install cocoapods          # or: gem install cocoapods
npm run tauri ios init
npm run tauri ios build -- --target aarch64-apple-ios
```

### What is already done: the platform gating

This was the dangerous part, and it is fixed.

The file-writing commands used to branch on **"is this Android?"** rather than
"is this desktop?" — so `#[cfg(not(target_os = "android"))]` was *also true on
iOS*. An iOS build would therefore have taken the desktop branch, called
`download_dir()` against its own app sandbox, and returned `"downloaded"` for a
file that could never appear in the Files app. Silent success is the worst
possible outcome for a backup feature: the landlord would believe a backup
existed.

Four sites were split three ways (`android` / desktop / `ios`):

| File | Function |
|---|---|
| `src-tauri/src/media.rs` | `save_receipt_to_gallery` |
| `src-tauri/src/media.rs` | `save_pdf_to_downloads` |
| `src-tauri/src/backup.rs` | `save_backup_to_downloads` |
| `src-tauri/src/backup.rs` | `share_backup_file` |

Each iOS branch now returns a plain-language error instead of a false success.
A companion command, `platform_capabilities`, reports what the build can do, and
`src/lib/platform.ts` uses it so the UI **disables** Export and Download PDF with
an explanation rather than failing after the tap. Import is deliberately *not*
gated: picking a file and rebuilding the database work anywhere, so an iOS build
can still restore a backup.

### What is still needed: four Swift plugins

The Android build has four Kotlin plugins with no iOS counterparts. Each needs a
Swift equivalent registered through `register_ios_plugin` (mirroring
`register_android_plugin` in `run()`):

| Kotlin plugin | iOS equivalent |
|---|---|
| `GallerySaver.kt` | `PHPhotoLibrary` — write the receipt into Photos |
| `PDFSaver.kt` | Write into `Documents`, then the share sheet |
| `BackupSaver.kt` | Write into `Documents` (see the plist keys below) |
| `BackupSharer.kt` | `UIActivityViewController` |

`src-tauri/src/media.rs` documents the contract each must satisfy; the Rust side
already calls them through `run_mobile_plugin` once the handles exist.

### Info.plist

Without these two keys, a file written into `Documents` is still invisible in the
Files app — which is the same silent failure the gating fix removed:

- `UIFileSharingEnabled` — `true`
- `LSSupportsOpeningDocumentsInPlace` — `true`

Plus `NSPhotoLibraryAddUsageDescription` for the gallery saver, or iOS kills the
app on first use.

### UTIs, not MIME types

iOS maps **file extensions to UTIs**; it has no MIME types. The analogue of
Android's `application/octet-stream` is `public.data`. Declaring `public.json` for
a `.digal` file risks the same extension-appending behaviour that
`digal-transfer-spec.md` §R9–R11 fixes on Android. Keep the same admission
predicate too: platform code may change *where* a file is written, never *whether*
it is admissible.

### Distribution

- **Free Apple ID** — works for your own device only, and the provisioning profile
  **expires every 7 days**, requiring a re-sign.
- **Apple Developer Program** ($99/yr) — TestFlight (90-day builds, up to 10,000
  testers) and the App Store.
- Apple's guideline **4.2 (Minimum Functionality)** rejects apps that are only a
  repackaged website. RentEase is an offline SQLite manager with real features, so
  it should clear this — but it is worth knowing before submitting.

---

## 4. A restore used to leave the app unopenable

Found and fixed while verifying the rename, and worth recording because the
symptom was genuinely alarming.

The restore path rebuilds the database by running every migration itself, but it
did not write sqlx's `_sqlx_migrations` ledger. The rebuilt file therefore had the
**whole schema and no ledger**, so the *next launch* looked like a first run,
re-applied from version 1, and died on 006 (`ALTER TABLE tenants ADD COLUMN
last_paid_date` → *duplicate column name*). sqlx then returns an error,
`Database.load` rejects, and the app cannot open its own data — with the data
sitting there perfectly intact, which makes it look like everything was lost.

Two changes:

- `build_database_from_backup` now seeds the ledger as part of building the
  database, so a restored file is launchable from the moment it is written.
- `repair_migrations` heals databases already in this state. It seeds a missing
  ledger when the schema is genuinely present, and — the part that matters — it
  detects a ledger that is *behind* the schema, by checking whether the database
  already holds a table whose creating migration the ledger does not list.

That second check is deliberately precise rather than eager. Seeding too readily
would mark a real upgrade as already applied and silently skip a migration,
leaving a column missing — so a truthful ledger that is merely one step behind is
left alone for sqlx to finish. Both directions are covered by tests.

The Android install happened to have a healthy ledger and was unaffected; the
desktop install was in exactly this state and is now healed to 75/75 with all nine
tenants intact.

## 5. Wide-screen layout — intentionally removed

There is no wide-screen layout. The app renders **one** navigation — the floating
pill dock with its `+` popover, plus the Settings gear — and **one** centered
560px content column at *every* window width. A maximized desktop window renders
the phone design, on purpose.

The 760px breakpoint, the sidebar it revealed, the `⌘/Ctrl + 1…5` and
`⌘/Ctrl + ,` shortcuts, the `--titlebar-inset` traffic-light padding, and the
multi-column dashboard/tenants/rooms grids are all gone. Two navigation designs
and two layouts for one app was the defect; `mobile-optimization-spec.md` records
the decisions and the reasoning behind removing them.
