<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { modalMaterial } from "$lib/ui/motion";
  import { phpPeso } from "$lib/ui/format";
  import { pushOverlay } from "$lib/ui/back-stack";
  import {
    capacityHint,
    holdOptionDisabled,
    remainingBeds,
    roomFitsHold,
    saveDisabledForCapacity,
  } from "$lib/reservations/reservations";
  import type { HoldType, ReservationFormState, RoomOption } from "../../lib/reservations/types";

  let {
    rooms,
    initialRoomId = "",
    lockedRoomId = "",
    onSave,
    onClose,
  }: {
    rooms: RoomOption[];
    initialRoomId?: string;
    /** Set when the form was opened from a room card's Reserve button — the
     *  room is shown as a static line and cannot be changed
     *  (reserve-room-lock-spec.md §4). Empty = general flow, free room pick. */
    lockedRoomId?: string;
    onSave: (form: ReservationFormState) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  // Mounted per-open via {#if} in the page — props are only read once at
  // initialization, so untrack() makes that one-time capture explicit.
  let form = $state<ReservationFormState>(
    untrack(() => {
      // Room-card entry locks the room AND defaults the hold type to "One bed"
      // when the locked room is partially occupied ("Whole room" is invalid
      // there — spec §5.5).
      const locked = lockedRoomId
        ? rooms.find((r) => String(r.id) === String(lockedRoomId))
        : undefined;
      const wholeInvalid = locked ? holdOptionDisabled(locked, "whole") : false;
      return {
        name: "",
        contact: "",
        room_id: lockedRoomId || initialRoomId,
        reservation_date: "",
        target_move_in_date: "",
        hold_type: locked && wholeInvalid ? "bed" : "whole",
        bed_count: "1",
        deposit: "",
      };
    })
  );
  let formError: string | null = $state(null);

  /** The room all capacity gating judges against: the LOCKED room when this
   *  modal was opened from a room card, else the room picked in the select
   *  (undefined in the general flow until one is chosen). */
  const gatedRoom = $derived(
    lockedRoomId
      ? rooms.find((r) => String(r.id) === String(lockedRoomId))
      : rooms.find((r) => String(r.id) === String(form.room_id))
  );

  /** Beds the current form would hold; null for a whole-room hold. While a
   *  custom count is still untyped, fall back to 1 so the room list doesn't
   *  empty out (validate() enforces the real count at save time). */
  function requestedBedCount(): number | null {
    if (form.hold_type === "whole") return null;
    if (form.hold_type === "bed") return 1;
    const n = Number(form.bed_count);
    return Number.isInteger(n) && n >= 1 ? n : 1;
  }
  const requestedBeds = $derived(requestedBedCount());

  const availableRooms = $derived(
    rooms.filter((r) => roomFitsHold(r, form.hold_type, requestedBeds))
  );

  function roomLabel(room: RoomOption): string {
    if (form.hold_type === "whole") {
      return `${room.room_number} (${room.occupied_beds}/${room.capacity}) · ${phpPeso(room.monthly_rate)}/mo`;
    }
    const free = remainingBeds(room);
    return `${room.room_number} (${room.occupied_beds}/${room.capacity}) · ${phpPeso(room.monthly_rate)}/mo — ${free} bed${free === 1 ? "" : "s"} free`;
  }

  function holdTypeLabel(holdType: HoldType): string {
    return holdType === "whole" ? "whole-room" : holdType === "bed" ? "one-bed" : "custom-bed";
  }

  function selectedRoom(): RoomOption | undefined {
    return rooms.find((r) => String(r.id) === String(form.room_id));
  }

  // If the gated room is partially occupied while "Whole room" is selected
  // (a race, or a room change in the general flow), move the selection to the
  // always-valid "One bed" instead of leaving an unsavable state (§5.5).
  $effect(() => {
    if (form.hold_type === "whole" && gatedRoom && holdOptionDisabled(gatedRoom, "whole")) {
      form.hold_type = "bed";
    }
  });

  /** Parsed custom bed count (NaN while untyped) — only consulted for "custom". */
  const parsedBedCount = $derived(Number(form.bed_count));

  /** Save is disabled ONLY for capacity-invalid selections (§5.3); a locked
   *  room that vanished also blocks (nothing to save against). */
  const saveBlocked = $derived(
    (lockedRoomId !== "" && !gatedRoom) ||
      saveDisabledForCapacity(gatedRoom, form.hold_type, parsedBedCount)
  );

  /** Short hint under the Hold Type control explaining a disabled selection. */
  const hintText = $derived(
    lockedRoomId !== "" && !gatedRoom
      ? "Selected room no longer exists."
      : capacityHint(gatedRoom, form.hold_type, parsedBedCount)
  );

  function validate(): string | null {
    if (!form.name.trim()) return "Name is required.";
    if (!form.contact.trim()) return "Contact number is required.";
    if (!form.room_id) return "Please select a room.";
    const room = selectedRoom();
    if (!room) return "Selected room no longer exists.";
    if (form.hold_type === "whole") {
      if (room.occupied_beds > 0) {
        return `${room.room_number} already has tenants — choose a bed hold instead.`;
      }
      if (room.held_beds > 0 || room.has_whole_hold === 1) {
        return `${room.room_number} already has an active hold — it is not fully vacant.`;
      }
    } else if (room.has_whole_hold === 1) {
      return `${room.room_number} is fully reserved for the whole room.`;
    } else if (form.hold_type === "bed") {
      if (remainingBeds(room) < 1) {
        return `${room.room_number} has no beds left to hold.`;
      }
    } else {
      const beds = Number(form.bed_count);
      if (!Number.isInteger(beds) || beds < 1) {
        return "Beds to hold must be a whole number of at least 1.";
      }
      if (beds > remainingBeds(room)) {
        return `${room.room_number} only has ${remainingBeds(room)} bed${remainingBeds(room) === 1 ? "" : "s"} left — you can hold at most that many.`;
      }
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

  // Android back button closes this modal (same path as Cancel) instead of
  // letting the WebView navigate its history.
  onMount(() => {
    const unregister = pushOverlay(onClose);
    return unregister;
  });
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
      Hold Type
      <select bind:value={form.hold_type}>
        <option value="whole" disabled={holdOptionDisabled(gatedRoom, "whole")}>Whole room</option>
        <option value="bed" disabled={holdOptionDisabled(gatedRoom, "bed")}>One bed</option>
        <option value="custom" disabled={holdOptionDisabled(gatedRoom, "custom")}>Custom (choose beds)</option>
      </select>
    </label>

    {#if form.hold_type === "custom"}
      <label>
        Beds to hold
        <input
          type="number"
          min="1"
          max={gatedRoom ? Math.max(0, remainingBeds(gatedRoom)) : undefined}
          step="1"
          placeholder="e.g. 2"
          bind:value={form.bed_count}
        />
      </label>
    {/if}

    {#if hintText}
      <p class="form-error capacity-hint">{hintText}</p>
    {/if}

    <label>
      Holding deposit (₱, optional)
      <input type="number" min="0" step="0.01" placeholder="e.g. 500" bind:value={form.deposit} />
    </label>

    {#if lockedRoomId}
      {@const locked = gatedRoom}
      <div class="span-2 room-field">
        <span class="room-field-label">Room</span>
        {#if locked}
          <span class="locked-room">
            {locked.room_number} — {locked.occupied_beds}/{locked.capacity} occupied · {Math.max(0, remainingBeds(locked))} bed{remainingBeds(locked) === 1 ? "" : "s"} free
          </span>
        {:else}
          <span class="locked-room">Room unavailable</span>
        {/if}
      </div>
    {:else}
      <label class="span-2">
        Room
        <select bind:value={form.room_id}>
          <option value="" disabled>Select room…</option>
          {#each availableRooms as room (room.id)}
            <option value={String(room.id)}>{roomLabel(room)}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if gatedRoom && !roomFitsHold(gatedRoom, form.hold_type, requestedBeds)}
      <p class="form-error">That room is no longer available for a {holdTypeLabel(form.hold_type)} hold.</p>
    {/if}

    <label>
      Reservation date
      <input type="date" bind:value={form.reservation_date} />
    </label>

    <label>
      Target move-in date
      <input type="date" bind:value={form.target_move_in_date} />
    </label>

    {#if formError}
      <p class="form-error">{formError}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={saveBlocked}>Save Reservation</button>
    </div>
  </form>
</div>

<style>
  /* ---- form ---- */
  /* Two-up field grid that collapses to one column on narrow windows, so the
     whole form fits without scrolling. Fields are grouped in logical pairs;
     anything needing full width (Room, errors, actions) spans both columns. */
  .res-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
  }

  .res-form h2 {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 1.2rem;
  }

  .res-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .res-form label.span-2,
  .res-form .form-error,
  .res-form .form-actions {
    grid-column: 1 / -1;
  }

  .res-form input,
  .res-form select {
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

  .res-form input:focus,
  .res-form select:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }

  /* ---- locked-room read-only line (reserve-room-lock-spec.md §4) ---- */
  .room-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .room-field-label {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .locked-room {
    box-sizing: border-box;
    border-radius: var(--radius-control);
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--label);
    background: var(--fill);
  }

  /* ---- capacity hint (amber, below the hold-type control) ---- */
  .capacity-hint {
    margin: 0;
    color: var(--amber-deep);
  }
</style>