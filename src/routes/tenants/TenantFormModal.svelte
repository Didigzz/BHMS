<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { formatDate, phpPesoPrecise } from "$lib/format";
  import { effectiveOccupancy, isRoomFull, roomUnavailable } from "$lib/rooms";
  import { validateTenantForm } from "$lib/tenant-form";
  import { pushOverlay } from "$lib/back-stack";
  import Icon from "$lib/components/Icon.svelte";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import BedDouble from "@lucide/svelte/icons/bed-double";
  import HandCoins from "@lucide/svelte/icons/hand-coins";
  import type { Room, Tenant, TenantFormState } from "./types";

  let {
    editing,
    rooms,
    tenants,
    onSave,
    onClose,
  }: {
    editing: Tenant | null;
    rooms: Room[];
    tenants: Tenant[];
    onSave: (form: TenantFormState) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  const emptyForm: TenantFormState = {
    id: null,
    name: "",
    contact: "",
    room_id: "",
    monthly_rate: "",
    move_in_date: "",
    due_date: "",
    deposit_amount: "",
    advance_amount: "",
    beds_occupied: "1",
    boarding: false,
    dueAuto: true,
  };

  // The modal is mounted per-open via {#if} in the page, so `editing` is only
  // read once at initialization — untrack() makes that one-time capture explicit.
  let form = $state<TenantFormState>(
    untrack(() =>
      editing
        ? {
            id: editing.id,
            name: editing.name,
            contact: editing.contact,
            room_id: String(editing.room_id),
            // Legacy tenants (pre-migration 031) have no rate — prefill from
            // their current room so an unrelated edit doesn't fail validation.
            monthly_rate:
              editing.monthly_rate == null
                ? String(rooms.find((r) => r.id === editing.room_id)?.monthly_rate ?? "")
                : String(editing.monthly_rate),
            move_in_date: editing.move_in_date,
            due_date: editing.due_date,
            deposit_amount: editing.deposit_amount == null ? "" : String(editing.deposit_amount),
            // The advance field holds MONEY: prefilled with the remaining
            // advance pot so editing it corrects the balance
            // (advance-money-field-spec.md §4.1).
            advance_amount: String(editing.advance_held ?? 0),
            beds_occupied: String(editing.beds_occupied ?? 1),
            // The toggle only exists in Add mode — editing is never boarding.
            boarding: false,
            dueAuto: false,
          }
        : { ...emptyForm }
    )
  );
  let formError: string | null = $state(null);
  // The rate auto-fills from the chosen room while adding until the landlord
  // edits it (mirrors the dueAuto hint behavior).
  let rateTouched = $state(false);
  // True while the save is in flight — disables the buttons and blocks a
  // second submit, so a slow save can't create duplicate tenants.
  let saving = $state(false);

  /** Local ISO "YYYY-MM-DD" for today (already-boarding move-in prefill + validation). */
  function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ----- "Already boarding?" toggle (Add mode only) -----
  // ON = backfilling a tenant who moved in before the system was introduced:
  // the move-in date prefills with today, the due-date auto-suggest is
  // disabled (the landlord types the actual next rent due date), the beds
  // field appears, and room checks are skipped (the tenant is already there).
  // Turning OFF restores the previous auto-suggest state (spec §3.1: reverts
  // to today's exact Add behavior) but never clears typed values.
  let boardingDueAutoBefore = $state(true);
  function boardingChanged(checked: boolean) {
    if (checked) {
      boardingDueAutoBefore = form.dueAuto;
      if (!form.move_in_date) form.move_in_date = todayIso();
      form.dueAuto = false;
    } else {
      form.dueAuto = boardingDueAutoBefore;
    }
  }

  // ----- "Already boarding?" help tooltip (Add mode only) -----
  // The explanatory text lives behind the small "?" button: desktop hovers
  // it, touch taps to toggle, keyboard focus (Tab) shows it. Tapping outside,
  // blurring, or pressing Esc hides it again — there is no close button.
  let helpOpen = $state(false);
  // The pointer that opened the tooltip. A mouse hover already shows it, so a
  // following mouse click must not immediately toggle it back off.
  let helpPointerType = "";

  function onHelpPointerEnter(e: PointerEvent) {
    if (e.pointerType === "mouse") helpOpen = true;
  }
  function onHelpPointerLeave(e: PointerEvent) {
    if (e.pointerType === "mouse") helpOpen = false;
  }
  function onHelpPointerDown(e: PointerEvent) {
    helpPointerType = e.pointerType;
  }
  function onHelpClick() {
    // Mouse hover owns the open state; only touch/keyboard clicks toggle.
    if (helpPointerType === "mouse") return;
    helpOpen = !helpOpen;
  }
  function onHelpFocus(e: FocusEvent) {
    // A touch tap also focuses the button but doesn't match :focus-visible, so
    // its click can still toggle the tooltip.
    if ((e.currentTarget as HTMLElement).matches(":focus-visible")) helpOpen = true;
  }
  function onHelpBlur() {
    helpOpen = false;
  }
  function onHelpKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") helpOpen = false;
  }

  // ----- due date auto-suggest -----
  // Suggests the FIRST due date = the move-in day, so the first payment
  // records the move-in month (first-payment-month-spec.md). The landlord can
  // edit it (e.g. set next month for a late-month move-in) — the payment
  // covers whichever month the due date lands in. Disabled in boarding mode.
  function suggestDue(): string {
    if (!form.move_in_date) return "";
    return form.move_in_date;
  }

  function moveInChanged() {
    if (form.dueAuto) form.due_date = suggestDue();
  }

  function roomChanged() {
    // Prefill the rate from the newly selected room when adding a tenant and
    // the landlord hasn't typed their own rate yet.
    if (form.id === null && !rateTouched) {
      const room = selectedRoom();
      if (room) form.monthly_rate = String(room.monthly_rate);
    }
  }

  function dueEdited() {
    form.dueAuto = false;
  }

  function selectedRoom(): Room | undefined {
    // form.room_id may be a string (edit mode / initial "" state) or a number
    // (Svelte's select binding returns the raw option value) — normalize both
    // sides so the comparison is type-safe.
    return rooms.find((r) => String(r.id) === String(form.room_id));
  }

  function roomLabel(r: Room): string {
    if (r.maintenance === 1) return `${r.room_number} (${r.occupied_beds}/${r.capacity}) — under maintenance`;
    if (r.whole_reservations > 0) return `${r.room_number} (${r.occupied_beds}/${r.capacity}) — held (whole room)`;
    const beds = r.capacity - effectiveOccupancy(r.occupied_beds, r.held_beds);
    const suffix = beds > 0 ? `— ${beds} bed${beds === 1 ? "" : "s"} left` : "— FULL";
    return `${r.room_number} (${r.occupied_beds}/${r.capacity}) ${suffix}`;
  }

  function validate(): string | null {
    const isAdding = form.id === null;
    const currentRoomIsSame =
      form.id !== null && String(tenants.find((t) => t.id === form.id)?.room_id) === String(form.room_id);
    const moverBeds = isAdding ? 1 : (tenants.find((t) => t.id === form.id)?.beds_occupied ?? 1);
    const room = selectedRoom();
    return validateTenantForm(
      {
        name: form.name,
        contact: form.contact,
        room_id: form.room_id,
        monthly_rate: form.monthly_rate,
        move_in_date: form.move_in_date,
        due_date: form.due_date,
        deposit_amount: form.deposit_amount,
        advance_amount: form.advance_amount,
        beds_occupied: form.beds_occupied,
      },
      {
        // The toggle only exists in Add mode, so boarding is only ever true there.
        boarding: form.boarding && isAdding,
        today: todayIso(),
        room: room
          ? {
              room_number: room.room_number,
              capacity: room.capacity,
              occupied_beds: room.occupied_beds,
              held_beds: room.held_beds,
              maintenance: room.maintenance,
              whole_reservations: room.whole_reservations,
            }
          : null,
        isAdding,
        currentRoomIsSame,
        moverBeds,
      }
    );
  }

  /** "₱600 = 1 month at ₱600/mo" — shown once both the advance amount and the
   *  monthly rate are known, so the landlord can relate the money to months
   *  without a months input (advance-money-field-spec.md §4.1). */
  const advanceMonthsHint = $derived.by(() => {
    const raw = String(form.advance_amount ?? "").trim();
    const amount = Number(form.advance_amount);
    const rate = Number(form.monthly_rate);
    if (!raw || Number.isNaN(amount) || amount <= 0 || Number.isNaN(rate) || rate <= 0) return null;
    const months = amount / rate;
    const monthsLabel =
      months < 0.05 ? "less than 1" : months < 1 ? String(Number(months.toFixed(2))) : String(Number(months.toFixed(1)));
    const noun = monthsLabel === "less than 1" ? "month" : `month${months === 1 ? "" : "s"}`;
    return `${phpPesoPrecise(amount)} = ${monthsLabel} ${noun} at ${phpPesoPrecise(rate)}/mo`;
  });

  async function submit() {
    if (saving) return;
    formError = validate();
    if (formError) return;
    saving = true;
    try {
      const dbError = await onSave(form);
      if (dbError) {
        formError = dbError;
      } else {
        onClose();
      }
    } finally {
      saving = false;
    }
  }

  // Android back button closes this modal (same path as Cancel) instead of
  // letting the WebView navigate its history.
  onMount(() => {
    const unregister = pushOverlay(onClose);
    // Mobile: a tap anywhere outside the boarding box dismisses the tooltip.
    const onDocPointerDown = (e: PointerEvent) => {
      if (!helpOpen) return;
      if ((e.target as HTMLElement | null)?.closest(".boarding-box")) return;
      helpOpen = false;
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      unregister();
    };
  });
