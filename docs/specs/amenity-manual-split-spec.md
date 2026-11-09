# Amenities — Per-Tenant Manual Bill Amounts — Specification

Status: **Requirements locked** (interview, 5 rounds / 21 questions, Nov 9 2026).
App: RentEase / Digal Boarding House — Svelte 5 / SvelteKit (`adapter-static`, `ssr = false`) / Tauri 2 / SQLite.

> **Scope discipline:** add a per-tenant "Manual" option to amenity bills. The equal-division
> behaviour stays the default, the three billing methods stay exactly as they are, and the
> remainder always falls back to the tenants that were **not** set manually.
> New: one migration (one column), a persisted `is_manual` flag, a manual checkbox per tenant row,
> a `Custom` badge on saved bills.
> Touched: `amenity-billing.ts`, `amenity.rs`, `amenity-actions.ts`, `preview-fallback.ts`,
> `types.ts`, `validation.ts`, `BillTenantPicker.svelte`, `AmenityBillFormModal.svelte`,
> `AmenityBillDetailModal.svelte`, `billing/+page.svelte`.
> **No** changes to billing methods, payment flow, reports, rent billing, receipts, or split of
> excluded tenants.

---

## 1. Overview

The request, in the user's words:

> *"in amenities, allow manual input in bill in 3 different types, make it an option, so the tenant
> that is not manual input will get the remain, example like 3000, 3 tenants, 1000, 1000, 100 …
> but if I want to manual 1 tenant like 500, so the another 500 with automatically go to 2 tenants
> 1250 1250"*

and, when asked how it should sit next to the existing division modes:

> *"the equal mode is still there, its just that there will be an option like a small box with
> manual bill, so the landlord can click that tenants to manually input, because not all tenants can
> be inputted with same, this is just for consideration in tenants in bill"*

### 1.1 The behaviour being asked for

A bill total of **₱3,000** across **3 tenants** divides equally at ₱1,000 each. The landlord wants to
pin **one** tenant at **₱500**; the remaining **₱2,500** must then be shared automatically by the
other **two** tenants at **₱1,250 each**. Every tenant the landlord does not set manually keeps
getting an automatic equal share of whatever is left.

This must work for **all three billing methods** — Shared Billing, Per-Room Billing (Room-Specific
Amenity), and Connected Rooms (Joint Room Billing) — and it must be an **option per tenant**, not a
bill-wide mode the landlord has to adopt first.

### 1.2 What exists today

| Piece | Where | Current behaviour |
|---|---|---|
| Split math | `calcSharedSplit` / `calcPerRoomSplit` / `calcConnectedSplit` in `src/lib/amenities/amenity-billing.ts` | The math already re-splits a remainder across the tenants without an override (`splitManual`), but the form only passes overrides when the bill is switched to the global `manual` division mode |
| Division control | `AmenityBillFormModal.svelte` → `Division Mode` select | Bill-wide `auto` / `manual`. `auto` throws away any entered amounts; `manual` shows an input on **every** tenant row |
| Tenant row inputs | `BillTenantPicker.svelte` | Amount input rendered only when `divisionMode === "manual"` |
| Manual validation | `validateBill()` and `amenity.rs::validate_input` | Manual mode requires the manual sum to equal the total (₱1 absorption window) |
| Persistence | `amenity_bills.division_mode` | Only a bill-wide flag; nothing records that an individual share was custom |
| Bill display | `billing/+page.svelte`, `AmenityBillDetailModal.svelte` | Shows the amount only; no way to tell a custom share from an automatic one |

So the arithmetic the user describes **half exists**. What is missing is (a) an explicit per-tenant
opt-in, (b) the same behaviour in per-room and connected billing, (c) the ability to keep a manual
amount while others stay automatic, and (d) anything that remembers a share was custom after saving.

### 1.3 What this spec adds

| Concept | Decision |
|---|---|
| Opt-in | A small **Manual** checkbox on every tenant row, in all 3 billing methods (decision 2) |
| Default | Unticked = automatic equal share of the remainder; a new bill always starts fully automatic (decision 4) |
| Remainder | Bill total − manual amounts, split equally across the remaining (non-manual, non-excluded) tenants, floored to centavos (decision 5) |
| Division Mode dropdown | **Stays**, alongside the per-tenant boxes (decision 3) |
| Prefill | Ticking Manual pre-fills the tenant's current automatic share, so the landlord edits ₱1,000 → ₱500 (decision 12) |
| Persistence | New per-tenant `is_manual` column; a `Custom` badge on saved bills (decisions 8, 10) |
| Over-allocation | Manual amounts adding to more than the total **block** the save (decision 6) |
| All manual | The amounts must then add up to the total within the ₱1 absorption window (decision 11) |

---

## 2. Decisions locked in the interview

