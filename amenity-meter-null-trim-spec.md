# Amenities — `null` `.trim()` Crash on Meter Fields — Specification

Status: **Requirements locked** (interview, 4 rounds / 16 questions, Nov 8 2026).
App: RentEase / Digal Boarding House — Svelte 5 / SvelteKit (`adapter-static`, `ssr = false`) / Tauri 2 / SQLite.
Reported on the **Android phone build**, symptom surfaces on **Create Bill**.

> **Scope discipline:** a bug fix inside the Amenities billing form only.
> Three files: `src/routes/amenities/billing/AmenityBillFormModal.svelte`,
> `src/lib/amenity-billing.ts`, `src/lib/amenity-billing.test.ts`.
> **No database, migration, Rust, Tauri config, routing or other-form changes.**

---

## 1. Overview

The request, in the user's words:

> *"in Amenities there is a bug TypeError: Cannot read properties of null (reading 'trim')"*

Reported behaviour:

- Reproduced on the **installed Android build**.
- Trigger: **pressing Create Bill** (the save path), not on opening the form.
- Traffic observed: the form simply does nothing — no toast, no inline error, the sheet stays open.
  The `TypeError` appears in the console/log; nothing in the UI explains it.

The meter inputs are the only fields in the Amenities form that can hold `null` while the
component still calls `.trim()` on them.

---

## 2. Root cause

### 2.1 What Svelte writes into the state

Svelte 5 binds `type="number"` (and `type="range"`) inputs through a numeric coercion that maps an
empty input to **`null`**, not `""`:

`node_modules/svelte/src/internal/client/dom/elements/bindings/input.js` (lines 281–288):

```js
function is_numberlike_input(input) {
	var type = input.type;
	return type === 'number' || type === 'range';
}
function to_number(value) {
	return value === '' ? null : +value;
}
```

