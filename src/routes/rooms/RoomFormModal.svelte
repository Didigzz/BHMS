<script lang="ts">
  import { untrack } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import type { Room, RoomFormState } from "./types";

  let {
    editing,
    rooms,
    onSave,
    onClose,
  }: {
    editing: Room | null;
    rooms: Room[];
    onSave: (form: RoomFormState) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  const emptyForm: RoomFormState = {
    id: null,
    room_number: "",
    capacity: "",
    monthly_rate: "",
    maintenance: false,
  };

  // The modal is mounted per-open via {#if} in the page, so `editing` is only
  // read once at initialization — untrack() makes that one-time capture explicit.
  let form = $state<RoomFormState>(
    untrack(() =>
      editing
        ? {
            id: editing.id,
            room_number: editing.room_number,
            capacity: String(editing.capacity),
            monthly_rate: String(editing.monthly_rate),
            maintenance: editing.maintenance === 1,
          }
        : { ...emptyForm }
    )
  );
  let formError: string | null = $state(null);
  let saving = $state(false);

  function validate(): string | null {
    // Svelte 5 binds <input type="number"> values as numbers, so handle both
    // strings (edit mode / untouched fields) and numbers (fresh typing) safely.
    if (!String(form.room_number ?? "").trim()) return "Room number is required.";
    const capacity = Number(form.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      return "Capacity must be a whole number of at least 1.";
    }
    const rate = Number(form.monthly_rate);
    if (String(form.monthly_rate).trim() === "" || Number.isNaN(rate) || rate < 0) {
      return "Monthly rate must be 0 or more.";
    }
    // Shrinking capacity below the current headcount strands tenants in an
    // over-capacity room (the DB only guards tenant inserts) — block it.
    if (form.id !== null) {
      const existing = rooms.find((r) => r.id === form.id);
      if (existing && capacity < existing.tenant_count) {
        return `Capacity can't be less than the ${existing.tenant_count} current tenant${existing.tenant_count === 1 ? "" : "s"} in this room.`;
      }
    }
    return null;
  }

  async function submit() {
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
</script>

<div class="modal" role="dialog" aria-label="Room form" transition:modalMaterial>
  <form class="room-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <h2>{form.id === null ? "Add Room" : "Edit Room"}</h2>

    <label>
      Room number / name
      <input type="text" placeholder="e.g. Room 101" bind:value={form.room_number} />
    </label>

    <label>
      Capacity (max tenants)
      <input type="number" min="1" step="1" placeholder="e.g. 3" bind:value={form.capacity} />
    </label>

    <label>
      Monthly rate (₱, default for new tenants)
      <input type="number" min="0" step="0.01" placeholder="e.g. 2500" bind:value={form.monthly_rate} />
    </label>

    <p class="form-note">
      Status is automatic: <strong>Occupied</strong> when tenants are assigned,
      <strong>Reserved</strong> when the room is held, <strong>Vacant</strong> when free.
      The rate is the default for new tenants — existing tenants keep their own rate.
    </p>

    <label class="checkbox-label">
      <input type="checkbox" bind:checked={form.maintenance} />
      Mark as unavailable (maintenance)
    </label>

    {#if formError}
      <p class="form-error">{formError}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose} disabled={saving}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={saving}>Save</button>
    </div>
  </form>
</div>

<style>
  /* ---- form ---- */
  .room-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .room-form h2 {
    margin: 0 0 4px;
    font-size: 1.2rem;
  }

  .room-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .room-form input {
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .room-form input:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }

  .room-form label.checkbox-label {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--label-2);
  }

  .checkbox-label input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }

  .form-note {
    margin: 0;
    font-size: 0.85rem;
    color: var(--label-2);
    background: var(--fill);
    border: 1px solid var(--separator);
    border-radius: 10px;
    padding: 8px 10px;
  }
</style>
