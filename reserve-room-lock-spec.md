# Reserve from Room Card — Bug Fix + Locked-Room Flow

Status: **Interview locked** (4 rounds, Sep 6 2026)
App: RentEase — Svelte 5 / SvelteKit (adapter-static) / Tauri 2 / SQLite (`@tauri-apps/plugin-sql`)

---

## 1. Overview

Three related changes to the **Reserve** entry point on room cards:

1. **Bug fix** — clicking Reserve on a room card currently flashes an extra view (the
   room-details bottom sheet) and lands on the reservations page in two visual stages.
   The target is a clean, single-step transition.
2. **Feature** — when Reserve is entered from a room card, that room is **locked**: the
   reservation form shows it as a static read-only line and the user cannot switch rooms.
3. **Feature** — the hold-type options and the Save button must respect a room's **real
   remaining capacity**: "Whole room" cannot be saved on a partially occupied room, custom
   bed counts cannot exceed the free beds, and Save is disabled for any capacity-invalid
   selection — on **both** the room-card flow and the general Reservations page.

Decisions below are from the interview (all confirmed):

| Topic | Decision |
|---|---|
| Target UX | Reserve on a room card opens the reservation form as a **modal on the Room page** — **no navigation** to `/reservations`, no URL change |
| Glitch scope | Seen on **Android** (Tauri WebView); both a bottom-sheet flash AND a two-stage page (loading list, then modal pop) |
| Locked room UI | Static read-only line (`Room 101 — 1/4 occupied · 3 beds free`), no room select |
| Stale locked room | Stay locked; re-check availability live and disable only the exact invalid options |
| Hold-type options | Keep the **Whole room / One bed / Custom** dropdown; invalid entries are **disabled (greyed)** |
| Save gating | Save disabled **only for capacity-invalid selections**; name/contact/dates still validate on submit, as today |
| Scope | Capacity rules apply **everywhere** — locked flow and the general Reservations page |
| Default hold type | Auto-switch to **One bed** when "Whole room" is invalid for the locked room |
| Deep link | `/reservations?room=X` opened directly (manual URL / restored tab) → form pre-selects the room but it stays **editable** (not locked) |
| Disabled reason | Show a **hint line** under the hold-type control when an option is disabled for capacity (e.g. "Whole room unavailable — 1 of 4 beds occupied") |

---

## 2. Current behavior (root cause analysis)

### 2.1 The Reserve button today

`src/routes/rooms/RoomCard.svelte` renders Reserve as a plain anchor inside a clickable
card body:

```html
<div class="room-main" role="button" tabindex="0" onclick={view} onkeydown={onKeydown} …>
  …
  <a class="btn btn-small btn-reserve" href={`/reservations?room=${room.id}`}
     onclick={(e) => e.stopPropagation()}>Reserve</a>
</div>
```

The card body's `view()` opens the `RoomDetailSheet`; `onKeydown` guards:

```js
if ((e.target as HTMLElement).closest("button")) return;
if (e.key === "Enter" || e.key === " ") { e.preventDefault(); view(); }
```

### 2.2 Why the glitch happens (confirmed on Android)

- **Sheet flash**: the guard only excludes `button` targets — the Reserve control is an
  `<a>`, **not a button** — so keyboard activation of the focused Reserve link (Enter/Space)
  bubbles to the card's `onkeydown`, calls `view()`, and the `RoomDetailSheet` mounts
  briefly before the anchor's navigation wins. On the Android WebView the click path can
  leak the same way (parent `role="button"` handler firing alongside the link activation).
  Result: "briefly appears to open extra views, then navigates".
- **Two-stage page**: the reservations page's `onMount` sets `formOpen = true` immediately
  from `?room=`, while `loadData()` is still loading — the modal renders with an **empty
  room dropdown** (`availableRooms` is `[]` until `rooms` resolve), and the page shows
  "Loading reservations…" + the Active/History tabs behind the modal. Result: the form
  "pops in" over a half-loaded page.

### 2.3 Why the lock is not a lock today

`?room=` → `initialRoomId` pre-fills `form.room_id`, but the Room `<select>` is fully
editable, and `holdTypeChanged()` actively resets `room_id = ""` when the room isn't
available for the newly chosen hold type.

### 2.4 Why "Whole room" can be selected but never saved today

`roomAvailableFor(room, "whole", …)` already excludes a partially occupied room from
`availableRooms`, and `validate()` rejects whole-on-occupied at submit. But the **"Whole
room" option in the Hold Type dropdown stays enabled** — selecting it empties the room
list and only an inline error appears at save time. Save is never disabled.

---

## 3. Bug fix: clean single-step Reserve from the room page

### 3.1 Target flow

