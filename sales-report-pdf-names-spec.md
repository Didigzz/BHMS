# Sales Report PDF — Move-in/Move-out Table Rows Are Blank (Tenant Names Missing)

Status: **Interview locked** (4 rounds, Sep 7 2026)
App: RentEase — Svelte 5 / SvelteKit (adapter-static) / Tauri 2 / SQLite (`@tauri-apps/plugin-sql`)
Related: `sales-report-spec.md` §6 (PDF export) — this is a bug fix on that feature; kept as a
standalone spec, mirroring how `reserve-room-lock-spec.md` is standalone.

---

## 1. Overview

When a landlord downloads the Sales Report PDF (Android), the **Move-ins** and **Move-outs**
tables print with **rows but no content** — the tenant names (and Date / Room / Rate cells) are
all empty. The on-screen report page shows every list correctly, so the bug is confined to the
PDF table generation in `src/lib/pdf-export.ts`.

Root cause (verified by experiment, §3): the autotable body rows are passed as **objects**
(`{ name, date, room, rate }`) while the `head` is an **array of strings**
(`["Name", "Date", "Room", "Rate"]`). jspdf-autotable v5 derives numeric column keys (0–3) from
a string-array head, then reads object rows via `row[0]`, `row[1]`, … — every lookup is
`undefined`, so **every cell** (not just Name) renders empty.

All interview decisions (confirmed):

| Topic | Decision |
|---|---|
| Where seen | **Android app** (PDF via the Kotlin PDFSaver plugin → Downloads) |
| Symptom | Table rows exist but **all four cells are blank** (empty striped rows) |
| On-screen report | Correct — names/date/room/rate all show; **PDF-only bug** |
| Fix style | Convert body rows to **plain arrays** (`[name, date, room, rate]`) — autotable's canonical head/body usage; smallest diff, look preserved |
| Regression test | **Render-level Vitest test** exercising the real pdf-export + jspdf-autotable path in Node (no DOM needed — verified) |
| Room cell | Reuse `roomLabel()` (page semantics) — also fixes a latent "Room Room 101" duplication for free-form stored numbers |
| Pagination | Keep autotable defaults: rows flow onto extra pages with the header repeated |
| Long names | Keep autotable default `overflow: 'linebreak'` — wrap, never truncate |
| Duplicate rows | Keep both rows (two tenants may legitimately share a name + date, same as the page list) |
| Visual scope | **Restore data only** — preserve current look exactly (accent header, striped theme, column widths) |
| Docs | New standalone spec only (this file) — `sales-report-spec.md` not edited |
| Verification | New render test + browser preview (`npm run dev`) — the export code path is identical across Android/desktop/browser; only the save destination differs |

---

## 2. Current behavior (as reported)

- Reproduced on the **Android app**: Settings → Reports → Sales Report → **Download PDF**.
- In the downloaded PDF, the **Move-ins** and **Move-outs** sections show a titled table
  (blue header row "Name | Date | Room | Rate") and one striped row per tenant — but every
  row's cells are **empty**. No names, no dates, no rooms, no rates.
- The same period on the report page lists tenants correctly (e.g. `Move-in: Juan D. — Apr 27 ·
  Room 101 · ₱4,500/mo`).

Because the whole table (headers + section titles + chart + totals) renders except the row
text, the failure is entirely in how row content is handed to the table library — not in the
data, the queries, or `computeSalesReport`.

---

## 3. Root cause (verified)

### 3.1 What the code does today

`src/lib/pdf-export.ts`, inside `generateSalesReportPdf()`:

```ts
function rowFor(e: { name: string; date: string; room: string; rate: number }) {
  return { name: e.name, date: shortDay(e.date), sortKey: e.date, room: `Room ${e.room}`, rate: `${peso(e.rate)}/mo` };
}

const tableRows = (rows: typeof data.moveIns) => rows.map(rowFor).map(({ sortKey, ...r }) => r);
const head = [["Name", "Date", "Room", "Rate"]];
```

and `drawList` calls:

```ts
drawTable(doc, {
  startY: cursor,
  margin: { left: MARGIN, right: MARGIN },
  head,                       // ["Name", "Date", "Room", "Rate"]  ← array of strings
  body: tableRows(rows),      // [{ name, date, room, rate }, …]   ← array of OBJECTS
  theme: "striped",
  …
});
```

