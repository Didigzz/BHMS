# Billing Features Spec — Rates, Receipts, Toasts, Monthly Earnings

**App:** Digal Boarding House (Tauri 2 + SvelteKit 5 SPA, SQLite via `tauri-plugin-sql`, Android-first)
**Status:** Spec (no code changes yet)
**Date:** 2026-08-06

---

## 1. Overview

Four related features, one final deploy:

1. **Multiple rate types** — per-tenant monthly rates (snapshot at move-in). Short-term/daily-weekly billing is explicitly **out of scope** for now.
2. **PDF receipt generation (as image)** — an in-app receipt view exportable as a shareable PNG image, generated automatically after every payment **and** reopenable from payment history.
3. **Toast notifications** — top-banner toasts for every transactional action (payments, reservations, tenants, rooms, backup) including errors.
4. **Monthly Earnings Summary** — a Dashboard section (with month selector + headline numbers) that expands into a full per-tenant breakdown. Accurate even with advance payments because payments are logged per **covered month**.
5. **Deploy** — rebuild and reinstall on the phone (debug build, `adb install -r`).

The features are interdependent: payment *month coverage* (feature 4's foundation) changes how "Mark as Paid" records data, which in turn feeds receipts and earnings.

---

## 2. Current state (as-is)

### Data model
- `rooms`: `id, room_number, capacity, monthly_rate, maintenance` — one rate per room.
- `tenants`: `id, name, contact, room_id, move_in_date, due_date, deposit_amount, deposit_refunded, advance_months, last_paid_date, moved_out_date` — **no per-tenant rate**.
- `payments`: `id, tenant_id, amount, paid_date, due_date` — `due_date` stores the tenant's *new* due date after payment; **no covered-month column**, so per-month earnings are impossible today.
- `reservations`: `id, room_id, name, contact, reservation_date, target_move_in_date, scope ('whole'|'slot'), deposit, status`.
- `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`; `notifications_log`.

### Payment flow today
- PayModal suggests `room.monthly_rate × months` (i.e., per-bed pricing), amount is **editable** (partial amounts allowed today).
- `confirmPay` in `src/routes/tenants/+page.svelte`:
  - `UPDATE tenants SET last_paid_date=today, due_date=addMonths(due_date, months)`
  - `INSERT INTO payments (tenant_id, amount, paid_date, due_date)` — **one row per payment action**, no coverage info.
- Move-in advance months (`advance_months`) set `last_paid_date` but are **never written to `payments`**.
- Reminders (`src/lib/reminders.ts`) JOIN rooms for `monthly_rate`.

### Other relevant facts
- Migrations: 30 files, each **one SQL statement**, embedded in `lib.rs` via `include_str!`; `scripts/smoke-sql.mjs` drift-checks the two. Never edit an applied migration — append new versions (031+).
- Plugins: `sql`, `dialog`, `fs`, `notification`, `opener` (capabilities in `src-tauri/capabilities/default.json`). **No share plugin yet.**
- Currency: PHP (`src/lib/format.ts` → `phpPeso`, `phpPesoPrecise`). Dates are ISO `YYYY-MM-DD`.
- No toast system exists. Errors are inline `.alert` / `.form-error` banners.
- Nav: bottom tab bar (Dashboard/Rooms/Tenants/Reservations) + settings gear (top-right).
- Dashboard (`src/routes/+page.svelte`): StatCards → summary strip → legend → room list.
- Modal pattern: Svelte 5 runes + `modalMaterial` transition (`src/lib/motion.ts`).

---

## 3. Interview decisions (source of truth)

| Topic | Decision |
|---|---|
| Rate model | **Per-tenant rate**, defaulting from the room at move-in, editable anytime. |
| Rate changes | **Snapshot**: changing a room's rate does **not** change existing tenants' rates. |
| Short-term rates | **Dropped** — no daily/weekly billing. |
| Receipt format | **In-app receipt view, exportable as an image** (PNG) — not a PDF. |
| Receipt trigger | **Both**: auto-shown after every payment (with Share button) + a "Receipt" button on each payment-history row. |
| Receipt fields | Boarding house name, receipt number, tenant & room, amount + covered months + payment date, payment method, landlord signature line, paid status. |
| Payment method | Add a method picker to the Pay modal (cash/GCash/Maya/…); stored on the payment. |
| Expected income | **Full month regardless** of mid-month move-in/out. |
| Advance payments | **Split across covered months** — one `payments` row per covered month. |
| Earnings placement | **Dashboard section** (card with month selector + numbers) that **expands into the full view** (per-tenant breakdown). |
| Per-tenant list | **Yes** — each tenant, their rate, and paid/unpaid status for the month. |
| Partial payments | **Not allowed** — amount must equal `rate × months`; pay modal enforces full amount (editable amount input is removed). |
| Move-in advances | **Recorded as payment rows** so Earnings is accurate; method shows as "—". |
| Receipt number | **Simple running number** from the payment's DB id, e.g. `RCPT-000123`. |
| House name on receipt | **Editable in Settings** (new setting, default `Digal Boarding House`). |
| Month selector range | **Any month** — past or future (future months show what advance payments already cover). |
| Toast style | **Top banner**, auto-dismiss ~3 s, tap to dismiss. |
| Toast events | Payment recorded; reservation created/converted/cancelled; tenant added/edited/moved out/deposit refunded/deleted; room added/edited/deleted; backup export/import; **and errors**. |
| Phone build | **Debug build** (`--debug --target aarch64`) + `adb install -r`. |

---

## 4. Feature 1 — Multiple rate types (per-tenant rates)

### Data model
- **Migration 031** — `ALTER TABLE tenants ADD COLUMN monthly_rate REAL;`
- **Migration 032** — backfill:
  ```sql
  UPDATE tenants SET monthly_rate = (SELECT r.monthly_rate FROM rooms r WHERE r.id = tenants.room_id);
  ```
  Every existing tenant gets the room's current rate — exactly what PayModal has always charged them, so behavior is unchanged for existing data.

### UI changes
- **Tenant form** (`src/routes/tenants/TenantFormModal.svelte`):
  - New "Monthly rate (₱)" number input, **prefilled from the selected room's rate** whenever the room selection changes (or for new tenants).
  - Edit mode: load the tenant's own `monthly_rate`.
  - Validation: required, `>= 0` (matches room form).
  - `TenantFormState` gains `monthly_rate: string`.
- **Tenants page** (`src/routes/tenants/+page.svelte`): `saveTenant` INSERT/UPDATE gains `monthly_rate`. On INSERT, fall back to the selected room's rate if the field is empty.
- **Room form** (`src/routes/rooms/RoomFormModal.svelte`): relabel to **"Monthly rate (default for new tenants)"** + a hint that existing tenants keep their rate.
- **PayModal** (`src/routes/tenants/PayModal.svelte`): `rateOf()` now reads `tenant.monthly_rate` (fallback to room rate for safety). The suggested amount becomes the **locked** amount (see §4.2).
- **Reminders** (`src/lib/reminders.ts`): query becomes `COALESCE(t.monthly_rate, r.monthly_rate) AS monthly_rate`; `DueTenant` unchanged otherwise.
- **Types**: `src/routes/tenants/types.ts` `Tenant` gains `monthly_rate: number | null`.
- **Dashboard / rooms / reservations**: keep showing room rates (they're the "default" price); no change required.

### Edge cases
- Tenant moved to a different room mid-tenancy → their rate stays (snapshot). Room-switch does not prompt a rate change (can be edited manually).
- Rate edited mid-tenancy is **not retroactive**: there's no rate history, so past Earnings months use the *current* stored rate. Documented limitation (see §9 Open questions). The tenant's own rate is used for every month of their tenancy.
- New columns are nullable → all existing SQL that selects `t.*` still works.

---

## 5. Feature 2 — Payment month coverage (foundation for earnings + receipts)

### Data model
- **Migration 033** — `ALTER TABLE payments ADD COLUMN covers_month TEXT;` (`YYYY-MM`)
- **Migration 034** — backfill: `UPDATE payments SET covers_month = substr(paid_date, 1, 7) WHERE covers_month IS NULL;`
- **Migration 035** — `ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'cash';`
- **Migration 036** — `ALTER TABLE payments ADD COLUMN receipt_no TEXT;`
- **Migration 037** — backfill receipt numbers: `UPDATE payments SET receipt_no = 'RCPT-' || printf('%06d', id) WHERE receipt_no IS NULL;`
- (`printf` is available in SQLite — used for padding.)

### "Mark as Paid" (PayModal → `confirmPay`) — new behavior
- Amount is **locked** to `tenant.monthly_rate × months` (the editable amount input is removed; show the computed amount prominently, e.g. "Amount: ₱7,500").
- Insert **one `payments` row per covered month**:
  ```sql
  INSERT INTO payments (tenant_id, amount, paid_date, due_date, covers_month, method, receipt_no)
  VALUES ($1, $2, $3, $4, $5, $6, $7);
  ```
  - `amount` = one month's rate (e.g. ₱2,500), `covers_month` = each of the next `months` months starting from the current due month, `method` = picked method, `receipt_no` = shared across the batch.
  - Shared `receipt_no`: pre-read `SELECT COALESCE(MAX(id),0)+1 FROM payments` → that id becomes the running number for all rows of the transaction (`RCPT-000123`). Safe in a single-user local app.
  - `due_date` column keeps its current meaning (the tenant's new due date) — written once on the **last** row (or all rows; only used for display today).
  - The `UPDATE tenants SET last_paid_date, due_date` stays as-is.
- **PayModal UI**: new "Payment method" select — Cash, GCash, Maya, Bank transfer, Other (default Cash). Validate method exists.

### Move-in advance months (tenant create)
- When creating a tenant with `advance_months >= 1`, **also insert `advance_months` payment rows**, one per covered month starting from the move-in month:
  - `amount` = tenant rate, `paid_date` = `move_in_date`, `covers_month` = `YYYY-MM` of each of the first N months, `method` = `'—'`, `receipt_no` = a generated one (`RCPT-…`) so it can be opened from history.
  - Keeps `last_paid_date = move_in_date` (payment status logic unchanged).
  - This makes Earnings "collected" accurate from day one.
- These inserts happen inside the existing `saveTenant` transaction path (sequential `db.execute` calls, matching app conventions).

### Payment history display
- `PaymentHistoryModal.svelte`: **group rows by `receipt_no`** when present — show one line per receipt: `₱7,500 · covers Aug 2026–Oct 2026 · GCash`, plus a **Receipt** button (§6). Legacy rows (unique receipt_no) render as today.
- `PaymentRecord` type gains `covers_month`, `method`, `receipt_no`.

### Edge cases
- `months > 1` at pay time is exactly the advance-payment case the user asked to handle accurately.
- Deleting a tenant (permanent delete) cascades payments — fine; receipts for a deleted tenant are gone (accepted, matches current delete behavior).
- Legacy payments keep working everywhere (nullable coverage backfilled; method defaulted to cash).

---

## 6. Feature 3 — Receipts (in-app view, export as image)

### Receipt component — `src/routes/tenants/ReceiptModal.svelte` (or `src/lib/components/`)
Opened with a set of payment rows (one transaction: `receipt_no`, tenant, room, covered months, total, method, paid date). Renders:

```
                    Digal Boarding House        ← house name setting
                    OFFICIAL RECEIPT

Receipt No: RCPT-000123          Date: 8/6/2026
Tenant: Juan Dela Cruz
Room: Room 101

Month(s) covered:  Aug 2026, Sep 2026, Oct 2026
Amount:            ₱7,500.00
Payment method:    GCash
Status:            PAID IN FULL

──────────────
  Signature of landlord / authorized rep.
```

- Receipt number: `RCPT-` + zero-padded payment id (simple running number, per decision).
- Covered months displayed as month names (`Aug 2026…`) using a shared formatter.
- Paid status: "PAID IN FULL" (partials are impossible by design).
- House name from setting `house_name` (default `Digal Boarding House`).

### Trigger points (both, per decision)
1. **Auto after payment**: `confirmPay` success → open `ReceiptModal` for the just-recorded transaction (instead of just closing PayModal).
2. **From history**: each grouped row in `PaymentHistoryModal` gets a "Receipt" button → opens the same modal with that transaction's rows.

### Export as image (shareable PNG)
- **Capture:** render the receipt content into a hidden, fixed-size container and capture with a canvas/screenshot approach. Research candidates at implementation time:
  - `html-to-image` (lightweight, SVG-foreignObject based; works in the Android WebView / Chromium) → `toPng()`.
  - `html2canvas` (fallback; heavier).
  - Add the chosen package to `package.json` (`npm install`).
- **Save:** write the PNG to the app data dir via `@tauri-apps/plugin-fs` (scope `fs:scope-appdata-recursive` already granted).
- **Share:** share the image file via the Android share sheet.
  - Preferred: `tauri-plugin-share` (official Tauri v2 mobile plugin, `share({ files: [fileUrl] })`). Requires: add `tauri-plugin-share = "2"` to `Cargo.toml`, `tauri_plugin_share::init()` in `lib.rs`, `share:default` in `capabilities/default.json`, and the JS package `@tauri-apps/plugin-share`. **Verify plugin availability/signature during implementation** (it is mobile-only; guard the call so the Windows/desktop and browser-preview builds degrade gracefully).
  - Fallback if the plugin proves unsuitable: `opener` plugin opens the image (user shares from the gallery/viewer), or in browser preview a plain `a[download]` blob download.
- Non-Tauri (browser preview): fall back to `a[download]` with the PNG blob URL.
- Buttons: **Share image** (primary), **Close**. Maybe "Save to photos" if feasible (note: saving to the system gallery needs Android MediaStore — no official plugin; the share sheet already offers "Save image" on Android, so skip a dedicated save button for v1).

### Settings — house name
- New **"Boarding house name"** text input in Settings (`src/routes/settings/…` — small new section or add to the About card). Persisted via `setSetting("house_name", value)`.
- `getSetting("house_name", "Digal Boarding House")` read at receipt render time.
- Optional seed migration **038**: `INSERT OR IGNORE INTO settings (key, value) VALUES ('house_name', 'Digal Boarding House');` (keeps the settings table self-describing; the read-time default already covers it).

---

## 7. Feature 4 — Monthly Earnings Summary

### Placement & layout (per decision: Dashboard section)
- **Dashboard card** on `src/routes/+page.svelte` (below StatCards, above the summary strip/room list):
  - Header: "Monthly Earnings" + month selector: `◀  August 2026  ▶` (any month, past/future; arrows + label; a small "This month" reset is a nice touch).
  - Four headline numbers:
    - **Expected** (sum of rates of tenants active during the month)
    - **Collected** (sum of payments covering the month)
    - **Pending** (expected − collected)
    - **Paid X / Y tenants** (paid vs. active count)
  - "View breakdown" button → expands into the full view.
- **Full view**: a modal (consistent with the app's modal pattern) listing each active tenant for the month: name, room, rate, amount collected that month, status chip (Paid / Unpaid). Could be a dedicated route if the modal grows; default to modal.

### Metric definitions (exact)
- **Month key:** `YYYY-MM`.
- **Active during month M** (full-month counting, per decision):
  `moved_in_date <= last day of M` AND (`moved_out_date IS NULL` OR `moved_out_date >= first day of M`).
- **Expected(M)** = Σ rate of active tenants (their stored `monthly_rate`, fallback room rate).
- **Collected(M)** = Σ `amount` of `payments` where `covers_month = M`.
- **Pending(M)** = Expected(M) − Collected(M). Because partial payments are disallowed, per-tenant collected is always 0 or the full rate, so pending is exact. (For robustness, compute per tenant as `max(0, rate − collected)` so any future partial handling stays correct.)
- **Paid count** = active tenants with `collected >= rate` for M; **Didn't pay** = active − paid.
- Prorating: none (full month regardless of mid-month move-in/out — explicitly per interview).

### Logic location & tests
- New pure lib `src/lib/earnings.ts`:
  - `monthKey(date): string`, `addMonthsKey(key, n)`, `formatMonthKey(key): "August 2026"`, `monthRange(key)`.
  - `isTenantActiveInMonth({move_in_date, moved_out_date}, monthKey): boolean`.
  - `computeMonthSummary(tenants, paymentsForMonth, monthKey)` → `{ expected, collected, pending, paidCount, unpaidCount, rows: { tenant, rate, collected, paid }[] }`.
- New `src/lib/earnings.test.ts` (vitest, matching `payment-status.test.ts` conventions):
  - Mid-month move-in counts full month; moved-out mid-month still counts; tenant active across month boundary counts.
  - Advance payment split: 3 covered months → each month's collected = rate; unpaid month shows expected − 0.
  - Future month with pre-paid coverage shows collected > 0.
  - Paid/unpaid counts; legacy payment backfilled to its paid_date month.
- **Earnings SQL**: dashboard queries active tenants (with rate) for the month + `SELECT covers_month, amount FROM payments` — compute in TS via the lib (keeps logic testable), not in SQL.

### Edge cases
- Month with zero active tenants → zeros everywhere, empty breakdown ("No tenants were active in {month}").
- Viewing a month before the boarding house started → zeros.
- Future months: collected shows advance coverage; expected shows tenants active *today* whose tenancy would overlap the future month (their current rate) — note: "expected" for future months uses current active tenants as a projection; acceptable and explained in the UI subtitle if needed.
- Rate edited mid-tenancy (see §4 edge cases): past months use the current stored rate — documented limitation.

---

## 8. Feature 5 — Toast notifications

### Infrastructure
- New `src/lib/toast.svelte.ts` (Svelte 5 runes store):
  - `toasts = $state<Toast[]>([])`, `push(message: string, variant: 'success' | 'error' | 'info')`, `dismiss(id)`.
  - Auto-dismiss after ~3 s (setTimeout per toast, cleared on dismiss).
  - `Toast` = `{ id, message, variant }`.
- New `src/lib/components/ToastHost.svelte` mounted once in `src/routes/+layout.svelte` (below the gear, above content):
  - **Top banner**: fixed at top center, slides/fades in (`transition:fly`-style or CSS), stacks vertically with small gaps; tap to dismiss; respects `prefers-reduced-motion`.
  - Variants: green (success), red (error), neutral (info) — reuse app CSS vars (`--green-soft/-deep`, `--red-soft/-deep`, `--accent-*`).

### Wiring (events, per decision — all of them)
- **Payments:** `confirmPay` success → "Payment recorded — ₱7,500 (Aug–Oct 2026)"; failure → error toast (page-level catch).
- **Reservations** (`src/routes/reservations/+page.svelte`): created, converted to tenant, cancelled → success toasts; failures → error toasts.
- **Tenants:** added, edited, moved out, deposit refunded, permanently deleted → success toasts.
- **Rooms:** added, edited, deleted → success toasts.
- **Backup** (`src/routes/settings/BackupSection.svelte`): export/import success → toasts (replace/coexist with existing inline `.note-ok`; decide: keep inline banner for import confirmation, toast for export).
- **Errors:** DB-level failures anywhere (the `catch (e)` blocks that currently set `error`) additionally push an error toast. Keep existing inline alerts (they're contextual), add toasts on top.
- Invariant: toasts must never break flows — always fire after the DB mutation resolves.

---

## 9. Migration & wiring checklist (new versions 031–038)

| # | File | Statement |
|---|---|---|
| 031 | `031-add_monthly_rate_to_tenants.sql` | `ALTER TABLE tenants ADD COLUMN monthly_rate REAL;` |
| 032 | `032-backfill_tenant_monthly_rate.sql` | `UPDATE tenants SET monthly_rate = (SELECT r.monthly_rate FROM rooms r WHERE r.id = tenants.room_id);` |
| 033 | `033-add_covers_month_to_payments.sql` | `ALTER TABLE payments ADD COLUMN covers_month TEXT;` |
| 034 | `034-backfill_payment_covers_month.sql` | `UPDATE payments SET covers_month = substr(paid_date, 1, 7) WHERE covers_month IS NULL;` |
| 035 | `035-add_payment_method_to_payments.sql` | `ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'cash';` |
| 036 | `036-add_receipt_no_to_payments.sql` | `ALTER TABLE payments ADD COLUMN receipt_no TEXT;` |
| 037 | `037-backfill_payment_receipt_no.sql` | `UPDATE payments SET receipt_no = 'RCPT-' \|\| printf('%06d', id) WHERE receipt_no IS NULL;` |
| 038 | `038-seed_settings_house_name.sql` | `INSERT OR IGNORE INTO settings (key, value) VALUES ('house_name', 'Digal Boarding House');` |

Each file: **exactly one statement**. Add matching `include_str!` + `migration(version, …)` entries in `src-tauri/src/lib.rs` (versions 31–38). `scripts/smoke-sql.mjs` drift-checks lib.rs ↔ migrations — run it and update expectations if the script asserts a total count.

### Optional new dependency
- `tauri-plugin-share` (Rust + JS) + capability `share:default` for Android share-sheet image sharing (§6). Only if the plugin works cleanly; otherwise opener fallback. Guarded so non-mobile builds still compile.

---

## 10. Files to touch (summary)

**Frontend**
- `src/lib/earnings.ts` (+ `earnings.test.ts`) — new
- `src/lib/toast.svelte.ts`, `src/lib/components/ToastHost.svelte` — new
- `src/routes/tenants/ReceiptModal.svelte` — new
- `src/routes/tenants/+page.svelte` — payment rows per covered month, receipt trigger, toasts
- `src/routes/tenants/PayModal.svelte` — locked amount, method picker
- `src/routes/tenants/TenantFormModal.svelte` — rate field (+ `types.ts` `TenantFormState`/`Tenant`/`PaymentRecord`)
- `src/routes/tenants/PaymentHistoryModal.svelte` — group by receipt_no, Receipt button
- `src/routes/+page.svelte` — earnings card + full-view modal (+ maybe `EarningsCard.svelte` / `EarningsModal.svelte`)
- `src/routes/rooms/RoomFormModal.svelte` — label change only
- `src/routes/rooms/+page.svelte`, `src/routes/reservations/+page.svelte` — toast wiring
- `src/routes/settings/+page.svelte` (+ small section) — house name setting
- `src/routes/settings/BackupSection.svelte` — toast wiring
- `src/routes/+layout.svelte` — mount ToastHost
- `src/lib/reminders.ts` — COALESCE rate

**Backend**
- `src-tauri/migrations/031…038` — new
- `src-tauri/src/lib.rs` — migration entries (+ optional share plugin init)
- `src-tauri/Cargo.toml` — optional `tauri-plugin-share`
- `src-tauri/capabilities/default.json` — optional `share:default`
- `package.json` — image-capture dep (+ `@tauri-apps/plugin-share` if used)

**Tests / scripts**
- `src/lib/earnings.test.ts` — new unit tests
- `scripts/smoke-sql.mjs` — re-run (drift-check + business rules), update count expectations
- Existing `payment-status.test.ts` — should pass unchanged

---

## 11. Validation plan

1. `npm run check` — svelte-check typecheck.
2. `npm test` — vitest (payment-status + new earnings tests).
3. `node scripts/smoke-sql.mjs` — fresh-DB migration chain 1–38 + drift check.
4. Manual/browser: `npm run dev` (browser preview shims) → exercise pay (multi-month), receipts, earnings, toasts.
5. Optionally `browser-use` against the dev server to verify the new flows render.

## 12. Deploy step (explicitly requested)

With the phone connected (USB debugging on):
```bash
npm run tauri android build -- --debug --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```
- Debug build keeps existing app data (`adb install -r`).
- If multiple devices: `adb devices` to confirm; target the phone.
- Verify launch (`adb shell monkey -p com.digal.boardinghouse 1`) and check `adb logcat` for JS errors if something misbehaves.

---

## 13. Non-goals (explicitly excluded)

- Daily/weekly (short-term) billing.
- Partial payments (enforced full payment instead).
- PDF files (image export instead).
- Rate history / retroactive rate edits (uses current stored rate for past months).
- Multi-user/cloud sync (app stays local-first).

## 14. Open questions / assumptions to confirm before implementation

1. **Rate edits mid-tenancy**: past Earnings months will use the tenant's *current* rate (no rate history). Acceptable? (Alternative: add a rate-history table later.)
2. **Future-month "expected"**: uses currently-active tenants projected into that month. Acceptable as a projection?
3. **Move-in advance rows** get `method = '—'` and their own receipt numbers. OK, or should move-in advances be receipt-less?
4. **Payment history grouping**: rows grouped by `receipt_no` (one line per payment action, showing covered months). Confirm that's preferred over one line per covered month.
5. **Share plugin**: verify `tauri-plugin-share` works on this Android setup during implementation; fallback = open image via opener.