| # | Topic | Decision |
|---|-------|----------|
| 1 | "3 different types" | The **three billing methods** — Shared, Per-Room, Connected — each get the manual option |
| 2 | UI control | A **per-tenant Auto/Manual checkbox** on each row |
| 3 | Division Mode dropdown | **Kept alongside** the per-tenant boxes; the equal mode remains |
| 4 | Memory | **Per bill only** — a new bill starts fully automatic; nothing is recalled from earlier bills |
| 5 | Rounding | **Floor each auto share and absorb < ₱1** by the landlord (current behaviour) |
| 6 | Manual amounts over the total | **Block the save** with a clear message |
| 7 | Blank manual field | **Blank = automatic** — no error, the tenant takes the normal automatic share |
| 8 | ₱0 manual amount | **Allowed** — a ₱0 share with a `Manual` marker |
| 9 | Exclude interaction | Excluding a tenant **hides the Manual box**; the typed amount is remembered in the open form, and on re-include the tenant rejoins **automatic** (tick cleared) |
| 10 | Persistence of the flag | **Store per tenant row** (`is_manual`) so the badge and re-editing work |
| 11 | All tenants manual | **Require the sum to match** the total within the ₱1 absorption window |
| 12 | Prefill on tick | The tenant's **current automatic share** |
| 13 | Badge on saved bills | A small **`Custom`** badge on manual shares in the bill card and bill details |
| 14 | Editing + changing the total | Manual amounts **stay fixed**; auto tenants re-split the new remainder |
| 15 | Manual amount equals the whole total | **Warn but allow** — the other tenants end up at ₱0 shares |
| 16 | Remainder summary line | **No extra line** — the per-tenant chips and the existing absorbed note are enough |
| 17 | Switching billing method | Unchanged: the existing reset applies (the landlord keeps the same method and only adds manual entries) |
| 18 | Warning wording | Inline, non-blocking, in the form when auto tenants fall to ₱0 |
| 19 | Custom amounts and exclusions | Excluded tenants are never manual and never carry a `Custom` badge |
| 20 | Validation surface | Shared between the form, the Tauri command, and the browser preview (one set of locked messages) |
| 21 | Out-of-bill scope | Rent billing, reports, receipts, and the payment ledger are untouched |

---

## 3. Behaviour

### 3.1 The per-tenant Manual control

Every tenant **on the bill** gets a compact checkbox labelled **Manual**:

| Billing method | Where the row is | Manual box placement |
|---|---|---|
| Shared | `BillTenantPicker` → `Select Tenants`, only for selected / excluded tenants | In the row's extra line, before the existing `Exclude` checkbox |
| Per-Room | `Room Occupants` list of the chosen room | In the row's extra line (this line is added; it currently only exists in manual division mode) |
| Connected | `Pooled Tenants` list | Same as per-room |

States of one row:

```
[ ] Manual        →  automatic: chip shows the equal share of the remainder
[x] Manual  500   →  fixed: input visible, chip shows 500, remainder recalculates live
[ ] Excluded      →  Manual box hidden, amount remembered in the form, share not written
```

- The box is **available regardless of the Division Mode dropdown**. It is the per-row truth.
- The box is **not** rendered for excluded tenants, and not rendered for tenants of a room that has
  none (empty-room message stays).
- Ticking a box pre-fills the input with that tenant's **current computed share** (auto share from
  the remaining pool, rounded to 2dp). Unticking clears the fixed amount for that tenant and the
  share returns to automatic.
- The amount input is a numeric field (`step="0.01"`, decimal keypad on mobile, 16px font as the
  rest of the sheet) and accepts **blank, ₱0, and any non-negative value**.
- The chip beside the row always shows the **effective share** — the fixed amount when the field has
  a value, the automatic share otherwise.
- Everything recomputes live on every keystroke; there is no "Apply" step and no extra remainder
  summary line (decision 16).

### 3.2 The split algorithm (the core deliverable)

Inputs: `total`, the included tenant ids (selected and not excluded), and a map of manual overrides
`{tenantId → amount}`.

```
manualIds   = included ids that have a manual amount (blank field = not manual)
autoIds     = included ids − manualIds
manualSum   = round2(Σ manual amount)
if manualSum > total + 0.005                → error: manual amounts exceed the total
if manualIds == included ids (nothing auto) → require total − manualSum within [0, ₱1]; else error
remainder   = round2(total − manualSum)
autoShare   = floor2(remainder / |autoIds|) (each auto tenant)
absorbed    = round2(remainder − autoShare × |autoIds|)   // 0 ≤ absorbed < ₱1
```

- Excluded tenants never enter either set; they keep their `Exclude` row, reason, and ₱0 amount.
- The landlord absorbs the floored centavos exactly as today; the existing
  `Landlord absorbs ₱x (tenants pay ₱y of ₱z)` line stays and uses the `absorbed` figure above.
- A manual amount is authoritative — it is not reduced or redistributed when the remainder is small.
- The rule applies identically in all three methods; per-room and connected already pool the right
  tenant ids, so only the override gating changes.

Worked examples:

