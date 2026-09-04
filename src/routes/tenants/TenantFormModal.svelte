<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { formatDate, phpPesoPrecise } from "$lib/format";
  import { effectiveOccupancy, isRoomFull, roomUnavailable } from "$lib/rooms";
  import { pushOverlay } from "$lib/back-stack";
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

  // ----- due date auto-suggest -----
  // Suggests the FIRST due date = the move-in day, so the first payment
  // records the move-in month (first-payment-month-spec.md). The landlord can
  // edit it (e.g. set next month for a late-month move-in) — the payment
  // covers whichever month the due date lands in.
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
    if (!form.name.trim()) return "Tenant name is required.";
    if (!form.contact.trim()) return "Contact number is required.";
    if (!form.room_id) return "Please select an assigned room.";
    const room = selectedRoom();
    if (!room) return "Selected room no longer exists.";
    // When adding, the room must fit the new tenant (1 bed). When editing and
    // moving to a different room, the mover's OWN beds also count against the
    // destination's free space (mirrors the DB trigger v056). Keeping them in
    // their current room is always allowed.
    const isAdding = form.id === null;
    const currentRoomIsSame =
      form.id !== null && String(tenants.find((t) => t.id === form.id)?.room_id) === String(form.room_id);
    const moverBeds = isAdding ? 1 : (tenants.find((t) => t.id === form.id)?.beds_occupied ?? 1);
    const occupied = room.occupied_beds + room.held_beds;
    if (!isAdding && currentRoomIsSame) {
      // keeping them in their current room — always allowed (matches the DB
      // trigger, which skips maintenance/hold checks for same-room saves)
    } else if (room.maintenance === 1) {
      return `${room.room_number} is under maintenance. Choose another room.`;
    } else if (room.whole_reservations > 0) {
      return `${room.room_number} is held — cancel or convert the reservation first.`;
    } else if (occupied + moverBeds > room.capacity) {
      return `${room.room_number} is full (${occupied}/${room.capacity}). Choose another room.`;
    }
    const rate = Number(form.monthly_rate);
    if (String(form.monthly_rate ?? "").trim() === "" || Number.isNaN(rate) || rate < 0) {
      return "Monthly rate must be 0 or more.";
    }
    if (!form.move_in_date) return "Move-in date is required.";
    if (!form.due_date) return "Due date is required.";
    if (form.due_date < form.move_in_date) return "Due date should not be before the move-in date.";
    const deposit = Number(form.deposit_amount);
    if (String(form.deposit_amount ?? "").trim() !== "" && (Number.isNaN(deposit) || deposit < 0)) {
      return "Deposit must be 0 or more.";
    }
    const advance = Number(form.advance_amount);
    if (String(form.advance_amount ?? "").trim() !== "" && (Number.isNaN(advance) || advance < 0)) {
      return "Advance payment must be 0 or more.";
    }
    return null;
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
    return unregister;
  });
</script>

<div class="modal" role="dialog" aria-label="Tenant form" transition:modalMaterial>
  <form class="tenant-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <h2>{form.id === null ? "Add Tenant" : "Edit Tenant"}</h2>

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
          <option value={String(room.id)} disabled={roomUnavailable(room.maintenance, room.whole_reservations)}>{roomLabel(room)}</option>
        {/each}
      </select>
    </label>

    {#if form.room_id && selectedRoom()}
      {@const sel = selectedRoom()!}
      <p class="room-hint">
        {#if sel.maintenance === 1}
          <span class="full">⛔ {sel.room_number} is under maintenance — no tenants can be added.</span>
        {:else if sel.whole_reservations > 0}
          <span class="full">⛔ {sel.room_number} is held (whole room reserved).</span>
        {:else if isRoomFull(sel.occupied_beds, sel.held_beds, sel.capacity)}
          <span class="full">⛔ {sel.room_number} is full — no more tenants can be added.</span>
        {:else}
          <span>Available beds in {sel.room_number}: {sel.capacity - effectiveOccupancy(sel.occupied_beds, sel.held_beds)}</span>
        {/if}
      </p>
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
    <p class="held-hint">💰 Held as balance — applied to months only when you apply it. Refundable per Settings.</p>

    <label>
      Advance payment (₱, held, applied first)
      <input type="number" min="0" step="0.01" placeholder="e.g. 600" bind:value={form.advance_amount} />
    </label>
    <p class="held-hint">
      💰 Held as balance — used before the deposit when you apply it.
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

  .room-hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--label-2);
  }
  .room-hint .full {
    color: var(--red-deep);
    font-weight: 700;
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
