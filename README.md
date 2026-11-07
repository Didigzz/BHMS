# Digal Boarding House — Tauri 2 + SvelteKit (TypeScript) Mobile App

A **local-first boarding house manager** for a small Philippine boarding house: rooms, tenants,
monthly rent collection, reservations, move-out/archiving, and backup. Runs as a Tauri 2 app
(Android phone first, Windows desktop possible), built with a SvelteKit SPA frontend and a Rust
backend. All data lives in a local SQLite database (`sqlite:boarding-house.db`) — **no accounts,
no cloud**. Data moves between family phones via manual backup export/import.

## Features

- **Dashboard** — stat cards (rooms / tenants / occupied), payment-status legend, per-room cards
  with occupancy bar, rate, and tenant chips colored by payment status, a **Due soon / Overdue**
  summary strip, and a "Reserved — {name}" line for held rooms.
- **Rooms** — add/edit/delete, capacity & rate validation, **maintenance** flag (blocks new
  tenants/reservations), delete guards (active tenants, reservations, archived history).
- **Tenants** — add/edit, room picker with live slot counts, **payment status** (green/yellow/red),
  **Mark as Paid** (month stepper + amount override), payment history log, **Move-Out** (archives,
  never deletes history) with deposit-refund prompt, archived view with permanent delete.
- **Reservations** — whole-room / one-slot scopes, optional holding deposit, convert-to-tenant
  (dates + deposit carried over), cancel, at most one active reservation per room.
- **Search & filter** — tenant search by name/contact/room; room status filter chips
  (incl. "Has overdue tenant").
- **Settings** — backup **export** (readable `.digal` file written to Downloads, verified, then
  shareable via the share sheet) and **import** (fully validated, atomic replace), notification
  prefs (enable toggle, reminder days-before), About.
- **Local notifications** — reminder a few days before rent is due, overdue + 7-days-overdue pings,
  de-duplicated per tenant/due-date (`notifications_log`); checked on app open.
- **Amenity Billing** — landlord-only page under the **Amenities** tab for charging tenants for shared,
  per-room (Room-Specific Amenity), and connected-room (Joint Room Billing) amenities. Custom amenity
  names, exclusion reasons, automatic or manual division with the remainder absorbed by the landlord,
  per-tenant Paid/Unpaid, soft **Cancelled** history, and a separate **Amenity Balance** per tenant
  (never mixed with rent).
- **Dark mode** (via `prefers-color-scheme`), PHP currency formatting (`en-PH`), English UI.

## Tech stack

- **Frontend:** SvelteKit 5 (SPA, `adapter-static`, `ssr = false`) + TypeScript
- **Shell:** Tauri 2 (Rust) with plugins: `sql`, `dialog`, `fs`, `notification`, `opener`
- **Data:** SQLite via `tauri-plugin-sql`, schema in `src-tauri/migrations/*.sql`

## Prerequisites