| Total | Tenants | Manual | Result |
|---|---|---|---|
| ₱3,000 | A, B, C | A = ₱500 | A ₱500 · B ₱1,250 · C ₱1,250 |
| ₱3,000 | A, B, C | none | ₱1,000 each |
| ₱3,000 | A, B, C | A = ₱1,500, B = ₱750 | A ₱1,500 · B ₱750 · C ₱750 |
| ₱1,000 | A, B, C | A = ₱500 | A ₱500 · B ₱250 · C ₱250 |
| ₱1,000 | A, B, C | A = ₱500, B = ₱200 | A ₱500 · B ₱200 · C ₱300 |
| ₱1,000 | A, B, C | A = ₱0 | A ₱0 (Custom) · B ₱500 · C ₱500 |
| ₱1,000 | A, B, C | A = ₱500, B = ₱500, C blank | A ₱500 · B ₱500 · C ₱0 |
| ₱3,000 | A, B, C | A = ₱1,000, B = ₱1,000, C = ₱1,000 | exactly the total · absorbed ₱0 |
| ₱3,000 | A, B, C | A = ₱1,000, B = ₱1,000, C = ₱999.5 | allowed · landlord absorbs ₱0.50 |
| ₱3,000 | A, B, C | A = ₱1,000, B = ₱1,000, C = ₱999 | **blocked** — short by more than ₱1 |
| ₱1,000 | A, B, C | A = ₱700, B = ₱400 | **blocked** — over the total |
| ₱1,000 | A, B, C | A = ₱1,000 | allowed with a warning · B ₱0 · C ₱0 |
| ₱1,000 | A, B, C | A = ₱500, B excluded | A ₱500 · C ₱500 |

### 3.3 Validation matrix

| Situation | Behaviour | Message |
|---|---|---|
| Manual field blank | Treated as automatic; no error | — |
| Manual amount `0` | Accepted; ₱0 row, marked custom | — |
| Manual amount negative | Blocked | `manualNegative` (existing `negativeAmount`) |
| Σ manual > total | Blocked, inline error under the amount field / at the top of the sheet | `manualExceeds` (new) |
| Nothing auto and Σ manual < total − ₱1 | Blocked | `manualMismatchMessage` (existing) |
| Nothing auto and total − Σ manual ∈ [₱0, ₱1] | Allowed; the shortfall is absorbed | — |
| Manual amount = total, some tenants still auto | Allowed; those tenants show ₱0.00 | Inline warning `manualTakesAll` (new, non-blocking) |
| Manual field has more than 2 decimals | Rounded to 2dp when read | — |
| Excluded tenant has a remembered manual amount | Not validated, not written, tick cleared | — |
| Division Mode = manual with every tenant ticked | Same rule as "nothing auto" | `manualMismatchMessage` |

The blocked save keeps the sheet open, keeps every typed value, and never writes a bill.

### 3.4 Exclude / re-include

- Ticking **Exclude** on a manual tenant clears the `Manual` tick and hides the box and input; the
  typed amount is retained **in the open form only**.
- Unticking **Exclude** brings the tenant back **as automatic** (decision 9). If the landlord ticks
  Manual again in the same session, the retained amount is used as the prefill; otherwise the field
  starts at the current automatic share.
- Excluded rows are written with `is_manual = 0`. Nothing about an exclusion can produce a `Custom`
  badge.

### 3.5 The Division Mode dropdown, kept alongside

The dropdown stays so nothing the landlord already knows changes:

| Dropdown | Per-tenant boxes | Effect |
|---|---|---|
| Automatic equal division | Unticked | Pure equal split — today's default |
| Automatic equal division | Some ticked | Manual shares fixed, remainder equal across the rest — **the new headline behaviour** |
| Manual per-tenant amounts | All ticked | Bulk shortcut: selecting it ticks every tenant on the bill and prefills each with its current automatic share; the landlord then edits the ones that differ |
| Manual per-tenant amounts | Some unticked | Unticking a row simply returns it to automatic; the remaining manual rows still work |
| Switching back to Automatic | — | Clears all ticks but **retains the typed amounts** for the session, so a mis-click is recoverable by re-ticking |

- Switching to the automatic mode is **not** a destructive reset of the numbers; the saved bill is
  only affected when the landlord saves.
- The billing-method switch keeps its existing confirmation and reset behaviour (amounts and manual
  ticks all cleared) — decision 17.
- `division_mode` is saved as **the dropdown value**, not "manual if any tick". The per-row truth is
  the new `is_manual` column. This keeps consumers of `division_mode`
  (`AmenityBillDetailModal` "Division:" line, Rust validation) working unchanged.

### 3.6 Editing a saved bill

- Opening Edit restores the manual ticks from `amenity_bill_tenants.is_manual`, and the amount
  inputs from the stored shares. A bill saved before migration 083 with `division_mode = 'manual'`
  and no per-row flags is treated as all-manual, so its stored split is preserved instead of being
  silently recomputed equally.
- Changing the **total** keeps the manual amounts fixed and re-splits the remainder across the
  automatic tenants (decision 14). Nothing silently rewrites a custom amount.
- Changing **selected tenants / rooms** keeps the manual entries of tenants that are still on the
  bill; tenants removed from the bill lose their tick and amount.
- The existing "payments recorded — void them before editing" lock is unchanged.

### 3.7 Display on saved bills

- A small **`Custom`** badge is shown for every `is_manual = 1` share:
  - on the bill card's tenant chips (`billing/+page.svelte`),
  - on the bill details tenant rows (`AmenityBillDetailModal.svelte`).
- The badge lives in the **main column** (next to or under the room number, like the existing
  `Inactive` badge) so the fixed `1fr | amount | status` track is never widened.
