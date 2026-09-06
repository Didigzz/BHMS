# Sales Report — Specification

Status: **Review 2 — refinements locked** (interview, 4 rounds + assumption walkthrough, Sep 4 2026)
App: RentEase — Svelte 5 / SvelteKit (adapter-static) / Tauri 2 / SQLite (`@tauri-apps/plugin-sql`)

---

## 1. Overview

Add a **Sales Report** to the app: a dedicated page reachable from Settings that shows
sales, move-ins, move-outs, and occupancy for a date-filtered period, exportable to PDF.

This feature touches:

- **Settings page** — new "Reports" card with a tappable row → navigates to the report page;
  plus a new **total capacity** input.
- **New route** `/settings/sales-report` — dedicated page (not a modal or inline section).
- **Data** — new `total_capacity` settings key (migration 062); new `deposit_refunded_amount`
  column on `tenants` (migration 063, exact-refund tracking). Report queries reuse existing
  `payments`, `tenants`, `reservations`, `rooms`, and `settings` tables.
- **Export** — a JS PDF library (jsPDF) + a small Kotlin/Android plugin for writing the PDF into
  Downloads with permission handling on older devices (tested on Realme).

---

## 2. Navigation & entry point

- Add a new card at the **bottom** of the Settings page, after all existing sections
  (Appearance, Backup, Notifications, Receipts/House name, Deposits, About):
  - Title: **Reports**
  - One tappable row: **Sales Report** with a `›` chevron, styled like a list row.
  - Tapping it navigates to `/settings/sales-report` (SvelteKit `goto`, standard `<a href>`).
  - The existing settings gear stays highlighted while on `/settings/sales-report`
    (`page.url.pathname.startsWith("/settings")`).
- **Android back button**: the page is a real route, so the existing WebView history /
  native back handling already returns to Settings. No overlay registration needed on this page
  (unless a future export-picker overlay is added).

**Route**: `src/routes/settings/sales-report/+page.svelte` (+ nothing special needed in a
layout — `settings` has no layout file today, page is standalone).

---

## 3. Filtering

### 3.1 Mode toggle

- A segmented toggle with two modes: **Month** (default) and **Year** (same visual language as
  the tenants/reservations segmented tabs).

### 3.2 Month mode

- Shows a month + year picker: `◀ May 2026 ▶`. The label uses `formatMonthKey()` ("August 2026").
- The period is that whole month (`YYYY-MM-01` .. last day of month).

### 3.3 Year mode

- Shows a year picker: `◀ 2026 ▶` (4-digit year).
- The period is that whole year (`YYYY-01-01` .. `YYYY-12-31`).

### 3.4 Navigation rules (per interview)

- **Free navigation back in time**: both pickers let the landlord step back arbitrarily far
  (current → last year → two years ago → ...) by tapping ◀ repeatedly. There is **no** lower
  bound imposed by data age.
- **Forward capped at the current period**: ▶ is disabled once the selected period equals the
  current month (month mode) or current year (year mode). No future periods.
- Default on open: **current month, Month mode**.
- Reuse `addMonthsKey()`/`formatMonthKey()` from `src/lib/format.ts`; the year picker is a
  simple +/- 1 on the year integer. ISO `YYYY-MM-DD` strings compare lexicographically, which is
  correct for all date-range queries.

---

## 4. Data rules

### 4.1 Sales = cash in (net of refunded deposits)

Sales for the filtered period =

```
+ payments.amount where payments.paid_date ∈ [periodStart, periodEnd]
+ reservations.deposit where reservations.reservation_date ∈ [periodStart, periodEnd]
    AND reservations.status != 'cancelled'
− refunded deposits (see 4.4)
```

- **Basis is cash-received (`paid_date`)** for payments — NOT `covers_month`. An advance
  payment lands entirely in the month the cash actually came in. (Decision from interview:
  "Cash basis + reservation deposits".)
- All payment rows count (single-due-date and legacy multi-month rows alike), regardless of the
  tenant's current status.