</script>

<div class="modal" role="dialog" aria-label="Tenant form" transition:modalMaterial>
  <form class="tenant-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <h2>{form.id === null ? (form.boarding ? "Add Existing Tenant" : "Add Tenant") : "Edit Tenant"}</h2>

    {#if form.id === null}
      <div class="boarding-box">
        <div class="boarding-row">
          <button
            type="button"
            class="help-btn"
            aria-label="Help: what does Already boarding mean?"
            aria-describedby={helpOpen ? "boarding-help-tip" : undefined}
            onpointerenter={onHelpPointerEnter}
            onpointerleave={onHelpPointerLeave}
            onpointerdown={onHelpPointerDown}
            onclick={onHelpClick}
            onfocus={onHelpFocus}
            onblur={onHelpBlur}
            onkeydown={onHelpKeydown}
          >?</button>
          <label class="switch-row">
            <span>Already boarding?</span>
            <input
              type="checkbox"
              class="switch"
              checked={form.boarding}
              onchange={(e) => boardingChanged(e.currentTarget.checked)}
              aria-label="Already boarding?"
            />
          </label>
        </div>
        {#if helpOpen}
          <span class="help-tip" role="tooltip" id="boarding-help-tip">
            Use this option for tenants who moved in before the system was introduced.
          </span>
        {/if}
      </div>
    {/if}

    <label>
      Tenant name
      <input type="text" placeholder="e.g. Juan Dela Cruz" bind:value={form.name} />
    </label>

    <label>
      Contact number
      <input type="tel" placeholder="e.g. 0917 123 4567" bind:value={form.contact} />
    </label>

    <label>
      Assigned room
      <select bind:value={form.room_id} onchange={roomChanged}>
        <option value="" disabled>Select room…</option>
        {#each rooms as room (room.id)}
          <!-- In boarding mode every room is selectable — the tenant is already
               physically in it, so full/maintenance/held rooms must be pickable
               (the DB trigger skip is mirrored in validateTenantForm). -->
          <option
            value={String(room.id)}
            disabled={!form.boarding && roomUnavailable(room.maintenance, room.whole_reservations)}
          >{roomLabel(room)}</option>
        {/each}
      </select>
    </label>

    {#if form.room_id && selectedRoom()}
      {@const sel = selectedRoom()!}
      <p class="room-hint">
        {#if form.boarding}
          <span>Backfilling — room checks are skipped for already-boarding tenants. Available beds in {sel.room_number}: {sel.capacity - effectiveOccupancy(sel.occupied_beds, sel.held_beds)}</span>
        {:else if sel.maintenance === 1}
          <span class="full"><span class="lead-icon"><Icon icon={CircleAlert} size={16} /></span>{sel.room_number} is under maintenance — no tenants can be added.</span>
        {:else if sel.whole_reservations > 0}
          <span class="full"><span class="lead-icon"><Icon icon={CircleAlert} size={16} /></span>{sel.room_number} is held (whole room reserved).</span>
        {:else if isRoomFull(sel.occupied_beds, sel.held_beds, sel.capacity)}
          <span class="full"><span class="lead-icon"><Icon icon={CircleAlert} size={16} /></span>{sel.room_number} is full — no more tenants can be added.</span>
        {:else}
          <span>Available beds in {sel.room_number}: {sel.capacity - effectiveOccupancy(sel.occupied_beds, sel.held_beds)}</span>
        {/if}
      </p>
    {/if}

    {#if form.boarding}
      <label>
        Beds occupied
        <input type="number" min="1" step="1" placeholder="e.g. 1" bind:value={form.beds_occupied} />
      </label>
      <p class="held-hint"><span class="lead-icon"><Icon icon={BedDouble} size={16} /></span>Set how many beds this tenant occupies (whole number of at least 1).</p>
    {/if}

    <label>
      Monthly rate (₱)
      <input
        type="number"
        min="0"
        step="0.01"
        placeholder="e.g. 2500"
        bind:value={form.monthly_rate}
        oninput={() => (rateTouched = true)}
      />
    </label>
    {#if form.id === null}
      <p class="rate-hint">Prefills from the selected room — this is the amount charged each month.</p>
    {/if}

    <label>
      Move-in date
      <input type="date" bind:value={form.move_in_date} onchange={moveInChanged} />
    </label>

    <label>
      Due date (monthly payment)
      <input type="date" bind:value={form.due_date} onchange={dueEdited} />
    </label>

    {#if form.dueAuto && form.move_in_date}
      <p class="due-hint">
        Suggested due: {formatDate(suggestDue())} — the first payment covers this month. You can
        change it (e.g. to next month for a late-month move-in).
      </p>
    {/if}

    <label>
      Deposit (₱, optional)
      <input type="number" min="0" step="0.01" placeholder="e.g. 2000" bind:value={form.deposit_amount} />
    </label>
    <p class="held-hint"><span class="lead-icon"><Icon icon={HandCoins} size={16} /></span>Held as balance — applied to months only when you apply it. Refundable per Settings.</p>

    <label>
      Advance payment (₱, held, applied first)
      <input type="number" min="0" step="0.01" placeholder="e.g. 600" bind:value={form.advance_amount} />
    </label>
    <p class="held-hint">
      <span class="lead-icon"><Icon icon={HandCoins} size={16} /></span>Held as balance — used before the deposit when you apply it.
      {#if advanceMonthsHint} {advanceMonthsHint}. {/if}
      {#if form.id !== null}
        Shows the remaining balance — editing corrects it.
      {:else}
        Nothing is charged until you apply it.
      {/if}
    </p>

    {#if formError}
      <p class="form-error">{formError}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose} disabled={saving}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </form>
</div>

<style>
  /* ---- form ---- */
  .tenant-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .tenant-form h2 {
    margin: 0 0 4px;
    font-size: 1.2rem;
  }

  .tenant-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .tenant-form input,
  .tenant-form select {
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .tenant-form input:focus,
  .tenant-form select:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }

  /* ---- "Already boarding?" toggle (Add mode only) ---- */
  .boarding-box {
    position: relative;
    margin: 0 0 2px;
    padding: 10px 12px;
    border: 1px solid var(--separator);
    border-radius: 10px;
    background: var(--card);
  }

  .boarding-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .boarding-row .switch-row {
    flex: 1;
    min-width: 0;
  }

  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
    font-size: 0.92rem;
    color: var(--label);
    cursor: pointer;
  }

  /* iOS-style pill switch (same pattern as the Settings sections). */
  input.switch {
    -webkit-appearance: none;
    appearance: none;
    position: relative;
    width: 44px;
    height: 27px;
    margin: 0;
    border: none;
    border-radius: 14px;
    background: rgba(118, 118, 128, 0.32);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.2s ease;
  }

  input.switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 23px;
    height: 23px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15), 0 1px 1px rgba(0, 0, 0, 0.08);
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  }

  input.switch:checked {
    background: var(--green);
  }
  input.switch:checked::after {
    transform: translateX(17px);
  }
  input.switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---- compact "?" help button + tooltip ---- */
  .help-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--separator);
    border-radius: 999px;
    background: var(--fill);
    color: var(--label-3);
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .help-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .help-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    color: var(--accent);
    border-color: var(--accent);
  }

  @media (pointer: coarse) {
    /* The row is a <label>, so a 44px row makes its whole width a target
       instead of just the 44x27 switch at the end of it. */
    .switch-row {
      min-height: 44px;
    }

    /* "?" is a 22px circle between the card edge and the label. Grow the
       tappable box to 44px without moving the circle or the row, accepting that
       ~11px of the label's left edge now belongs to the button — the label is
       still tappable across the rest of its width. */
    .help-btn {
      position: relative;
    }
    .help-btn::before {
      content: "";
      position: absolute;
      inset: -11px;
    }
  }

  .help-tip {
    position: absolute;
    top: calc(100% - 2px);
    left: 0;
    z-index: 5;
    max-width: 240px;
    padding: 8px 10px;
    border: 1px solid var(--separator);
    border-radius: 10px;
    background: var(--card);
    box-shadow: var(--shadow-modal);
    color: var(--label-2);
    font-size: 0.82rem;
    font-weight: 500;
    line-height: 1.4;
  }

  .room-hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--label-2);
  }
  .room-hint .full {
    color: var(--red-deep);
    font-weight: 700;
  }

  .lead-icon {
    display: inline-flex;
    margin-right: 6px;
    vertical-align: -0.15em;
  }

  .due-hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--accent-deep);
    background: var(--accent-soft);
    border-radius: 8px;
    padding: 8px 12px;
  }

  .rate-hint {
    margin: -4px 0 0;
    font-size: 0.8rem;
    color: var(--label-3);
  }

  .held-hint {
    margin: -6px 0 0;
    font-size: 0.8rem;
    color: var(--label-3);
  }
</style>