- ₱0 manual shares show the `Custom` badge; the existing ₱0 treatment (`₱0.00`, status `—`, no
  payment action) is unchanged.
- Excluded rows never show it.
- The details modal's "Division:" line keeps the saved dropdown value; when the bill has manual
  rows, it appends a count: `Division: auto · 2 custom` (cosmetic, derived from the loaded rows).

---

## 4. Data model

### 4.1 Migration 083 — one column, one statement

```sql
-- 083-add_is_manual_to_amenity_bill_tenants.sql
-- Remembers which shares the landlord pinned by hand, so the bill can show a
-- `Custom` badge and re-open in the same state. Defaults to 0: every existing
-- share stays automatic (decision 4 — no behaviour change on upgrade).
ALTER TABLE amenity_bill_tenants
  ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0 CHECK(is_manual IN (0,1));
```

- One statement per file, as `scripts/smoke-sql.mjs` requires.
- Register it in `src-tauri/src/migrations.rs` as version **83**, name
  `add_is_manual_to_amenity_bill_tenants`, immediately after migration 82.
- Existing rows and existing bills upgrade to a fully automatic, badge-free state. No backfill.
- The unique/partial indexes and the `payment_status` column are untouched.
- `amenity_bill_tenants` is already in the backup table list; the added column rides along with the
  row copy. No backup-format version bump, but the round-trip must be verified (§9.3).

### 4.2 Shapes to extend

| File | Change |
|---|---|
| `src/lib/amenities/types.ts` | `AmenityBillTenantRow` gains `is_manual: number`. `CreateAmenityBillInput.tenantShares` stays `Map<number, number>`; a new `manualIds: Set<number>` (or `number[]`) is added to the input. `AmenityBillPayload.tenants` entries gain `is_manual: boolean` |
| `src-tauri/src/amenity.rs` | `AmenityTenantInput` gains `#[serde(default)] is_manual: bool`; both INSERTs write the column (included rows honour the flag, excluded rows always `0`) |
| `src/routes/amenities/billing/bill-form-types.ts` | No new union needed; the manual state is `Set<number>` in the form |
| `src/lib/amenities/validation.ts` | `ERROR_MESSAGES` gains `amenity:manual-exceeds`; `translateError` maps it (with the offending numbers when `input` is available) |

The column is **denormalised truth about the composition**, never about money: the amount column
remains the only thing the ledger and balances read.

---

## 5. Requirements

### 5.1 Pure helpers — `src/lib/amenities/amenity-billing.ts`

| ID | Requirement |
|----|-------------|
| **R1** | Add `manualExceedsMessage(sum: number, total: number): string` — e.g. `"Manual amounts cannot be more than the total bill (₱3,500.00 of ₱3,000.00)."` — and `manualTakesAllWarning: string` — `"The other tenants will have ₱0 shares."` — to the single source of locked text |
| **R2** | Add `splitManual`-based helper `splitWithManual(ids, total, overrides: Map<number, number>): SplitResult` that implements §3.2 exactly: blank map = equal split; partial overrides keep their amounts and floor-split the remainder; Σ overrides > total returns `manualExceedsMessage`; no auto tenants requires the total within `MAX_ABSORBED`; a single negative amount returns `negativeAmount` |
| **R3** | `calcSharedSplit` uses `splitWithManual` for the included ids (keeping the exclusion-reason validation and the excluded-out-of-shares rule unchanged) |
| **R4** | `calcPerRoomSplit` and `calcConnectedSplit` stop suppressing overrides in `auto` mode: whenever `manualOverrides` has entries they are applied; `mode` is retained only for signature compatibility and may be used to mean "treat every id as overridden" when the map is empty (as the dropdown bulk action guarantees) |
| **R5** | `manualOverrides` values are `round2`-ed on read; a non-finite or negative value produces `negativeAmount`, never a silent fallback |
| **R6** | Add `manualSumOf(overrides: Map<number, number>): number` and `hasZeroAutoShare(ids, overrides, total): boolean` (true when at least one non-overridden id would receive ₱0) for the form's warning |
| **R7** | `validateBill` gains optional `manualShares?: Map<number, number>`. Rules: Σ manual > total + 0.005 → `manualExceedsMessage`; manualShares covering every `tenantId` → the existing ₱1-window check; the legacy `divisionMode === "manual"` sum check stays for callers that do not pass the new field |
| **R8** | No DB, DOM, Svelte, or Tauri imports in this module (existing convention) |

### 5.2 Form — `AmenityBillFormModal.svelte`