- **Reservation holding deposits** count as sales on their `reservation_date` as long as the
  reservation is not `cancelled` (active or converted both count).

### 4.2 "Officially accepted reservation" rule

- **All tenants count** for move-ins, move-outs, and (via payments) sales — including tenants
  added directly without a reservation. (Interview decision: "All tenants count".)
- **Cancelled reservations are excluded entirely**: a cancelled reservation's deposit never
  appears in sales, and it never produces a move-in/move-out (it can't — cancellation only
  affects reservations, and we don't model one as a tenant event).
- No new tenant↔reservation link column is needed.

### 4.3 Move-ins & move-outs

- **Move-in** event: every tenant with `move_in_date ∈ [periodStart, periodEnd]`.
- **Move-out** event: every tenant with `moved_out_date ∈ [periodStart, periodEnd]` (archived
  tenants included — `moved_out_date` is the true historical date).
- A tenant who both moves in and out within the period appears in **both** lists.
- Each line shows, ordered by date then name:
  `Move-in: {name} — {Mon DD} · {Room {room_number}} · {₱rate}/mo`
  e.g. `Move-in: Juan D. — Apr 27 · Room 101 · ₱4,500/mo`
  (date via existing `formatDate`/a short `Mon DD` formatter; rate = `tenant.monthly_rate`
  snapshot, formatted with `phpPeso`.)
- Lists are empty-safe: if there are no move-ins in a period, show **"No move-ins this period."**
  (the page only shows its dedicated empty state when *everything* is empty — see §4.6).

### 4.4 Refunded deposits (net cash out — exact amount tracked)

- A deposit refund at move-out **subtracts the exact amount actually returned**, in the period
  containing their `moved_out_date`, whenever `deposit_refunded = 1`. (Review-2 decision:
  "Track exact refund going forward".)
- **New column** `tenants.deposit_refunded_amount REAL NOT NULL DEFAULT 0` (migration 063):
  - `refundDeposit()` (`src/lib/tenant-actions.ts`) is updated to capture the tenant's
    `deposit_held` **before** zeroing it and store it here — that IS the exact cash returned
    (whole months are applied whole, so `deposit_held` at refund time is unambiguous).
  - **Legacy backfill** (migration 063): rows already `deposit_refunded = 1` get
    `deposit_refunded_amount = deposit_amount` — a best guess; exact history is unrecoverable.
    Document this in a code comment.
- Report subtraction: `deposit_refunded_amount` (not `deposit_amount`). This removes the
  double-deduction where a deposit portion applied to months (recorded as a 'Held balance'
  sale elsewhere) was wrongly deducted again at move-out.
- Applies only on the tenant's `moved_out_date`. A refund taken in this period for a deposit
  received months earlier nets it out here (cross-period, same as before — documented
  behavior, still accurate for a cash-flow-style report).
- Cancelled reservations' deposits: never counted as sales in the first place (§4.1), so there
  is nothing to subtract — cancellation refunds are out of scope for tracking.
- Net result can be negative for a period (refunds > payments + deposits); display the
  negative value (e.g. `−₱1,500`) rather than clamping to zero.

### 4.5 Occupancy

- **Display**: `occupied ÷ total_capacity × 100`, e.g. `18/20 (90%)`.
- **Occupied** = beds occupied by active tenants **at the end of the selected period**:
  `SUM(tenants.beds_occupied)` where `move_in_date <= periodEnd` and
  (`moved_out_date IS NULL OR moved_out_date > periodEnd`).
  - For a **past** month/year: the last day of that month/year.
  - For the **current** in-progress month: **today** (consistent with the "as of today" label).
- **Total capacity** = the new manual `total_capacity` settings value (see §7). It is
  **beds**, not rooms (rooms can be shared; the app already treats a room's `capacity` as bed
  slots).
- Reservation holds are **not** counted as occupied in the report (occupied = current tenants'
  beds only). Review-2 decision: "Tenants only (current spec)" — the report answers
  "heads in beds at end of period", not the rooms page's effective-occupancy view. Kept as
  documented behavior.
- If `total_capacity` is `0`/empty/unset, render **"Set total capacity in Settings to see
  occupancy"** in place of the occupancy line.

### 4.6 Empty state

- The dedicated empty state ("**No activity this period**") appears **only when all three are
  zero**: sales = 0 **and** no move-ins **and** no move-outs.
- Otherwise every section renders, with per-section "none" text (e.g. "No move-ins this
  period.") where a specific list is empty. (Interview decision: "Empty only if truly no
  activity".)

### 4.7 "As of today" label

- Show a badge/note **"as of today"** next to the report title whenever the selected period
  **contains today** (i.e. current month in month mode, current year in year mode) — the data is
  not final (interview decision: any period containing today, incl. year mode).
- The badge also prints on the PDF (§8).

---

## 5. Page layout & chart

### 5.1 Order (top → bottom)

1. **Header**: "Sales Report" title + period label (`August 2026` / `2026`) + "as of today"
   badge when applicable.
2. **Filter controls**: mode toggle (Month / Year) + period picker.
3. **Bar chart** card (sales per bucket, §5.2).
4. **Sales total** — net sales for the period, `phpPeso()` (e.g. `₱18,500`).
5. **Move-ins** list (`Move-in: {name} — {Mon DD} · {Room} · {rate}/mo`).
6. **Move-outs** list (`Move-out: {name} — {Mon DD} · {Room} · {rate}/mo`).
7. **Occupancy** line: `18/20 (90%)`.
8. **Export** button: **Download PDF** (primary), with busy state "Generating…".

### 5.2 Bar chart

- **Hand-rolled** bars with plain HTML/CSS (a flex row of divs whose heights scale from the
  max bucket) — zero dependency, matches the app's minimal style, fully theme-aware, and
  renders identically in the PDF (vector shapes drawn in jsPDF for export). No chart library
  is installed and none is added.
- Backend math stays in a pure `src/lib/sales-report.ts` (like `earnings.ts`) so it is
  unit-testable.
- **Buckets (interview decision)**:
  - **Month mode**: one bar per **week** (4–5 bars: weeks partitioned by calendar day-of-week,
    partial weeks merged at the edges). Each bar = sum of sales (payments + deposits − refunds)
    for that week.
  - **Year mode**: one bar per **month** (12 bars, Jan–Dec).
- Each bar shows its bucket label (week start date or month short name) and the ₱ value on
  tap/long-press or as an always-on small label above the bar (label only if it fits; keep
  phone-friendly density).
- Zero-bucket bars render at a 2px stub so the shape stays readable; a period with activity
  elsewhere never shows gaps as missing bars.

---

## 6. Export (PDF)

### 6.1 Approach (locked in review 2)

- **jsPDF + jspdf-autotable** (`jspdf`, `jspdf-autotable` npm packages) to generate a real
  text/vector PDF with automatic page breaks and clean tabular layout for the move-in/
  move-out lists (autotable); the bar chart is drawn as jsPDF vector rectangles. pdf-lib is
  rejected (more manual layout code for the same result). No relationship to the existing PNG
  receipt flow (`html-to-image` + GallerySaver) — those stay untouched.
- The PDF is built from the **same data** the page currently shows (pure computations in
  `src/lib/sales-report.ts`), so generation doesn't depend on DOM scraping.

### 6.2 Destination

- **Android**: Downloads via a small Kotlin plugin (mirrors `GallerySaver.kt` pattern):
  - **API 29+**: `MediaStore.Downloads` insert with `RELATIVE_PATH = "Download/RentEase"`,
    `IS_PENDING` pattern — no permission needed.
  - **API 24–28** (e.g. older Realme on Android 9): `WRITE_EXTERNAL_STORAGE` declared with
    `android:maxSdkVersion="28"` in the manifest; request it **at the point of export** (runtime
    permission dialog on first export, before writing; documented path:
    `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS)`).
  - Invoked from Rust via the same `register_android_plugin` + `run_mobile_plugin` machinery as
    `GallerySaver` (a new `save_pdf_to_downloads` command in `src-tauri/src/lib.rs`; register a
    `pdf-saver` plugin in `run()`).
- **Desktop**: write to the OS Downloads directory (same `app.path().download_dir()` fallback
  the receipt command uses on non-Android).
- **Browser preview**: `<a download>` fallback with a JavaScript-generated Blob URL (mirrors
  `downloadInBrowser` in `src/lib/share.ts`).
- New helper in `src/lib/share.ts` (or a sibling `src/lib/pdf-export.ts`):
  `exportSalesReportPdf(dataUrl|blob, filename)` that branches Tauri vs browser.

### 6.3 PDF contents ("everything the screen shows")

1. **Header**: boarding house name from the existing `house_name` setting (top, large) +
   "SALES REPORT" + period label (`August 2026` / `2026`) + **"as of today"** note when the
   period contains today + generated-at timestamp.
2. Bar chart (weeks in month mode / months in year mode) — vector shapes so it stays crisp.
3. Net sales total (`₱…`).
4. Move-ins list with name, date, room, rate.
5. Move-outs list with name, date, room, rate.
6. Occupancy line `18/20 (90%)`.

### 6.4 Filename & errors

- `sales-report-YYYY-MM.pdf` (month mode) / `sales-report-YYYY.pdf` (year mode).
- Failure → inline error + error toast (`pushToast`, matching ReceiptModal's pattern); the
  button re-enables so the user can retry.

---

## 7. New Settings field: total capacity

- New settings key **`total_capacity`** (integer, stored as string in the key/value `settings`
  table, like `house_name`).
- **Migration 062**: `062-seed_settings_total_capacity.sql` —
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('total_capacity', (SELECT COALESCE(SUM(capacity),0) FROM rooms));`
  — seeds with the current sum of room capacities so the landlord gets a sensible starting
  number, then edits freely. Register it in `src-tauri/src/lib.rs` `migrations()`.
- **Settings UI**: inside the new **Reports** card (bottom of Settings), an editable numeric
  input **"Total capacity (beds)"** + Save, reusing the `getSetting`/`setSetting` helpers and
  the section pattern from `HouseNameSection.svelte` (load on mount, validate non-empty
  integer ≥ 1, toast on save, page-level error banner).
- This value is **beds** (interview decision: "Manual field only"; rooms can be shared, so
  capacity = bed slots is the correct semantic). It is independent of per-room `capacity`.

---

## 8. Page/component architecture

- `src/routes/settings/sales-report/+page.svelte` — page shell, filter state, data loading,
  PDF button, empty state, "as of today" badge.
- `src/lib/sales-report.ts` — pure functions + types, unit-tested like `earnings.ts` /
  `bed-boxes.ts`:
  - `salesReportQuery(...)` → raw DB rows (payments, tenants, reservations, settings).
  - `computeSalesReport(raw, period)` → totals by bucket, move-ins, move-outs, occupancy.
  - `weekBuckets(startISO, endISO)` / `monthBuckets(year)` helpers.
- `src/lib/sales-report.test.ts` — Vitest unit tests (fixtures follow `earnings.test.ts`).
- `src/lib/tenant-actions.ts` — `refundDeposit()` updated to capture `deposit_held` into
  `deposit_refunded_amount` before zeroing.
- Migrations `062` (`total_capacity` seed) and `063` (`deposit_refunded_amount` + backfill),
  both registered in `src-tauri/src/lib.rs`.
- `src/routes/settings/SalesReportRow.svelte` (or inline in `+page.svelte`) — the tappable
  Reports row.
- Kotlin: `src-tauri/gen/android/app/src/main/java/com/rentease/app/PDFSaver.kt` +
  manifest updates; Rust: new `save_pdf_to_downloads` command + plugin registration.
- Follow existing conventions: `page-header`/`card` styles, `btn btn-primary`, segmented
  toggle, `formatMonthKey`, `phpPeso`, `pushToast`, `getSetting`, error banner via page state.

---

## 9. Assumptions & known trade-offs (all resolved in review 2)

1. **Refund amount — LOCKED: exact tracking.** Refunds going forward subtract the actual
   `deposit_refunded_amount` captured at refund time (migration 063). Legacy refunds (made
   before this migration) are approximated with `deposit_amount` — exact history isn't
   recoverable because `refundDeposit()` never stored it. Acceptable: past refunds are rare
   and the approximation only affects historical periods.
2. **Cash basis = recorded-money basis — LOCKED: document in a code comment/UI note.**
   Advance cash received at move-in is held (not a payment row) and becomes a sale only when
   the landlord applies it as a 'Held balance' payment. The report's "cash basis" therefore
   means "money recorded/applied", with one exception: reservation deposits count at
   `reservation_date`. Counting advance at move-in instead would require excluding 'Held
   balance' payments from sales and diverge from Earnings — rejected in review 2.
3. **Occupancy — LOCKED: tenants only.** Reservation holds are not counted as occupied (§4.5),
   confirmed in review 2 (report answers "heads in beds at end of period").
4. **No upper bound on period navigation — settled in review 1.** Free ◀ back-nav to any past
   month/year, even pre-history (which shows the empty state, not an error).
5. **PDF library — LOCKED: jsPDF + jspdf-autotable** (§6.1). pdf-lib rejected.
6. **Bar chart — LOCKED: hand-rolled HTML/CSS bars + jsPDF vector rectangles** (§5.2). No
   chart library is added.

---

## 10. Not in scope (confirmed)

- No multi-currency support — always PHP (₱), reuse `phpPeso`/`phpPesoPrecise`.
- No partial-stay / overlap occupancy math — date-range inclusion only.
- No link from tenant back to reservation; no "reserved-only" filtering.
- No tracking of cancellation refunds (a cancelled reservation's deposit is never a sale, so
  nothing to subtract). Deposit refunds ARE tracked exactly going forward (§4.4), with legacy
  refunds approximated.
- No chart library installation (hand-rolled bars) unless rejected in review.

---

## 11. Acceptance checklist

- [ ] Settings shows a **Reports** card at the bottom with a tappable **Sales Report** row.
- [ ] `/settings/sales-report` is a dedicated page (not modal/inline).
- [ ] Month/Year toggle; month+year picker and year-only picker; free back-nav, forward capped
      at the current period; default = current month, month mode.
- [ ] Sales = payments (`paid_date`) + non-cancelled reservation deposits (`reservation_date`)
      − `deposit_refunded_amount` (exact, migration 063) in the move-out period; always ₱.
- [ ] `refundDeposit()` captures `deposit_held` into `deposit_refunded_amount` before zeroing;
      063 backfills legacy refunds with `deposit_amount`.
- [ ] Move-ins/move-outs lists with name, `Mon DD` date, room, rate.
- [ ] Occupancy `18/20 (90%)` at end of period = active tenants' beds only (holds excluded),
      driven by new manual `total_capacity` (beds) setting (migration 062 + Settings input).
- [ ] "No activity this period" only when sales AND move-ins AND move-outs are all empty.
- [ ] "as of today" badge when the period contains today (month and year modes; also on PDF).
- [ ] Bar chart: weekly buckets in month mode, monthly buckets in year mode.
- [ ] PDF export: house name in header, all screen contents, saved to Downloads on Android
      (MediaStore 29+; runtime WRITE_EXTERNAL_STORAGE request on 24–28, tested on Realme) and
      Downloads dir on desktop; `<a download>` in browser.
- [ ] `npm run check` and `npm test` pass; new `sales-report.test.ts` covers sales math,
      buckets, occupancy, and refund netting.