Notes:

- The head row is a **string array**, so jspdf-autotable's auto-column detection
  (`createColumns` over `head[0]`) assigns each column the **numeric** `dataKey` 0, 1, 2, 3.
- The body rows are **objects**. In `parseSection`, a non-array row is read as
  `rawRow[column.dataKey]`, i.e. `row[0]`, `row[1]`, … — none of which exist on
  `{ name, date, room, rate }`. Result: `undefined` for every cell.
- The `sortKey` field added in `rowFor` and immediately stripped by the `.map(...)` is **dead
  code** — a leftover from a design where keys were mapped by name.

### 3.2 Experimental confirmation

Ran against the exact installed versions (`jspdf@^4.2.1`, `jspdf-autotable@^5.0.8`) in Node:

```ts
const table = __createTable(doc, {
  startY: 60, margin: { left: 40, right: 40 },
  head: [["Name", "Date", "Room", "Rate"]],
  body: [{ name: "Juan D.", date: "Apr 27", room: "Room 101", rate: "₱4,500/mo" }],
  theme: "striped",
});
```

Inspecting `table.body[0].cells[i].text` printed `[""]` for **all four** columns —
matching the user's report of completely blank rows. The bug affects Android, desktop, and
browser identically (they share this generation code); Android is simply where it was seen.

### 3.3 Fixes verified to work

Same probe, three candidate shapes — all render the four cells correctly:

1. **Body rows as plain arrays** `[["Juan D.", "Apr 27", "Room 101", "₱4,500/mo"]]` — the
   canonical usage documented in the README (`body: CellDef[][]`). Chosen (interview).
2. Explicit `columns: [{ header, dataKey }]` + object rows.
3. Object-shaped head whose keys are the body keys.

### 3.4 Second latent bug found along the way

`rowFor` writes `room: \`Room ${e.room}\`` literally, but the page renders
`roomLabel(e.room)` (`src/lib/format.ts`), which guards against a stored number that already
begins with "Room" (`/^room\b/i`) to avoid "Room Room 101". Room numbers are free-form in this
app, so the PDF cell can duplicate the prefix. Folded into the fix (decision table above).

---

## 4. The fix (data-only; look preserved)

Single file: **`src/lib/pdf-export.ts`**.

1. Replace the object-producing `rowFor`/`tableRows` pair with an array-producing mapper and
   delete the dead `sortKey` field:

```ts
import { roomLabel } from "./format";

const tableRows = (rows: typeof data.moveIns) =>
  rows.map((e) => [e.name, shortDay(e.date), roomLabel(e.room), `${peso(e.rate)}/mo`]);
```

   - `head` stays `[["Name", "Date", "Room", "Rate"]]` — the string-array head now aligns by
     position with the array rows, which is the supported contract.
   - `rowFor` is removed (it was only used by `tableRows`).

2. `roomLabel(e.room)` (rather than `` `Room ${e.room}` ``) makes the PDF cell identical to the
   page's room display and kills the "Room Room 101" case. It already handles free-form values
   like `"101"` → `"Room 101"` and `"Annex B"` → `"Room Annex B"`.

3. Everything else in `drawList`/`drawTable` is **untouched** so the look is byte-for-byte the
   same once the data returns:
   - head style: accent fill (`[0, 122, 255]`), white bold 9 pt text;
   - `theme: "striped"`, `styles: { fontSize: 9, cellPadding: 4 }`;
   - `columnStyles`: 0 `auto`, 1 `60`, 2 `80`, 3 `80`;
   - automatic page breaks with the header repeated (autotable default `showHead: "everyPage"`);
   - `overflow: "linebreak"` default — long names wrap within the Name column;
   - no deduping — two tenants with the same name + date each get their own row;
   - empty-list branch unchanged ("No move-ins this period." / "No move-outs this period." in
     gray when a section has no rows).

No changes to `sales-report.ts`, the report page, the Android PDFSaver plugin, filenames, or
error handling. No visual restyling.

---

## 5. Regression test (render-level, Node, no DOM)

New file **`src/lib/pdf-export.test.ts`** (Vitest, matching the `*.test.ts` convention next to
its module).

Goal: a test that **fails on the current code** and passes after the fix — proving row data
lands in the Name/Date/Room/Rate cells through the real table path, not just that a helper
returns arrays.