| ID | Requirement |
|----|-------------|
| **R9** | Replace the "`division_mode === 'manual'` means pass overrides" gating: the split derivation always passes `manualAmounts` for the ids in `manualIds`, in all three methods |
| **R10** | Add `let manualIds: Set<number> = $state(new Set())` and `toggleManual(id)` |
| **R11** | Ticking Manual sets the override to the tenant's current computed share (via `shares.get(id)`), rounded to 2dp; unticking removes the override |
| **R12** | Clearing the amount field (blank) removes the override but leaves the tick; the row then shows the automatic share. Re-typing restores the fixed amount |
| **R13** | `setManualAmount` accepts `0`, rejects nothing inline (validation happens on save), and rounds to 2dp |
| **R14** | When the dropdown changes to `manual`, tick and prefill **every** currently included tenant; when it changes to `auto`, clear all ticks but keep the typed amounts in a session-only `lastManualAmounts` map |
| **R15** | Toggling Exclude clears the tick for that tenant (amount retained in `lastManualAmounts`); re-including the tenant leaves it automatic, and its next tick prefills from `lastManualAmounts` when present |
| **R16** | Deselecting a tenant in Shared mode removes its tick and its amount |
| **R17** | Switching billing method keeps the existing reset alert and clears ticks + amounts |
| **R18** | Show the absorbed line exactly as today, using the new `split.absorbed` |
| **R19** | Show `manualTakesAllWarning` as a non-blocking inline warning (muted/alert) when `hasZeroAutoShare(...)` is true and the total is valid; saving remains enabled |
| **R20** | Show `split.errors[0]` inline (already the pattern via `error` on save); a manual error must not be swallowed by the "empty split" fallback |
| **R21** | `loadEditing` restores `manualIds` from rows with `is_manual = 1`, and `manualAmounts` from **those rows only** (auto rows are recomputed, so an edit of the total re-splits them) |
| **R22** | Pass `manualIds` through to `BillTenantPicker` and into `saveAmenityBill` |
| **R23** | Do not add a remainder summary line (decision 16); the per-row chips + existing absorbed note only |

### 5.3 Tenant picker — `BillTenantPicker.svelte`

| ID | Requirement |
|----|-------------|
| **R24** | New props `manualIds: Set<number>` and `onToggleManual: (id: number) => void` |
| **R25** | Shared method: a `Manual` checkbox in the row's extra line next to `Exclude`, for every selected non-excluded tenant. The amount input appears when the tenant is manual; it is no longer tied to the global `divisionMode` |
| **R26** | Per-Room: each occupant row gets an extra line with the `Manual` checkbox and, when ticked, the amount input |
| **R27** | Connected: each pooled tenant row gets the same extra line and input |
| **R28** | The amount input keeps the existing `.small-input` styling (1rem font to avoid iOS zoom), `type="number"`, `step="0.01"`, `inputmode="decimal"`, and a `title`/`aria-label` naming the tenant |
| **R29** | Excluded rows never render the Manual box |
| **R30** | The right-hand chip keeps showing the effective share and updates live; the checkbox is a real `<input type="checkbox">` with an associated label, ≥44px hit target on coarse pointers |
| **R31** | The picker does not render for a room with no active tenants (existing `roomEmpty` message stays) |
| **R32** | Per-room and connected rows remain non-selectable exactly as today — the manual box is the only new control |

### 5.4 Save path — `bill-save.ts`

| ID | Requirement |
|----|-------------|
| **R33** | `BillSaveInput` gains `manualIds: number[]`; pass it to `validateBill` as `manualShares` (built from `shares` ∩ `manualIds`) and to `createAmenityBill` / `updateAmenityBill` as `manualIds` |
| **R34** | Validation order stays: exclusion reasons → `validateBill` → duplicate → overlap → write. A `manualExceeds` message stops at the validation step and writes nothing |
| **R35** | No change to the duplicate/overlap confirmation flows |

### 5.5 Actions and persistence — `amenity-actions.ts`, `preview-fallback.ts`, `types.ts`

| ID | Requirement |
|----|-------------|
| **R36** | `CreateAmenityBillInput` gains `manualIds: number[]`; every tenant-share write maps `is_manual = manualIds.includes(tenant_id) ? 1 : 0` |
| **R37** | `getBillWithDetails` (and the bill-list query that feeds the card chips) selects `is_manual` so the UI can badge saved shares |
| **R38** | The browser-preview fallback writes the same flag on insert and on edit, and rewrites `is_manual` for rows in the same transaction that replaces the shares |
| **R39** | `updateAmenityBill`'s share replacement preserves/updates `is_manual` from the incoming payload; excluded rows are written with `is_manual = 0` |
| **R40** | No change to balance deltas: manual amounts are still ordinary shares |

### 5.6 Rust writes — `src-tauri/src/amenity.rs`

| ID | Requirement |
|----|-------------|
| **R41** | `AmenityTenantInput` gains `#[serde(default)] is_manual: bool`; the included-share INSERT writes `?` for `is_manual`, the excluded INSERT writes `0` |
| **R42** | Validation gains the universal rules from §3.2: negative or non-finite amounts → `amenity:negative-amount`; Σ of `is_manual` amounts > `total_amount` + 0.005 → `amenity:manual-exceeds`; when **every** tenant row is `is_manual`, keep the existing ₱1-window check → `amenity:manual-sum` |
| **R43** | The existing `division_mode == "manual"` sum check stays unchanged for backward compatibility |
| **R44** | Error codes remain stable strings; no prose on the Rust side. Rounding uses the existing `round2` |
| **R45** | Editing a bill replaces shares exactly as today, writing the incoming `is_manual` for each row; no balance-delta change |
| **R46** | Register migration 83 in `migrations.rs`; no new Tauri command and no `lib.rs` change |

### 5.7 Display — `billing/+page.svelte`, `AmenityBillDetailModal.svelte`