| Tool | Needed for | Status on this machine |
|------|-----------|------------------------|
| [Node.js ≥ 20](https://nodejs.org) | frontend toolchain (Vite/SvelteKit) | ✅ installed (v24) |
| [Rust](https://www.rust-lang.org/tools/install) (`rustup`, `cargo`) | compiling the Tauri shell | ✅ installed |
| [Android Studio + SDK](https://developer.android.com/studio) | Android builds | ✅ installed (`%LOCALAPPDATA%\Android\Sdk`) |
| JDK 17+ (`JAVA_HOME`) | Android Gradle builds | ✅ installed |
| Android Rust targets (4 ABIs) | compiling Rust for Android | ✅ installed |
| NDK | native libs for Android | ✅ installed (27.x) |
| Xcode (macOS only) | iOS builds | ❌ not possible on Windows — see [docs/apple-build.md](docs/apple-build.md) |

## Platform support

| Platform | Status |
|----------|--------|
| **Windows** | ✅ built and installed from this machine |
| **Android** (phone + tablet) | ✅ built and installed from this machine |
| **macOS** | ✅ the desktop build path — needs a Mac to produce the bundle |
| **iPhone / iPad** | ⚠️ gating done, Swift plugins still to write — needs macOS + Xcode |
| **Apple Vision Pro** | ⚠️ runs the iPad build as-is |
| **Apple TV / Apple Watch** | ❌ no Tauri target exists |

The bundle identifier is `com.digal.rentease`. The identifier *is* the app's data
folder name, so `src-tauri/src/db.rs` copies an existing install forward exactly
once on first launch; the old `%APPDATA%\com.rentease.app\` folder is left in
place as a safety net.

On Android the identifier and the **installed package** are separate things, and
they are set differently on purpose:

```kotlin
namespace = "com.digal.rentease"   // Kotlin package — must equal the identifier
applicationId = "com.rentease.app" // installed package — pinned so phones keep their data
```

Tauri fails the Android build if the Kotlin package does not match the
identifier, which is why the app's Kotlin sources live in
`gen/android/.../java/com/digal/rentease/`. The pinned `applicationId` means an
existing phone **upgrades in place** rather than becoming a second app with an
empty database.

> `src-tauri/gen/android` is gitignored. `tauri android init` regenerates it from
the identifier, which would drop both that pin and the four Kotlin plugins
(`GallerySaver`, `PDFSaver`, `BackupSaver`, `BackupSharer`) — re-apply them after
any regeneration.

Full details, including what is and is not verified, are in
**[docs/apple-build.md](docs/apple-build.md)**.

## Setup (already done on this machine)

```bash
npm install
npm run tauri android init     # generates src-tauri/gen/android (do not edit by hand)
```

Environment variables: `JAVA_HOME` → JDK 17+, `ANDROID_HOME` → `%LOCALAPPDATA%\Android\Sdk`,
`NDK_HOME` → `%ANDROID_HOME%\ndk\<version>`. `adb` may need adding to PATH (see Troubleshooting).

## Android workflow (phone connected via USB, USB debugging on)

**Build + install + run in debug, with hot reload** (recommended for iterating):

```bash
npm run tauri android dev          # compiles debug, installs, launches, then watches
npm run tauri android dev <device-name>   # if multiple devices are connected
```

**One-shot debug build + install** (no watch mode):

```bash
npm run tauri android build -- --debug --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

**Release build (all 4 ABIs) + install:**

```bash
npm run tauri android build        # output: .../apk/universal/release/app-universal-release-unsigned.apk
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

Notes:

- `--target aarch64` limits the build to the phone's ABI (arm64 on most modern phones) — much
  faster. Omit it to build all ABIs (`aarch64`, `armv7`, `i686`, `x86_64`).
- Debug builds are **debuggable** — `adb logcat` shows the WebView's JS console, and
  `adb shell run-as com.rentease.app` can reach the app's data dir. Release builds are not.
  (The Android `applicationId` is deliberately independent of the Tauri bundle identifier:
  it stays `com.rentease.app` so phones keep their data across the rename. An older
  `com.digal.boardinghouse` package may still be installed from a previous `android init`.)
- The release APK is **unsigned**. For on-device testing it is signed with the Android debug
  keystore; for a Play Store release, configure a real release keystore.
- **Data safety:** `adb install -r` keeps app data. Uninstalling (`adb uninstall
  com.rentease.app`) wipes the local database.

## Desktop (after installing Rust)

```bash
npm run tauri dev      # dev with hot reload
npm run tauri build    # release bundle
```

## Useful scripts

```bash
npm run check          # svelte-check typecheck (TS + Svelte)
npm test               # vitest unit tests (amenity billing, backup format, payment status, reports,
                       # tenant form/filter)
npm run smoke:sql      # applies ALL migrations to a fresh in-memory DB +
                       # drift-checks migrations.rs ↔ migrations/ + asserts business rules
npm run smoke:backup   # .digal round-trip: export → validate → rebuild → row-compare,
                       # plus the read-only-export and negative-path assertions
node scripts/repair-migrations.mjs [db]  # re-sync _sqlx_migrations checksums with the current
                                    # migration files (fixes "migration N was previously applied
                                    # but has been modified" in place, keeps all data)
node scripts/analyze-screenshot.mjs phone-verification/*.png   # pixel-profile device screenshots
                                    # (locates content bands/tab bar, flags red error UI)
```

## Project layout

```
├── src/                      # SvelteKit frontend (SPA, ssr = false)
│   ├── lib/                  # db, backup, backup-format (.digal envelope/validation),
│   │   │                     # settings, reminders, rooms, room-status, payment-status, amenity-billing,
│   │   │                     # amenity-actions, format, motion (+ *.test.ts vitest suites)
│   │   ├── browser/          # plugin mocks so the app also runs in a plain browser dev server
│   │   └── components/       # shared ConfirmModal
│   └── routes/               # / (dashboard), rooms, tenants, reservations, amenities/billing, settings
├── src-tauri/                # Rust backend + Tauri shell
│   ├── capabilities/         # permission grants (default.json)
│   ├── gen/android/          # generated Android project (regenerate via tauri android init)
│   ├── migrations/           # *.sql — single source of truth for the 75 migrations
│   ├── src/                  # lib.rs (mod decls + run()), migrations.rs (include_str! ledger),
│   │                         # migrations_repair.rs, media.rs, backup.rs, amenity.rs, db.rs
│   └── tauri.conf.json       # identifier, build config, window settings
├── scripts/                  # smoke-sql.mjs, smoke-backup.mjs, analyze-screenshot.mjs
├── package.json              # npm scripts: dev, build, check, test, tauri
└── vite.config.js            # fixed port 1420, TAURI_DEV_HOST support
```

## Backup & restore

Backups are plain, readable files with the `.digal` extension:

- **Format** — one pretty-printed JSON document holding a manifest (format + app version, export
  timestamp, house name, per-table row counts, SHA-256 checksum) and every table's rows (rooms,
  tenants, payments, reservations, settings, notifications log, and the amenity billing tables). Open it
  in any text editor, Notepad
  included — no special tool is needed to see your data.
- **Export** — Settings → **Export backup** writes
  `Downloads/RentEase/BHMS-Backup-YYYY-MM-DD.digal` and then reads the saved file back to confirm
  the bytes on the device are intact before reporting success. Export never modifies your data
  (the only write is the "last backup" date). On Android a **Share backup** action appears
  afterwards so the file can go straight to Drive, email, or chat.
- **Restore** — Settings → **Import backup** picks a `.digal` file, fully validates it (format
  marker, version, checksum, required tables, row counts), writes a safety copy of your *current*
  data to `Downloads/RentEase/BHMS-Backup-YYYY-MM-DD-before-restore.digal`, then rebuilds a fresh
  database from the app's migrations, loads the backup's rows into it, verifies it
  (  `integrity_check` + `foreign_key_check`), and only then swaps it in. Files written before a table
  existed still restore, with that table empty. Any failure before that
  final step leaves the current data untouched, and the app returns to the dashboard when it is
  done.
- **Old backups** — files exported by earlier builds were raw `.db`/`.sqlite` databases. They can
  no longer be restored; the importer detects them and says so instead of failing silently.
- **Automated check** — `npm run smoke:backup` runs the whole cycle (export → validate → rebuild →
  row-compare) against the real migration chain, including the corruption/truncation cases and a
  pre-amenity backup that must still restore (absent tables come back empty).
- **The restore writes the migration ledger too.** A restored database is rebuilt by running every
  migration in Rust, which historically left it with the full schema but no sqlx `_sqlx_migrations`
  ledger — so the *next* launch re-applied from version 1 and died on 006's
  `ALTER TABLE tenants ADD COLUMN`, leaving the app unable to open its own (perfectly intact) data.
  The rebuild now seeds the ledger, and `repair_migrations` heals databases already in that state.

## Data & migrations

- The schema lives in `src-tauri/migrations/*.sql` (**75 migrations**, v1–v75), embedded into
  `src-tauri/src/migrations.rs` via `include_str!` and read directly by `scripts/smoke-sql.mjs` — that script
  **drift-checks** the two (every file wired in, versions sequential) and applies the full chain
  to a fresh database to prove the schema and business rules hold.
- **Migration discipline:** never edit an applied migration — append a new numbered version
  instead (e.g. the repair migrations v28–v30). Each `.sql` file must contain exactly **one**
  statement (tauri-plugin-sql runs them as single prepared statements).
- To add a migration: create `src-tauri/migrations/NNN-name.sql` + one `include_str!` line in
  `src-tauri/src/migrations.rs` + bump the smoke test's expectations if needed.

### ⚠️ "migration N was previously applied but has been modified"

This happens when a database was created by an **older build** whose migration SQL differed —
`tauri-plugin-sql` stores a SHA-384 checksum per migration and refuses to open the database on
mismatch. The mismatch is **bookkeeping only** (the schema itself was already applied), so the
app now repairs it in place:

- **Automatically:** before the sql plugin opens the database, the app runs a Rust self-heal
  (`repair_migrations`, wired into `src/lib/db.ts`) that rewrites stale checksums to match the
  migrations embedded in the current build. No data is lost and no manual step is needed.
- **Manually**, for a database the app can't reach or a backup file: `node scripts/repair-migrations.mjs [path-to-db]`.

Do **not** wipe the database or uninstall the app to fix this — your data is fine.

The remaining cause of this error after an upgrade is a **stale binary**: if the installed app
is older than the migration edit, reinstall/rebuild from the current source so the binary
embeds the same SQL as the database.

## Troubleshooting

- **`adb: command not found`** — add `%LOCALAPPDATA%\Android\Sdk\platform-tools` to PATH, or call
  `adb` by its full path: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`.
- **`adb devices` shows nothing** — enable USB debugging in Developer Options, and accept the
  "Allow USB debugging?" prompt on the phone. Try re-plugging the cable.
- **Screen locked / black screenshots** — `adb shell input keyevent KEYCODE_WAKEUP`,
  `wm dismiss-keyguard` works only for non-secure locks; a PIN/pattern requires unlocking by hand.
- **Gradle crashes (`0xC0000142`) or cargo lock contention** — kill stale build processes
  (`taskkill //F //IM java.exe`), then rerun; never start two `tauri android build` runs at once.
- **App stuck on old data** — a debug install keeps app data; uninstall first if you want a
  clean slate.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## Docs

- Amenity Billing spec: [`amenity-billing-spec.md`](amenity-billing-spec.md)
- Tauri 2 mobile: <https://v2.tauri.app/start/prerequisites/>
- Tauri + SvelteKit: <https://v2.tauri.app/start/frontend/sveltekit/>
