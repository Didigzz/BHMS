<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { modalMaterial } from "$lib/ui/motion";
  import { pushOverlay } from "$lib/ui/back-stack";
  import type { Room, RoomFormState } from "../../lib/rooms/types";

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
    // Shrinking capacity below the currently occupied beds strands tenants in
    // an over-capacity room (the DB only guards tenant inserts) — block it.
    // A tenant occupying N beds needs N slots, so the guard compares against
    // the summed beds, not the head count.
    if (form.id !== null) {
      const existing = rooms.find((r) => r.id === form.id);
      if (existing && capacity < existing.occupied_beds) {
        return `Capacity can't be less than the ${existing.occupied_beds} bed${existing.occupied_beds === 1 ? "" : "s"} currently occupied in this room.`;
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

  // Android back button closes this modal (same path as Cancel) instead of
  // letting the WebView navigate its history.
  onMount(() => {
    const unregister = pushOverlay(onClose);
    return unregister;
  });
</script>

<div class="modal" role="dialog" aria-label="Room form" transition:modalMaterial>
  <form class="room-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <h2>{form.id === null ? "Add Room" : "Edit Room"}</h2>

    <label class="span-2">
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

    <p class="form-note span-2">
      Status is automatic: <strong>Occupied</strong> when tenants are assigned,
      <strong>Reserved</strong> when the room is held, <strong>Vacant</strong> when free.
      The rate is the default for new tenants — existing tenants keep their own rate.
    </p>

    <label class="checkbox-label span-2">
      <input type="checkbox" bind:checked={form.maintenance} />
      Mark as unavailable (maintenance)
    </label>

    {#if formError}
      <p class="form-error span-2">{formError}</p>
    {/if}

    <div class="form-actions span-2">
      <button type="button" class="btn" onclick={onClose} disabled={saving}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={saving}>Save</button>
    </div>
  </form>
</div>

<style>
  /* ---- form ---- */
  /* Two-up field grid that collapses to one column on narrow windows. Fields
     are grouped in logical pairs; anything needing full width (Room name, the
     note, the checkbox, errors, actions) spans both columns. */
  .room-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
  }

  .room-form h2 {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 1.2rem;
  }

  .room-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .room-form label.span-2 {
    grid-column: 1 / -1;
  }

  .room-form input:not([type="checkbox"]) {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border-radius: var(--radius-control);
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
    line-height: 1.45;
    color: var(--label-2);
    background: var(--fill);
    border: 1px solid var(--separator);
    border-radius: var(--radius-control);
    padding: 8px 10px;
  }
</style>