| ID | Requirement |
|----|-------------|
| **R47** | Bill card tenant chips show a `Custom` badge when `is_manual = 1`; excluded rows never do |
| **R48** | The badge sits in `.aligned-row__main` (with the room number), uses a small pill style built from existing tokens (`--accent-soft` / `--accent` or `--gray-soft`), and must not change the row grid or force horizontal scrolling at 320px |
| **R49** | The details modal shows the same badge on each manual tenant row and appends `· N custom` to the `Division:` line when the bill has any manual rows |
| **R50** | ₱0 manual rows keep the current ₱0.00 / `—` treatment **plus** the badge; the payment flow (no action, not counted as payable) is unchanged |
| **R51** | Cancelled bills still show their rows and badges; cancelled bills are read-only as today |
| **R52** | No badge is added to the Amenities → Payments tab or the tenant Payment History (they show amounts, not split composition) |

---

## 6. Locked messages

| Key | Text |
|---|---|
| `manualExceeds` (new) | `"Manual amounts cannot be more than the total bill (₱{sum} of ₱{total})."` |
| `manualTakesAll` (new, warning) | `"The other tenants will have ₱0 shares."` |
| `manualMismatchMessage` (existing) | `"Manual tenant amounts must equal the total bill (currently {sum} vs {total})."` |
| `negativeAmount` (existing) | `"Manual tenant amounts cannot be negative."` |
| `AMENITY_MESSAGES.amount` (existing) | `"Bill amount cannot be empty or negative."` |

New Rust code → message mapping:

| Code | Message |
|---|---|
| `amenity:manual-exceeds` | `manualExceeds` (with the numbers when the input is available, mirroring the existing `amenity:manual-sum` handling in `translateError`) |

`AMENITY_MESSAGES` stays the only place the text exists; Rust returns codes only.

---

## 7. Delta list — exact edit sites

| # | File | Change |
|---|------|--------|
| Δ1 | `src-tauri/migrations/083-add_is_manual_to_amenity_bill_tenants.sql` | The `ALTER TABLE` from §4.1 |
| Δ2 | `src-tauri/src/migrations.rs` | Register version 83 |
| Δ3 | `src-tauri/src/amenity.rs` | `is_manual` on the input struct, both INSERTs, the new validation rules (R41–R45) |
| Δ4 | `src/lib/amenities/types.ts` | `AmenityBillTenantRow.is_manual`, `CreateAmenityBillInput.manualIds`, payload tenant `is_manual` |
| Δ5 | `src/lib/amenities/amenity-billing.ts` | `splitWithManual`, message builders, `validateBill` extension (R1–R8) |
| Δ6 | `src/lib/amenities/amenity-billing.test.ts` | New split and validation cases (§9.1) |
| Δ7 | `src/lib/amenities/validation.ts` | `amenity:manual-exceeds` mapping |
| Δ8 | `src/lib/amenities/amenity-actions.ts` | `manualIds` plumbing, `is_manual` writes and reads (R36–R39) |
| Δ9 | `src/lib/amenities/preview-fallback.ts` | Same writes on the browser path (R38) |
| Δ10 | `src/routes/amenities/billing/bill-form-types.ts` | Only if a shared type is wanted for the manual set (optional) |
| Δ11 | `src/routes/amenities/billing/bill-save.ts` | `manualIds` in the input + validation (R33–R35) |
| Δ12 | `src/routes/amenities/billing/BillTenantPicker.svelte` | Manual checkbox + per-row input in all 3 methods (R24–R32) |
| Δ13 | `src/routes/amenities/billing/AmenityBillFormModal.svelte` | Manual state, prefill, dropdown bulk behaviour, warning, edit restore (R9–R23) |
| Δ14 | `src/routes/amenities/billing/+page.svelte` | `Custom` badge on chips (R47–R49) |
| Δ15 | `src/routes/amenities/billing/AmenityBillDetailModal.svelte` | `Custom` badge + `· N custom` on the Division line (R49) |
| Δ16 | `src/routes/amenities/billing/bill-save.test.ts` | Expect `manualIds` in the save payload (optional assertion) |

**Explicitly not touched:** the three billing-method definitions, `AmenityPaymentSheet`,
`amenity-payments.ts` / `amenity-payment-actions.ts`, `payments` (rent) table and flows,
`earnings.ts`, `sales-report.ts`, `ReceiptModal.svelte`, tenant forms, dashboard, backup table lists,
`app.css` layout utilities.

---

## 8. Edge cases