Approach (verified feasible in plain Node — no DOM/window needed for array tables):

1. Import `jsPDF` and `jspdf-autotable`'s `__createTable` statically (the same packages
   `generateSalesReportPdf` imports dynamically).
2. To exercise the **exact production configuration** rather than a copy of it, extract the
   table options into a tiny exported builder in `pdf-export.ts` and have `drawList` call it:

```ts
/** Table options for a move-in/move-out list — exported for the render-level test. */
export function moveListTableOptions(rows: SalesReportPdfData["moveIns"], startY: number) {
  return {
    startY,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Name", "Date", "Room", "Rate"]] as string[][],
    body: tableRows(rows),
    theme: "striped",
    headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 60 }, 2: { cellWidth: 80 }, 3: { cellWidth: 80 } },
  } as const;
}
```

   (`drawList` keeps calling `drawTable(doc, moveListTableOptions(rows, cursor))`; the
   options are structurally identical to today's.)
3. The test builds a sample list (2 move-ins incl. a name that needs `roomLabel` guarding,
   e.g. room `"Room 101"`, plus a plain `"101"`), calls
   `__createTable(doc, moveListTableOptions(rows, 60))`, and asserts for each body row:
   `row.cells[0].text[0] === name`, `row.cells[1].text[0] === short date`,
   `row.cells[2].text[0] === "Room 101"` (no duplication), `row.cells[3].text[0] === "₱…/mo"`.
   Assert the head too (`cells` of `table.head[0]` → "Name", "Date", "Room", "Rate").

Because the builder is what production passes to autotable, this is a true end-to-end guard
against the object-vs-array mismatch recurring. Extracting a full PDF text layer to assert on
`generateSalesReportPdf` output is explicitly **out of scope** — no PDF text parser is installed.

---

## 6. Verification

1. `npm test` — new `pdf-export.test.ts` passes; existing suite (incl. `sales-report.test.ts`)
   still green.
2. `npm run check` — no type errors.
3. Manual browser preview (same generation code as Android, so sufficient per interview):
   - `npm run dev` → Settings → Sales Report;
   - pick a period with move-ins/move-outs (month or year) → **Download PDF**;
   - open the PDF and confirm Move-ins and Move-outs rows show **Name | Mon DD | Room X |
     ₱rate/mo**, header row styled as before, rows striped, long lists paginating with the
     header repeated, and a stored `"Room 101"` room number not printing "Room Room 101".
   - Optional (not required by interview): repeat the download on the Android build.

---

## 7. Assumptions & out of scope

1. **Blank rows = all four cells**, per the user's report and §3.2 — the fix restores name,
   date, room, and rate together (the report only mentioned names because that is the visible
   headline of an entirely empty row).
2. The on-screen lists are correct and unchanged; no data/query/math fixes are needed.
3. Visual output is preserved exactly — no restyling, no column re-proportioning, no header
   label changes ("Name | Date | Room | Rate" stays).
4. No deduplication, no truncation of long names, page-break defaults kept.
5. `sales-report-spec.md` is **not** edited (standalone spec only); it remains accurate at the
   "what" level (§6.3 lists name/date/room/rate per row), and this file documents the "how"
   fix plus the regression guard.
6. No change to filename, error messaging, PDFSaver/Rust/browser save paths, or the chart.

---

## 8. Acceptance checklist

- [ ] Downloaded Sales Report PDF (any platform — same code path) shows each Move-ins and
      Move-outs row with the tenant's **name**, short date, room, and rate — no blank rows.
- [ ] Room cell matches page semantics via `roomLabel()`; stored `"Room 101"` prints once.
- [ ] Table look unchanged: accent header "Name | Date | Room | Rate", striped body, current
      column widths; header repeats across pages for long lists; long names wrap.
- [ ] Empty sections still render "No move-ins this period." / "No move-outs this period."
- [ ] Two tenants with the same name+date keep both rows.
- [ ] New `src/lib/pdf-export.test.ts` render-level test asserts cell content through the real
      jspdf-autotable path (and would fail on the pre-fix object-rows code).
- [ ] `npm test` and `npm run check` pass.
- [ ] Manual browser-preview export verified with a real period containing move-ins/move-outs.