- Tapping **Reserve** on a room card (when `canReserve` is true) opens the reservation
  form **as a modal on the Rooms page** — exactly like the other room-page modals
  (`RoomFormModal`, `ConfirmModal`).
- **No navigation** to `/reservations`, **no URL change**, no sheet, no loading-stage
  flash. Android back closes the modal (the form already registers
  `pushOverlay(onClose)`).
- The general **"+ Add Reservation"** button on the Reservations page is **unchanged**:
  it opens the same form on the reservations page, freely picking any room.

### 3.2 Implementation notes

- Replace the Reserve `<a href="/reservations?room=…">` in `RoomCard.svelte` with a
  `<button type="button">` wired to a new `onReserve(room)` callback prop. A button
  already satisfies the card's `onkeydown` guard (`closest("button")`) and `click`
  `stopPropagation()`, which kills both leak paths at the source.
- The Rooms page (`src/routes/rooms/+page.svelte`) gains `reserveRoom: Room | null`
  state; `onReserve` sets it and the page renders the reservation form modal
  (`{#if reserveRoom}`) with `lockedRoomId = String(reserveRoom.id)` and `rooms` passed
  from its existing query (the page's `Room` rows already carry every field
  `RoomOption` needs: `capacity`, `occupied_beds`, `held_beds`, `has_whole_hold`,
  `maintenance`).
- The modal's `onSave` on the Rooms page: same INSERT + friendly-error mapping as the
  reservations page, then **refresh the rooms list** (`loadRooms()`) so the card's held
  beds / status update immediately, toast, close the modal.
- The reservations page keeps its existing `?room=` handling (see §5.4).

---

## 4. Locked room (room-card entry)

### 4.1 Form changes

`ReservationFormModal.svelte` gains a `lockedRoomId?: string` prop:

- **Room field**: when `lockedRoomId` is set, render a **static read-only line** instead
  of the Room `<select>`:
  `Room 101 — 1/4 occupied · 3 beds free`
  (format: `{room_number} — {occupied_beds}/{capacity} occupied · {free} bed(s) free`;
  include the monthly rate for parity with the general option label is optional).
- **No room switching**: there is no control to change the room. The lock persists for
  the modal's lifetime; closing and re-opening starts fresh.

### 4.2 Capacity evaluation for the locked room

All option gating (§5) is evaluated against the locked room, live:

- `remainingBeds(room) = capacity − occupied_beds − held_beds` (as today).
- If the locked room has a `has_whole_hold = 1` (race: hold added elsewhere) → every
  hold option is invalid; Save disabled with the hint.
- If `remainingBeds ≤ 0` → every hold option invalid; Save disabled with the hint
  (e.g. "Room is full").
- If `maintenance = 1` (race) → every option invalid; Save disabled.

### 4.3 Stale-room policy (confirmed)

Stay locked. Re-check availability on every relevant state change and **disable only the
exact invalid options** (whole room on partial occupancy, bed count > free beds). No
fallback to the room list, no auto-unlock.

---

## 5. Capacity validation (hold options + Save) — applies everywhere

### 5.1 Hold-type dropdown

Keep the three options — **Whole room / One bed / Custom (choose beds)** — with disabled
entries instead of removing them:

| Option | Disabled when (for the currently relevant room) |
|---|---|
| Whole room | `occupied_beds > 0` **or** `held_beds > 0` **or** `has_whole_hold = 1` (room not fully vacant) |
| One bed | `remainingBeds < 1` |
| Custom | never disabled in the dropdown, but the count is capped and Save gated (§5.2) |