| Case | Required behaviour |
|---|---|
| User's headline case: ₱3,000, 3 tenants, one manual ₱500 | ₱500 · ₱1,250 · ₱1,250 |
| Two manual tenants, one auto | Remainder goes entirely to the last auto tenant |
| Every tenant manual and sum = total | Allowed, absorbed ₱0 |
| Every tenant manual and sum short by ≤ ₱1 | Allowed, landlord absorbs the difference (existing note) |
| Every tenant manual and sum short by > ₱1 | Blocked, `manualMismatchMessage` |
| Every tenant manual and sum over the total | Blocked, `manualExceeds` |
| One manual amount over the total (e.g. ₱3,500 of ₱3,000) | Blocked before saving |
| One manual amount equals the total | Allowed, warning shown; other tenants get ₱0 shares |
| Manual ₱0 | Allowed; row shows ₱0.00 + `Custom`; not payable |
| Blank manual field | Treated as automatic, no error, no badge on save (the tick does not persist a custom amount) |
| Manual amount typed then cleared | Tenant returns to automatic; tick may stay on with an empty field |
| Manual amount with 3 decimals (500.005) | Rounded to 500.01 / 500.00 by `round2`; never stored with more precision |
| Manual tenant excluded | Tick cleared, box hidden, amount not written, no badge |
| Excluded tenant re-included | Rejoins automatic; the retained amount prefills only if re-ticked |
| Manual tenant deselected in Shared mode | Tick and amount dropped |
| Tenant removed then re-added in the same form | Starts automatic (the amount was dropped with the deselection) |
| Per-room bill with 2 occupants, one manual | The other occupant gets the remainder; the room-empty path is unaffected |
| Connected bill across 3 rooms, one tenant manual | Whole pooled remainder splits across the other pooled tenants, never per room |
| Editing a bill saved with 2 manual rows | Both rows restore ticked with their stored amounts |
| Editing and changing the total | Manual amounts stay fixed; auto rows re-split the new remainder; a manual sum now over the total blocks the save |
| Editing a bill saved before this migration | Rows upgrade with `is_manual = 0` and no badges. A bill whose saved `division_mode` was `manual` keeps **every** share fixed (legacy fallback, so an old manual bill is not silently re-split); an `auto` bill stays fully automatic |
| Dropping the dropdown to Manual | Every included tenant ticked and prefilled; the spreadsheets of amounts equal the previous auto split |
| Dropping the dropdown back to Automatic | Ticks cleared, typed amounts remembered for the session; shares recompute equal |
| Divisor produces sub-centavo remainder | Floor each auto share, absorbed note shows < ₱1 |
| Absorbed plus manual amounts | Absorbed still computed from total − Σ all shares, never from the manual sum alone |
| Browser preview (`RENTEASE_PREVIEW=1`) | Every flow works; `is_manual` reads back from the shim DB |
| Backdated/legacy bills | `is_manual` defaults to 0; no backfill, no badge |
| Backup / restore | The flag round-trips; no format bump |
| Cancelled bill | Badges stay visible; no editing, no split recompute |
| 320px width | `Manual` checkbox + amount input wrap inside the row's extra line; the amount/status tracks stay fixed |
| Dark mode | Badge uses theme tokens; no hard-coded colours |
| Very long tenant names | Existing ellipsis + `title` behaviour preserved; the Manual label never pushes the name out of the row |

---

## 9. Verification plan

### 9.1 Unit tests — `src/lib/amenities/amenity-billing.test.ts`

| ID | Case |
|----|------|
| **R53** | Shared: total 3000, ids [1,2,3], override {1: 500} → 500 / 1250 / 1250, no errors |
| **R54** | Shared: two overrides → the last auto tenant takes the exact remainder |
| **R55** | Shared: Σ overrides > total → `manualExceedsMessage`, shares never exceed the total |
| **R56** | Shared: all overridden, sum short by 0.5 → allowed with `absorbed = 0.5`; short by 1.5 → `manualMismatchMessage` |
| **R57** | Shared: override 0 → ₱0 share and no error |
| **R58** | Shared: excluded tenant + overrides → excluded still absent from shares, remainder splits only across included ids |
| **R59** | Per-room: 900 across 3 with override {1: 400} → 400 / 250 / 250, **including when `mode` is `"auto"`** |
| **R60** | Connected: 8000 across 3 with override {1: 3000} → 3000 / 2500 / 2500, including `"auto"` |
| **R61** | `hasZeroAutoShare` true only when a non-overridden tenant lands on ₱0 |
| **R62** | `validateBill`: manual shares over the total rejected; all-manual window unchanged; legacy `divisionMode: "manual"` path still works |
| **R63** | Rounding: 1000 − 500 over 3 auto tenants → 166.66 each, absorbed 0.02 |

Existing tests must keep passing (`calculateEqualShares`, exclusion reason, meter, period,
`parseOptionalNumber`, bill-save ordering). `calcConnectedSplit([..], 8000, new Map(), "auto")`
still yields an equal split because the override map is empty.

### 9.2 Static checks (all must exit 0)

```bash
npm run check; echo "check=$?"
npx vitest run src/lib/amenities/amenity-billing.test.ts src/routes/amenities/billing/bill-save.test.ts; echo "test=$?"
npm run build; echo "build=$?"
cd src-tauri && cargo check; echo "cargo=$?"
```

If the repo's SQL smoke runner is used for migration changes:

```bash
node scripts/smoke-sql.mjs; echo "sql=$?"
```

`svelte-check` must not gain warnings in the four touched Svelte files.

### 9.3 Manual / desktop verification

1. Create a Shared bill of ₱3,000 with three tenants: confirm ₱1,000 each.
2. Tick Manual on tenant A, confirm the input prefills ₱1,000; type 500 → B and C flip to ₱1,250,
   the absorbed line disappears, and saving writes ₱500/₱1,250/₱1,250.
