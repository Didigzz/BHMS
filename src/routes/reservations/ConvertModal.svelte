<script lang="ts">
  import { untrack } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { addMonths } from "$lib/payment-status";
  import { phpPesoPrecise } from "$lib/format";
  import type { ConvertPayload, Reservation } from "./types";

  let {
    reservation,
    onConfirm,
    onClose,
  }: {
    reservation: Reservation;
    onConfirm: (payload: ConvertPayload) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  // Mounted per-open via {#if} in the page — the reservation prop is only read
  // once at initialization, so untrack() makes that one-time capture explicit.
  let name = $state(untrack(() => reservation.name));
  let contact = $state(untrack(() => reservation.contact));
  let moveInDate = $state(untrack(() => reservation.target_move_in_date));
  let dueDate = $state(untrack(() => addMonths(reservation.target_move_in_date, 1)));
  let dueEdited = $state(false);
  let saving = $state(false);
  let error: string | null = $state(null);

  function moveInChanged(value: string) {
    if (!dueEdited) {
      dueDate = addMonths(value, 1);
    }
  }

  function close() {
    if (saving) return;
    onClose();
  }

  async function confirm() {
    if (!name.trim()) {
      error = "Tenant name is required.";
      return;
    }
    if (!contact.trim()) {
      error = "Contact number is required.";
      return;
    }
    if (!moveInDate) {
      error = "Move-in date is required.";
      return;
    }
    if (!dueDate) {
      error = "Due date is required.";
      return;
    }
    if (dueDate < moveInDate) {
      error = "Due date should not be before the move-in date.";
      return;
    }

    saving = true;
    error = null;
    try {
      const err = await onConfirm({
        name: name.trim(),
        contact: contact.trim(),
        move_in_date: moveInDate,
        due_date: dueDate,
      });
      if (err) {
        error = err;
      } else {
        onClose();
      }
    } finally {
      saving = false;
    }
  }
</script>

<div class="modal" role="dialog" aria-label="Convert reservation" transition:modalMaterial>
  <div class="res-form convert-panel">
    <h2>Convert to Tenant</h2>
    <p class="history-subtitle">{reservation.name} · {reservation.room_number}</p>

    <label>
      Tenant name
      <input type="text" bind:value={name} />
    </label>

    <label>
      Contact number
      <input type="tel" bind:value={contact} />
    </label>

    <p class="room-fixed">🛏️ Room: <strong>{reservation.room_number}</strong></p>

    <label>
      Move-in date
      <input
        type="date"
        bind:value={moveInDate}
        onchange={(e) => moveInChanged((e.currentTarget as HTMLInputElement).value)}
      />
    </label>

    <label>
      Due date (monthly payment)
      <input type="date" bind:value={dueDate} onchange={() => (dueEdited = true)} />
    </label>

    {#if reservation.deposit != null}
      <p class="deposit-note">
        💰 Holding deposit {phpPesoPrecise(reservation.deposit)} carries over to the tenant.
      </p>
    {/if}

    {#if error}
      <p class="form-error">{error}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={close} disabled={saving}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={confirm} disabled={saving}>
        {saving ? "Saving…" : "Confirm Tenant"}
      </button>
    </div>
  </div>
</div>

<style>
  /* ---- form fields (shared with the add form) ---- */
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

  .res-form input {
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .res-form input:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }
</style>