- **Locked flow**: the relevant room is the locked room.
- **General flow**: the relevant room is the **currently selected room** in the Room
  select. When no room is selected, options stay enabled (capacity can't be judged) and
  "Please select a room." remains a submit-time error, as today.
- When a room is selected and an option becomes invalid, the option renders `disabled`;
  Svelte's `<select>` shows it greyed and unselectable.

### 5.2 Custom bed count

- The "Beds to hold" number input gets `max = remainingBeds(room)` (and `min="1"` as
  today) for the relevant room.
- Typing/stepping above `max` doesn't need to clamp the value — the Save gate below
  handles it — but the input hint (§5.4) explains the cap.

### 5.3 Save button gating

The **Save Reservation** button is `disabled` **only** when the current selection is
capacity-invalid (all other fields — name, contact, dates, deposit — keep validating on
submit, exactly as today):

- `hold_type = "whole"` and the room is not fully vacant (occupied/held/whole-hold).
- `hold_type = "bed"` and `remainingBeds < 1`.
- `hold_type = "custom"` and the parsed `bed_count` is not a whole number ≥ 1, or
  `bed_count > remainingBeds(room)`.
- Room missing/unknown or the room is unavailable for any hold (full, whole-held,
  maintenance) — covered by the three bullets above when a room exists.

While Save is disabled, the existing inline `form-error` message (from `validate()`) is
**not** shown for the capacity case (it only runs on submit); instead the hint line
(§5.4) explains why.

### 5.4 Hint line (confirmed)

When any option is disabled or the custom count exceeds the cap, render a short hint
under the Hold Type control:

- Whole room disabled: `Whole room unavailable — {occupied}/{capacity} bed(s) occupied`
  (or "…already has an active hold" when `held_beds > 0` / whole-hold exists).
- Custom count over the cap: `You can hold at most {remainingBeds} bed(s)`.
- No free beds at all: `Room is full — no beds left to hold`.

The hint is a `<p class="form-error">`-style muted/amber line; it does not block
interaction beyond the disabled option/Save itself.

### 5.5 Default hold type (confirmed)

- Form default remains **Whole room** when the relevant room is fully vacant.
- When the locked room is partially occupied (whole room invalid), the form opens with
  **One bed** selected instead of Whole room — always valid when ≥ 1 bed is free.
- Same auto-switch applies on the general flow if the user selects a partially occupied
  room while "Whole room" is currently selected (option becomes disabled; the form moves
  the selection to One bed rather than leaving an invalid selection).

### 5.6 Edge cases

- **Race: room fills while the form is open** (locked or general) → options/Save re-gate
  live per §5.1–5.3; hint shows the reason.
- **`holdTypeChanged()`** must no longer clear `room_id` when the room is unavailable for
  the new hold type (today it does). Instead the invalid option is disabled before the
  user can select it; if a race still lands on an invalid state, Save is disabled + hint
  — the selection is never silently dropped.
- The DB capacity/reservation triggers remain the final backstop (they already reject
  over-capacity saves with friendly errors mapped in `saveReservation`).

---

## 6. Deep link (`/reservations?room=X`)

- The room page no longer produces this URL; existing links/history may still hit it
  (manual entry, Android tab restore).
- Behavior (confirmed): the reservation page opens the form with the room **pre-selected
  but editable** — the normal unlocked flow, `initialRoomId` as today. Only a real
  room-card tap locks the room.
- No new URL scheme is introduced for the room-card flow (it stays on the room page).

---

## 7. Architecture & files

- `src/routes/rooms/RoomCard.svelte` — Reserve becomes a `<button>` calling `onReserve`;
  new `onReserve` prop; keydown guard already covers buttons.
- `src/routes/rooms/+page.svelte` — `reserveRoom` state, renders the form modal,
  `saveReservation` handler (INSERT + friendly errors + `loadRooms()` refresh + toast).
- `src/routes/reservations/ReservationFormModal.svelte` — `lockedRoomId` prop; static
  read-only room line when locked; disabled hold options + custom cap + Save gate +
  hint line; default auto-switch to One bed; `holdTypeChanged()` no longer clears
  `room_id`.
- `src/routes/reservations/+page.svelte` — unchanged flow; shares the updated modal.
- Suggest extracting the pure capacity helpers into `src/lib/reservations.ts` (project
  convention: `earnings.ts`, `bed-boxes.ts`, `sales-report.ts`):
  `remainingBeds(room)`, `holdOptionDisabled(room, holdType, bedCount)`,
  `saveDisabledForCapacity(room, holdType, bedCount)` — unit-tested in
  `src/lib/reservations.test.ts` (Vitest).
- Optionally extract the INSERT + friendly-error mapping into the same lib so both pages
  share it instead of duplicating.

## 8. Acceptance checklist

- [ ] Tapping Reserve on a room card opens the reservation form **on the room page** —
      no navigation, no URL change, no sheet flash, no loading-stage flicker (Android).
- [ ] The locked room renders as a static read-only line (`Room 101 — 1/4 occupied ·
      3 beds free`) with no way to change rooms.
- [ ] General "+ Add Reservation" on the Reservations page still lets the user pick any
      room, unchanged.
- [ ] "Whole room" is disabled (greyed, unselectable) for a partially occupied room —
      both locked and general flows — and Save is disabled while it's the selection.
- [ ] Custom bed count capped at the room's free beds (`max` + disabled Save above cap),
      with the "You can hold at most N bed(s)" hint.
- [ ] Save disabled for every capacity-invalid selection; name/contact/dates still
      validate at submit time, as today.
- [ ] Default hold type auto-switches to One bed when Whole room is invalid for the
      locked room.
- [ ] Race cases (room fills / whole hold added while the form is open) re-gate options
      and Save live with a hint; the selection is never silently cleared.
- [ ] `/reservations?room=X` opened directly pre-selects an **editable** room.
- [ ] `npm run check` and `npm test` pass; new `reservations.test.ts` covers
      `remainingBeds`, option disabling, and Save gating for whole/bed/custom across
      vacant, partial, full, and whole-held rooms.