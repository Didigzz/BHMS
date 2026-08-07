<script lang="ts">
  import { untrack } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { phpPeso } from "$lib/format";
  import type { ReservationFormState, RoomOption, Scope } from "./types";

  let {
    rooms,
    initialRoomId = "",
    onSave,
    onClose,
  }: {
    rooms: RoomOption[];
    initialRoomId?: string;
    onSave: (form: ReservationFormState) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  // Mounted per-open via {#if} in the page — props are only read once at
  // initialization, so untrack() makes that one-time capture explicit.
  let form = $state<ReservationFormState>(
    untrack(() => ({
      name: "",
      contact: "",
      room_id: initialRoomId,
      reservation_date: "",
      target_move_in_date: "",
      scope: "whole",
      deposit: "",
    }))
  );
  let formError: string | null = $state(null);

  function roomAvailableFor(room: RoomOption, scope: Scope): boolean {
    if (room.maintenance === 1 || room.has_active_reservation > 0) return false;
    if (scope === "whole") return room.tenant_count === 0;
    return room.tenant_count < room.capacity;
  }

  const availableRooms = $derived(rooms.filter((r) => roomAvailableFor(r, form.scope)));

  function roomLabel(room: RoomOption): string {
    const free = room.capacity - room.tenant_count;
    const suffix = form.scope === "whole" ? "" : ` — ${free} slot${free === 1 ? "" : "s"} free`;
    return `${room.room_number} (${room.tenant_count}/${room.capacity}) · ${phpPeso(room.monthly_rate)}/mo${suffix}`;
  }

  function scopeLabel(scope: Scope): string {
    return scope === "whole" ? "whole" : "one-slot";
  }

  function selectedRoom(): RoomOption | undefined {
    return rooms.find((r) => String(r.id) === String(form.room_id));
  }

  function scopeChanged() {
    const room = selectedRoom();
    if (room && !roomAvailableFor(room, form.scope)) form.room_id = "";
  }

  function validate(): string | null {
    if (!form.name.trim()) return "Name is required.";
    if (!form.contact.trim()) return "Contact number is required.";
    if (!form.room_id) return "Please select a room.";
    const room = selectedRoom();
    if (!room) return "Selected room no longer exists.";
    if (!roomAvailableFor(room, form.scope)) {
      return `${room.room_number} is not available for a ${scopeLabel(form.scope)}-room reservation right now.`;
    }
    if (!form.reservation_date) return "Reservation date is required.";
    if (!form.target_move_in_date) return "Target move-in date is required.";
    if (form.target_move_in_date < form.reservation_date) {
      return "Target move-in should not be before the reservation date.";
    }
    // Svelte 5 binds <input type="number"> as a number (or undefined when
    // empty), so the raw value may not be a string — normalize before checks.
    const deposit = Number(form.deposit);
    if (String(form.deposit ?? "").trim() !== "" && (Number.isNaN(deposit) || deposit < 0)) {
      return "Deposit must be 0 or more.";
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

<div class="modal" role="dialog" aria-label="Add reservation" transition:modalMaterial>
  <form class="res-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <h2>Add Reservation</h2>

    <label>
      Name
      <input type="text" placeholder="e.g. Maria Santos" bind:value={form.name} />
    </label>

    <label>
      Contact number
      <input type="tel" placeholder="e.g. 0917 123 4567" bind:value={form.contact} />
    </label>

    <label>
      Hold
      <select bind:value={form.scope} onchange={scopeChanged}>
        <option value="whole">The whole room</option>
        <option value="slot">One slot (shared room)</option>
      </select>
    </label>

    <label>
      Room
      <select bind:value={form.room_id}>
        <option value="" disabled>Select room…</option>
        {#each availableRooms as room (room.id)}
          <option value={String(room.id)}>{roomLabel(room)}</option>
        {/each}
      </select>
    </label>

    {#if form.room_id && selectedRoom() && !roomAvailableFor(selectedRoom()!, form.scope)}
      <p class="form-error">That room is no longer available for a {scopeLabel(form.scope)}-room hold.</p>
    {/if}

    <label>
      Reservation date
      <input type="date" bind:value={form.reservation_date} />
    </label>

    <label>
      Target move-in date
      <input type="date" bind:value={form.target_move_in_date} />
    </label>

    <label>
      Holding deposit (₱, optional)
      <input type="number" min="0" step="0.01" placeholder="e.g. 500" bind:value={form.deposit} />
    </label>

    {#if formError}
      <p class="form-error">{formError}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button type="submit" class="btn btn-primary">Save Reservation</button>
    </div>
  </form>
</div>

<style>
  /* ---- form ---- */
  .res-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .res-form h2 {
    margin: 0 0 4px;
    font-size: 1.2rem;
  }

  .res-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .res-form input,
  .res-form select {
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .res-form input:focus,
  .res-form select:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }
</style>