3. Reopen the bill: tenant A shows the `Custom` badge and the details show `Division: auto · 1 custom`.
4. Edit, change the total to ₱3,600: A stays ₱500, B and C become ₱1,550.
5. Try A = ₱4,000: save blocked with the over-total message, all typed values retained.
6. Every tenant manual, amounts summing to the total: saves; short by ₱0.50: saves with absorption;
   short by ₱2: blocked.
7. One manual amount = the total: warning appears, save succeeds, other rows are ₱0 and have no
   payment action.
8. Per-Room and Connected bills repeat steps 2–3 with one manual tenant each.
9. Exclude a manual tenant: its box disappears and the others absorb the remainder; re-include it and
   confirm it comes back automatic.
10. Dropdown → Manual ticks everyone with prefilled amounts; back to Automatic clears ticks but keeps
    typed amounts (re-tick restores them).
11. Old bills created before the migration open fully automatic with no badges.
12. 320px width and dark mode: the Manual checkbox, input, badge, and chips fit without horizontal
    scrolling.
13. Backup → restore: the `Custom` badges and the split survive.

### 9.4 Not required

Android APK build, screenshot diffing, E2E tooling (not installed), performance benchmarks.

---

## 10. Out of scope / recorded limitations

1. **Per-tenant memory between bills.** Manual amounts are per bill (decision 4). A "fixed monthly
   share" per tenant would be a tenant-level feature and is not built here.
2. **Percentage or share-count entry.** The request's "3 types" means the three billing methods, not
   three input styles. Only peso amounts are supported.
3. **Manual amounts per room.** Per-room and connected bills pin **tenants**, not rooms; a whole-room
   fixed amount would change the pooling model.
4. **Partial payments / payment flow.** Untouched. ₱0 shares continue to be non-payable, and paid
   bills stay locked for editing.
5. **Rent billing.** The manual option is amenity-only; rent splitting is unchanged.
6. **Reports and receipts.** No change; amenity collections still stay out of Sales Report/Earnings.
7. **Deriving custom-ness from the amounts.** Explicitly rejected — a share that happens to equal an
   even split is still `Custom` if the landlord ticked it.
8. **An audit trail of manual changes.** `is_manual` records the current composition only; who changed
   a amount and when is not logged.
9. **Bulk "set all to N" action.** Not requested; the dropdown bulk-tick plus per-row edits cover it.
10. **Migration rollback.** SQLite column adds are forward-only here; downgrading the app leaves the
    column in place, defaulting to 0 (harmless).

---

## 11. Acceptance criteria

- **A1** Every tenant on an amenity bill — in Shared, Per-Room, and Connected billing — shows a
  `Manual` checkbox; unticked rows keep the automatic equal division.
- **A2** Ticking Manual prefills the tenant's current automatic share and reveals an editable amount
  field; the other tenants' chips update live.
- **A3** ₱3,000 across three tenants with one tenant at ₱500 yields ₱500 / ₱1,250 / ₱1,250.
- **A4** Manual amounts that add to more than the total block the save with
  `Manual amounts cannot be more than the total bill (₱x of ₱y).`; nothing is written.
- **A5** With every tenant manual, amounts must equal the total within the existing ₱1 absorption
  window, otherwise the save is blocked.
- **A6** A blank manual field is treated as automatic; ₱0 is a valid manual amount.
- **A7** Excluding a manual tenant hides its Manual box and removes its share; re-including it
  returns it to automatic.
- **A8** The saved bill records `is_manual` per row, shows a `Custom` badge on those shares in the
  bill card and details, and re-opens in the same state when edited.
- **A9** Editing a bill and changing the total leaves manual amounts fixed and re-splits the
  remainder across the automatic tenants.
- **A10** A manual amount equal to the whole bill is allowed with the "other tenants will have ₱0
  shares" warning.
- **A11** The Division Mode dropdown still exists; Manual bulk-ticks every tenant and Automatic
  clears ticks without losing the typed amounts during the session.
- **A12** Existing bills upgrade with `is_manual = 0`, fully automatic, no badges, and their
  balances, payments, and reports are untouched.
- **A13** `npm run check`, the focused vitest suites, `npm run build`, and `cargo check` all pass.

---

## 12. Interview record

| Round | Questions | Answers |
|-------|-----------|---------|
| 1 | What "3 types" means · where the manual control lives · fate of the Division Mode dropdown · remembering amounts | The three billing methods · per-tenant Auto/Manual checkbox · keep equal mode and add a per-tenant manual box · per bill only |
| 2 | Remainder rounding · manual sum over the total · blank manual field · ₱0 amount | Floor each share and absorb < ₱1 · block the save · blank = automatic · ₱0 allowed |
| 3 | Persisting the flag · badge on saved bills · changing the total on edit · all tenants manual | New bills reset to automatic (no cross-bill memory) · `Custom` badge · keep fixed, re-split remainder · require the sum to match |
| 4 | The dropdown · prefill · Exclude interaction · storing the flag | Keep it alongside · prefill the current automatic share · hide the box, remember the amount, re-include as automatic · persist per row |
| 5 | Re-including an excluded tenant · manual = whole total · remainder summary line · switching billing method | Keep the amount but rejoin automatic · warn but allow · no extra line · the method stays the same, only a manual option is added |
