<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { modalMaterial } from "$lib/ui/motion";
  import { phpPesoPrecise } from "$lib/ui/format";
  import { pushOverlay } from "$lib/ui/back-stack";
  import Icon from "$lib/ui/Icon.svelte";
  import BedDouble from "@lucide/svelte/icons/bed-double";
  import HandCoins from "@lucide/svelte/icons/hand-coins";
  import type { ConvertPayload, Reservation, RoomOption } from "../../lib/reservations/types";

  let {
    reservation,
    rooms,
    onConfirm,
    onClose,
  }: {
    reservation: Reservation;
    rooms: RoomOption[];
    onConfirm: (payload: ConvertPayload) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  // Mounted per-open via {#if} in the page — the reservation prop is only read
  // once at initialization, so untrack() makes that one-time capture explicit.
  let name = $state(untrack(() => reservation.name));
  let contact = $state(untrack(() => reservation.contact));
  let moveInDate = $state(untrack(() => reservation.target_move_in_date));
  // The first due date defaults to the target move-in day (same rule as the
  // tenant form) so the first payment covers the move-in month
  // (first-payment-month-spec.md). Editable — the landlord can set next month
  // for a late-month move-in.
  let dueDate = $state(untrack(() => reservation.target_move_in_date));
  let dueEdited = $state(false);
  let saving = $state(false);
  let error: string | null = $state(null);

  /** Human label for the hold being converted, e.g. "Whole room" / "1 bed" / "3 beds". */
  const holdLabel = $derived(
    reservation.hold_type === "whole"
      ? "Whole room"
      : reservation.hold_type === "bed"
        ? "1 bed"
        : `${reservation.bed_count ?? 0} beds`
  );

  /** The room this reservation holds (for capacity + rate fallback). */
  const room = $derived(rooms.find((r) => r.id === reservation.room_id));

  /** Beds the reservation itself holds — released when it converts. Only
   *  PARTIAL holds contribute to `held_beds`, so only they need removing from
   *  the free-bed count (a whole hold contributes 0 and frees the whole room). */
  const ownHoldBeds = $derived(reservation.hold_type === "whole" ? 0 : (reservation.bed_count ?? 1));

  /** Beds free in the room AFTER this reservation's hold is released. */
  const freeBeds = $derived(
    room ? Math.max(0, room.capacity - room.occupied_beds - room.held_beds + ownHoldBeds) : 1
  );

  // Beds the converted tenant occupies — prefilled from the hold (whole room
  // → the full capacity, custom → the held bed count), editable with a guard.
  let beds = $state(
    untrack(() =>
      reservation.hold_type === "whole"
        ? (rooms.find((r) => r.id === reservation.room_id)?.capacity ?? 1)
        : (reservation.bed_count ?? 1)
    )
  );

  function moveInChanged(value: string) {
    if (!dueEdited) {
      dueDate = value;
    }
  }

  function close() {
    if (saving) return;
    onClose();
  }

  // Android back button closes this modal instead of navigating away.
  onMount(() => {
    const unregister = pushOverlay(close);
    return unregister;
  });

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
    if (!Number.isInteger(beds) || beds < 1) {
      error = "Beds occupied must be a whole number of at least 1.";
      return;
    }
    if (beds > freeBeds) {
      error = `${reservation.room_number} only has ${freeBeds} bed${freeBeds === 1 ? "" : "s"} free.`;
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
        beds_occupied: beds,
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

    <p class="room-fixed"><span class="lead-icon"><Icon icon={BedDouble} size={16} /></span>Room: <strong>{reservation.room_number}</strong> · {holdLabel}</p>

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

    <label>
      Beds occupied
      <input type="number" min="1" step="1" bind:value={beds} />
    </label>
    <p class="beds-hint">
      Prefilled from the hold — {freeBeds} bed{freeBeds === 1 ? "" : "s"} free in this room.
    </p>

    {#if reservation.deposit != null}
      <p class="deposit-note">
        <span class="lead-icon"><Icon icon={HandCoins} size={16} /></span>Holding deposit {phpPesoPrecise(reservation.deposit)} carries over to the tenant.
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
    border-radius: var(--radius-control);
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

  .beds-hint {
    margin: -4px 0 0;
    font-size: 0.8rem;
    color: var(--label-3);
  }

  .lead-icon {
    display: inline-flex;
    margin-right: 6px;
    vertical-align: -0.15em;
  }
</style>