So the moment a user types into a meter field and then deletes the character (or clears it with the
Android keyboard's delete key, or selects-all + deletes), `bind:value` writes `null` into the
component state — even though that state is declared as `string`.

### 2.2 Where the component trusts a `string`

`src/routes/amenities/billing/AmenityBillFormModal.svelte`:

| Line | Code | Problem |
|------|------|---------|
| 84–88 | `let meter_start = $state<string>(editing?.meter_start != null ? String(editing.meter_start) : "");` (same for `meter_end`, `price_per_unit`) | Declares `string`, but `bind:value` can write `number \| null`. The declaration lies; TypeScript cannot see the runtime null. |
| 261–263 | `const s = meter_start.trim() === "" ? null : Number(meter_start);` (same for `e`, `p`) inside the `$derived` `meterInfo` | `.trim()` on `null` → `TypeError: Cannot read properties of null (reading 'trim')` |
| 417–419 | `meter_start: meter_start.trim() === "" ? null : Number(meter_start),` (same for `meter_end`, `price_per_unit`) in the `handleSave` payload | `.trim()` on `null` → same `TypeError` |

### 2.3 Why it appears at Save, and why on Android

- `meterInfo` is a `$derived`. Svelte evaluates it lazily, and the meter block (which reads
  `meterInfo`) only renders for `billing_method === "per_room" | "connected"`. A user who clears a
  meter field and then presses Create Bill can therefore reach `handleSave` without the derived
  ever having been read in that render pass.
- `handleSave` reads all three fields unconditionally — including when the current method is
  Shared Billing and the meter block is not on screen. That is the last `trim()` before anything
  else happens, so the crash lands on the save press.
- `handleSave` has no outer `try/catch`; the throw escapes, `saving` is never set to `true`, no
  inline `error` and no toast are produced. On a phone there is no console, so the only symptom is
  "the button did nothing".
- `$derived` evaluation failures poison the reactive graph: once `meterInfo` has thrown, the form
  can also stop updating until it is reopened — another reason the report reads as one crash.

### 2.4 Blast radius inside the form (audited)

| Field | Binding | Runtime type after clearing | Crashes? |
|-------|---------|-----------------------------|----------|
| `amenity_name` | `<input type="text" bind:value>` | `""` | no |
| `billing_period` | `<input type="month" bind:value>` | `""` (`is_numberlike_input` is false; string path) | no |
| `billing_date` | `<input type="date" bind:value>` | `""` | no |
| `notes` | `<textarea bind:value>` | `""` | no |
| `total_amount` | `<input type="number" bind:value>` | **`null`** | no — only `Number(total_amount)` and `String(...)` are used; `Number(null) === 0` and validation already returns `AMENITY_MESSAGES.amount` |
| `meter_start`, `meter_end`, `price_per_unit` | `<input type="number" bind:value>` | **`null`** | **yes** — three `.trim()` sites |
| manual per-tenant amounts | `<input type="number" value={...} oninput=...>` (not `bind:value`) | `""` (raw string handler) | no |
| exclusion reason | `<input type="text" value={...} oninput=...>` | `""` | no |

An app-wide audit for the same shape found **no other crash sites**: every other form already
coerces with `String(form.field ?? "")` before `.trim()` (`RoomFormModal` line 48/54,
`TenantFormModal` line 226, `tenant-form.ts` lines 97–119, `ReservationFormModal` line 159,
`reservations.ts` line 160). Amenities is the outlier because it declares the state as `string` and
trims it raw.

---

## 3. Decisions locked in the interview (source of truth)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Repro path | Clearing a meter field, then pressing **Create Bill** (save), on Android |
| 2 | Build | Android phone build; fix is platform-independent frontend code |
| 3 | Blank numeric semantics | **Blank = "not set"** (`null`) — the meter block stays optional |
| 4 | Fix scope | **Amenities billing form only.** No audit-driven edits to other forms |
| 5 | State handling | **Normalize where the form reads the value** (one helper), not a rewrite of state to `number \| null`, not inline `String(...)` patches |
| 6 | Total Bill Amount | **Leave its behaviour alone** — clearing keeps it blank and validation still says `Bill amount cannot be empty or negative.` |
| 7 | Save guard | **Add an outer `try/catch` around `handleSave`** so any unexpected throw becomes the existing inline `error`, form stays open |
| 8 | Partial meter | **Save whatever is filled, allow partial** — each of the three fields persists independently (today's intent) |
| 9 | Clearing a saved meter on edit | **Persist `null`** — blank means the meter is gone; the detail modal's "Meter …" line stops rendering |
| 10 | Empty-meter UX | **Nothing** — the computed `N units × P = ₱T` line is simply absent until all three are filled. No hint, no warning |
| 11 | Verification | **Static checks + browser-preview repro** (phone size, light and dark). No Android device pass required |
| 12 | Regression test | **Add a small pure-helper unit test** in `amenity-billing.test.ts` (2–3 cases) |
| 13 | Non-numeric / `NaN` input | **Blank or `NaN` → `null`** (silently "not set"), no warning |
| 14 | Helper contract | **Generic name, amenities-only use** — reusable later, no other form touched now |
| 15 | Zero vs blank | **`0` is a real value; blank is `null`.** Typing `0` saves `0` and the detail modal shows `Meter 0 → …` |
| 16 | Spec filename | `amenity-meter-null-trim-spec.md` |

---

## 4. Requirements

### 4.1 The pure helper

| ID | Requirement |
|----|-------------|
| **R1** | Add `parseOptionalNumber` to `src/lib/amenity-billing.ts`: `export function parseOptionalNumber(raw: string \| number \| null \| undefined): number \| null` |
| **R2** | Returns `null` when: `raw == null`; `raw` is a string that is blank after `.trim()`; or the numeric conversion is not finite (`NaN`, `Infinity`, `-Infinity`). |
| **R3** | Returns the number for `"0"`, `0`, `"150.5"`, `" 12 "` (trimmed), `-3`, and numeric strings with leading `+`. `-0` may normalise to `0`. |
| **R4** | Pure, side-effect free, no DB/DOM access, and no change to any existing exported function's behaviour or signature. `calculateMeterTotal` keeps accepting `number \| null` exactly as today. |
| **R5** | JSDoc in the file's existing voice: state that Svelte's `bind:value` on `type="number"` writes `null` for an empty field, which is why the form normalises on read rather than trusting `.trim()`. |

Reference shape (for the implementer, not final code):

```ts
/**
 * Svelte's `bind:value` on `<input type="number">` writes `null` when the field
 * is emptied, so form state that looks like a string can arrive here as a
 * number or null. Blank and unparsable both mean "not set"; a real 0 survives.
 */
export function parseOptionalNumber(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}
```

### 4.2 The form

| ID | Requirement |
|----|-------------|
| **R6** | In `AmenityBillFormModal.svelte`, declare the three meter states as `$state<string \| number \| null>(...)` so the type reflects what `bind:value` actually writes; initial values stay `editing?.meter_start != null ? String(editing.meter_start) : ""` (and siblings). |
| **R7** | `meterInfo` uses the helper for all three fields — no `.trim()` on raw state anywhere: `const s = parseOptionalNumber(meter_start)`, etc. Partial/blank input yields `{ units: null, total: null, error: null }` through the existing `calculateMeterTotal` early return; the units/total line stays hidden (Decision 10). |
| **R8** | The `handleSave` payload uses the helper for `meter_start`, `meter_end`, `price_per_unit`. A blank field sends `null` (Decision 9); a typed `0` sends `0` (Decision 15); a partial meter sends the filled values and `null`s (Decision 8). |
| **R9** | No other read of the three meter states may call `.trim()` or `String()` without a null guard. The display `{price_per_unit}` inside the units line is safe because that line only renders when `meterInfo.units != null`, which requires all three to be parsed. |
| **R10** | `handleSave` gains an outer `try/catch`: any unexpected throw sets the existing inline `error` to `String(e)` (the file's current convention, as used at lines 439–440), leaves the sheet open, and does not lose the entered values. The existing inner `try/catch/finally` around `createAmenityBill` / `updateAmenityBill` and the `saving` reset must keep working; no double resetting that leaves the button disabled. |
| **R11** | `total_amount` keeps its current handling (Decision 6). Do **not** route it through the new helper, and do not change `AMENITY_MESSAGES.amount`. |
| **R12** | Behaviour otherwise unchanged: validation order, duplicate check / `duplicateWarning`, connected-room `overlapWarning`, method-switch confirmation, exclusion reason validation, localStorage `amenity-billing:show-inactive`, dismiss animation, Escape/back handling. |

### 4.3 The regression test

| ID | Requirement |
|----|-------------|
| **R13** | Add a `describe("parseOptionalNumber")` block to `src/lib/amenity-billing.test.ts`, importing the helper from `./amenity-billing`. |
| **R14** | Cover at minimum: `null`/`undefined` → `null`; `""` and `"   "` → `null`; `"0"` and `0` → `0`; `"150.5"` → `150.5`; `" 12 "` → `12`; `"abc"` → `null`; `NaN`/`Infinity` → `null`. Keep to 2–3 `it` blocks as agreed. |

---

## 5. Delta list — exact edit sites

| # | File | Location | Current | Required |
|---|------|----------|---------|----------|
| Δ1 | `src/lib/amenity-billing.ts` | near `normalizeBillingPeriod` (~line 259) | — | add `parseOptionalNumber` + JSDoc (R1–R5) |
| Δ2 | `src/lib/amenity-billing.test.ts` | import block, lines 1–17 | 14 imports | add `parseOptionalNumber` |
| Δ3 | `src/lib/amenity-billing.test.ts` | after `describe("meter")` (~line 186) or near `validateBill` | — | add `describe("parseOptionalNumber")` (R13–R14) |
| Δ4 | `src/routes/amenities/billing/AmenityBillFormModal.svelte` | imports from `$lib/amenity-billing`, lines 5–17 | preset/split/validator imports | add `parseOptionalNumber` |
| Δ5 | `src/routes/amenities/billing/AmenityBillFormModal.svelte` | lines 84–88 | `$state<string>(...)` ×3 | widen to `$state<string \| number \| null>(...)` (R6) |
| Δ6 | `src/routes/amenities/billing/AmenityBillFormModal.svelte` | `meterInfo` `$derived.by`, lines 260–265 | three `.trim()` ternaries | three `parseOptionalNumber(...)` calls (R7) |
| Δ7 | `src/routes/amenities/billing/AmenityBillFormModal.svelte` | `handleSave`, lines 417–419 | three `.trim()` ternaries in the payload | three `parseOptionalNumber(...)` calls (R8) |
| Δ8 | `src/routes/amenities/billing/AmenityBillFormModal.svelte` | `handleSave`, lines ~365–445 | no outer `try` | wrap body in `try { … } catch (e) { error = String(e) }` without disturbing the inner `finally` (R10) |

Files **not** touched: `src/routes/amenities/billing/+page.svelte`,
`AmenityBillDetailModal.svelte`, `src/lib/amenity-actions.ts`, `src/lib/format.ts`, any tenant /
room / reservation form, `src-tauri/**`, `package.json`.

---

## 6. Implementation order

1. Add `parseOptionalNumber` (+ JSDoc) to `amenity-billing.ts` (R1–R5).
2. Add the unit test block and run the focused file — red/green before the UI change (R13–R14).
3. Wire the helper into `meterInfo` and the `handleSave` payload; widen the three state
   declarations (R6–R9).
4. Wrap `handleSave` in the outer `try/catch`; confirm `saving` still resets and the inline error
   renders (R10).
5. `npm run check`, `npm run test`, `npm run build`.
6. Browser-preview repro in light and dark (§8.2).

---

## 7. Edge cases

| Case | Required behaviour |
|------|--------------------|
| Type `100` in Start, delete it, press Create Bill (Shared method, meter block not visible) | No crash; payload sends `meter_start: null`; bill is created or the normal validation message appears (R8) |
| Clear Start while on Per-Room with End/Price filled | `meterInfo` returns idle; the `units × price` line disappears; save stores End + Price and `null` for Start (Decision 8) |
| Clear all three after typing | Three `null`s saved; nothing rendered in the units line; no error |
| Pick a value with the number stepper, then clear with ⌫ on Android | Same as above — `bind:value` writes `null`; no `.trim()` reaches it |
| Type `0` into Start (or Price/unit) | `0` is parsed as `0`, saved as `0`; the detail modal shows `Meter 0 → …` because `!= null` (Decision 15) |
| Edit a bill that has `meter_start = 100, meter_end = 150, price = 5`, clear Price/unit, save | `price_per_unit` persists `null`; units/total line hidden; detail modal keeps showing the meter line because `meter_start != null` (existing `{#if}` at `AmenityBillDetailModal.svelte` line 47) — documented, not changed |
| Edit a bill whose meter fields are already `null` | Inputs open blank; saving without touching them sends `null`s — unchanged |
| Paste `"abc"` / `"1e"` into a number input | Browser/Android rejects the characters, or the field reads `null`/`NaN`; helper maps it to `null`, no warning (Decision 13) |
| Switch billing method away from Per-Room after entering meter values | Method-switch confirmation clears tenant/room selections but **not** the meter fields (existing behaviour); the saved payload still carries them — preserved |
| Any unexpected throw during save (e.g. DB down) | Inline `error` shows the message, sheet stays open, entered values survive, Save button re-enabled (R10) |
| Cancelled bill edited? | Not reachable via UI (Edit is hidden for cancelled bills at `+page.svelte`); no extra guard required |
| Shared billing save with meter fields still holding old values | Unchanged: values are saved as-is; the meter line renders in the detail modal |
| Dark theme / reduced motion | No visual change from this fix |

---

## 8. Verification plan

### 8.1 Static (required)

One command, each step's exit status reported separately:

```bash
npm run check; echo "check=$?"
npx vitest run src/lib/amenity-billing.test.ts; echo "test=$?"
npm run build; echo "build=$?"
```

- `npm run check` — 0 errors. Widening the three states to `string | number | null` must not
  introduce new `svelte-check` diagnostics; existing warnings unchanged.
- Focused vitest run is green, including the new `parseOptionalNumber` block. Full `npm test` as a
  no-regression pass.
- Build succeeds.
- Grep assertion: no remaining `meter_start.trim()` / `meter_end.trim()` /
  `price_per_unit.trim()` in `AmenityBillFormModal.svelte`.

### 8.2 Browser-preview repro (required)

`RENTEASE_PREVIEW=1 npm run dev`, at **390×844**, light and dark:

1. Amenities → **+ Add New Bill** → Billing Method **Per-Room**.
2. Type `100` into **Start**, then delete it → the units/total line must not appear and nothing
   throws (before the fix this is where `meterInfo` throws).
3. Fill Start `100`, End `150`, Price `5` → `50 units × 5 = ₱250.00`; clear Start → line hides.
4. Clear **Price/unit** only → save → **Create Bill** succeeds; open **View Details** → no crash,
   meter line reflects what was saved.
5. Repeat step 2 with the method set to **Shared** (meter block hidden) and press **Create Bill** —
   this is the reported path; it must save, not die silently.
6. **Edit** an existing per-room bill, clear one meter field, **Save Changes** → persists `null`
   (reopen Edit; the field is blank; the detail modal's meter line reflects the remaining values).
7. Type `0` in Start/End/Price → total `0`, save works, no "not set" collapse.
8. Sanity: duplicate warning, connected-room overlap warning, exclusion reason, and the
   Paid/Unpaid toggle still behave as before.

### 8.3 Not required

- Android APK build / device pass (Decision 11) — recorded as a limitation with the fix limited to
  frontend code that is shared by every build.
- Screenshot diffing; component/DOM test tooling (not installed, and not needed for this fix).
- New Rust/migration tests.

---

## 9. Out of scope (explicit)

- **Other forms' numeric inputs** — tenants, rooms, reservations. They already coerce through
  `String(x ?? "")` before trimming and cannot hit this bug; no edits, no opportunistic cleanup.
- **`total_amount`** — its null state is harmless; behaviour and message stay exactly as today
  (Decision 6).
- **Rewriting meter state to `number | null`** — rejected in favour of read-time normalization
  (Decision 5); the state stays string-capable for mid-typing values.
- **Partial-meter validation or hints** — no new messages, no "fill all three" warning, no
  `AMENITY_MESSAGES` additions (Decisions 8, 10).
- **Detail modal changes** — `AmenityBillDetailModal.svelte` is untouched, including its
  `meter_start != null` condition that can show a partially-null meter line.
- **`amenity-actions.ts`, Rust commands, migrations, schema** — untouched.
- **Additional error-boundary / crash-reporting infrastructure** — only the local `handleSave`
  guard is added.
- **The `/amenities` → `/amenities/billing` redirect, list page, cancel flow, localStorage
  preference** — untouched.

---

## 10. Open questions / recorded notes (not blockers)

1. **State type honesty.** The three declarations become `string | number | null`; Svelte still
   writes numbers into them on every keystroke, so a future refactor may prefer `number | null`
   throughout. Not done here, per Decision 5.
2. **Detail modal with a partial meter.** `AmenityBillDetailModal.svelte` line 47 keys on
   `bill.meter_start != null`, so a bill with only some meter values still renders
   `Meter 100 → null @ null/unit`. Because Decision 8 allows partial saves, this is now reachable
   more easily. Fixing the display is a separate, cosmetic change and was left out of scope.
3. **Why the report said "on save" rather than "on clear".** `meterInfo` is lazy and only read for
   Per-Room/Connected bills; on Shared billing the first `.trim()` executed is inside
   `handleSave`. After this fix both paths are safe, so the distinction stops mattering.
4. **`NaN` is silent.** A value the helper cannot parse becomes "not set" with no feedback
   (Decision 13); number inputs make this hard to reach in practice.

---

## Appendix A — Before / after

```
Before:  <input type="number" bind:value={meter_start}>
         → user clears field → meter_start === null
         → handleSave: meter_start.trim()        → TypeError: Cannot read properties of null
         → no toast, no inline error, button appears dead

After:   handleSave: parseOptionalNumber(meter_start) → null
         → payload sends meter_start: null, bill saves
         → any unexpected throw → inline `error` text, sheet stays open
```

## Appendix B — Interview record

| Round | Questions | Answers |
|-------|-----------|---------|
| 1 | Repro action · build · blank-number semantics · fix scope | save/Create Bill · Android · blank = "not set" · amenities form only |
| 2 | state handling · Total Bill Amount · save guard · partial meter | normalize on read · leave total alone · add try/catch · allow partial |
| 3 | clearing a saved meter · empty-meter UX · verification · regression test | persist null · show nothing · static + browser repro · pure-helper unit test |
| 4 | NaN handling · helper naming · 0 vs blank · spec filename | blank/NaN → null · generic name, amenities-only · 0 is real · `amenity-meter-null-trim-spec.md` |
