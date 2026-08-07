<script lang="ts">
  import { untrack } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { addMonths } from "$lib/payment-status";
  import { formatDate } from "$lib/format";
  import { effectiveOccupancy, isRoomFull, roomUnavailable } from "$lib/rooms";
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
    advance_months: "0",
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
            advance_months: String(editing.advance_months ?? 0),
            dueAuto: false,
          }
        : { ...emptyForm }
    )
  );
  let formError: string | null = $state(null);
  // The rate auto-fills from the chosen room while adding until the landlord
  // edits it (mirrors the dueAuto hint behavior).
  let rateTouched = $state(false);

  // ----- due date auto-suggest -----
  // Suggests the next due date from the move-in date: move-in + 1 month by
  // default, shifted by any advance months paid at move-in. Editable anytime.
  function suggestDue(): string {
    if (!form.move_in_date) return "";
    const advance = Math.max(1, Number(form.advance_months) || 0);
    return addMonths(form.move_in_date, advance);
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

  function advanceChanged() {
    if (form.dueAuto) form.due_date = suggestDue();
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
    if (r.maintenance === 1) return `${r.room_number} (${r.tenant_count}/${r.capacity}) — under maintenance`;
    if (r.whole_reservations > 0) return `${r.room_number} (${r.tenant_count}/${r.capacity}) — held (whole room)`;
    const slots = r.capacity - effectiveOccupancy(r.tenant_count, r.slot_reservations);
    const suffix = slots > 0 ? `— ${slots} slot${slots === 1 ? "" : "s"} left` : "— FULL";
    return `${r.room_number} (${r.tenant_count}/${r.capacity}) ${suffix}`;
  }

  function validate(): string | null {
    if (!form.name.trim()) return "Tenant name is required.";
    if (!form.contact.trim()) return "Contact number is required.";
    if (!form.room_id) return "Please select an assigned room.";
    const room = selectedRoom();
    if (!room) return "Selected room no longer exists.";
    // When adding, room must have free capacity. When editing the same tenant,
    // they occupy one slot; moving to a new room requires free space there.
    const isAdding = form.id === null;
    const currentRoomIsSame =
      form.id !== null && String(tenants.find((t) => t.id === form.id)?.room_id) === String(form.room_id);
    const occupied = room.tenant_count + room.slot_reservations;
    if (!isAdding && currentRoomIsSame) {
      // keeping them in their current room — always allowed (matches the DB
      // trigger, which skips maintenance/hold checks for same-room saves)
    } else if (room.maintenance === 1) {
      return `${room.room_number} is under maintenance. Choose another room.`;
    } else if (room.whole_reservations > 0) {
      return `${room.room_number} is held — cancel or convert the reservation first.`;
    } else if (occupied >= room.capacity) {
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
    const advance = Number(form.advance_months);
    if (String(form.advance_months ?? "").trim() === "" || !Number.isInteger(advance) || advance < 0) {
      return "Advance months must be a whole number of 0 or more.";
    }
    return null;
  }

  async function submit() {
    formError = validate();
    if (formError) return;
    const dbError = await onSave(form);
    if (dbError) {
      formError = dbError;
    } else {
      onClose();
    }
  }
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
        {:else if isRoomFull(sel.tenant_count, sel.slot_reservations, sel.capacity)}
          <span class="full">⛔ {sel.room_number} is full — no more tenants can be added.</span>
        {:else}
          <span>Available slots in {sel.room_number}: {sel.capacity - effectiveOccupancy(sel.tenant_count, sel.slot_reservations)}</span>
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
      <p class="due-hint">Suggested due date: {formatDate(suggestDue())} — edit it anytime.</p>
    {/if}

    <label>
      Deposit (₱, optional)
      <input type="number" min="0" step="0.01" placeholder="e.g. 2000" bind:value={form.deposit_amount} />
    </label>

    <label>
      Advance months paid at move-in
      <input
        type="number"
        min="0"
        step="1"
        placeholder="e.g. 1"
        bind:value={form.advance_months}
        onchange={advanceChanged}
      />
    </label>

    {#if formError}
      <p class="form-error">{formError}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button type="submit" class="btn btn-primary">Save</button>
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
</style>
