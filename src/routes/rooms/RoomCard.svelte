<script lang="ts">
  import { badgeClass } from "$lib/rooms/room-status";
  import { phpPeso } from "$lib/ui/format";
  import { effectiveOccupancy } from "$lib/rooms/rooms";
  import type { Room, RoomTenantChip } from "$lib/rooms/types";
  import Icon from "$lib/ui/Icon.svelte";
  import CalendarCheck from "@lucide/svelte/icons/calendar-check";
  import RoomCardMenu from "./RoomCardMenu.svelte";
  import RoomOccupancy from "./RoomOccupancy.svelte";
  import RoomChips from "./RoomChips.svelte";

  let {
    room,
    overdue = false,
    tenants = [],
    onEdit,
    onDelete,
    onView,
    onReserve,
    onManageTenants,
  }: {
    room: Room;
    overdue?: boolean;
    tenants?: RoomTenantChip[];
    onEdit: (r: Room) => void;
    onDelete: (r: Room) => void;
    onView: (r: Room) => void;
    onReserve: (r: Room) => void;
    onManageTenants: (r: Room) => void;
  } = $props();

  // Reserve shows when there is actually space to reserve (unchanged rules).
  const canReserve = $derived(
    room.status !== "Maintenance" &&
      room.has_whole_hold === 0 &&
      effectiveOccupancy(room.occupied_beds, room.held_beds) < room.capacity
  );

  /** Open the boarder detail sheet when the card body is clicked or keyed. */
  function view() {
    onView(room);
  }

  function onKeydown(e: KeyboardEvent) {
    // Nested interactive controls (the ⋮ button) handle their own keys.
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      view();
    }
  }
</script>

<li class="card room-item">
  <div
    class="room-main"
    role="button"
    tabindex="0"
    aria-label={`View boarders in ${room.room_number}`}
    onclick={view}
    onkeydown={onKeydown}
  >
    <div class="room-top">
      <h3>{room.room_number}</h3>
      <span class="badge {badgeClass(room.status)}">{room.status}</span>
      {#if overdue}
        <span class="badge badge-overdue">Overdue</span>
      {/if}
      <RoomCardMenu {room} {onEdit} {onView} {onManageTenants} {onDelete} />
    </div>

    {#if room.has_whole_hold === 1 && room.whole_hold_name}
      <p class="reserved-line">
        <span class="reserved-icon"><Icon icon={CalendarCheck} size={16} /></span>Reserved — <strong>{room.whole_hold_name}</strong>
      </p>
    {/if}

    <RoomOccupancy {room} />
    <RoomChips {tenants} />

    <p class="room-rate">{phpPeso(room.monthly_rate)}<span>/month</span></p>

    {#if room.has_whole_hold === 0 && room.held_beds > 0}
      <p class="held-line">+{room.held_beds} bed{room.held_beds === 1 ? "" : "s"} held</p>
    {/if}

    <div class="room-footer">
      {#if canReserve}
        <!-- A real button, not a link: it opens the reservation form as a modal
             ON this page (reserve-room-lock-spec.md §3) — no navigation, and
             being a <button> it also satisfies the card's onkeydown guard, so
             it can never leak into opening the detail sheet. -->
        <button
          type="button"
          class="btn btn-small btn-reserve"
          onclick={(e) => {
            e.stopPropagation();
            onReserve(room);
          }}
        >
          Reserve
        </button>
      {/if}
      <span class="view-hint" class:push-right={canReserve}>View details ›</span>
    </div>
  </div>
</li>

<style>
  /* ---- list item ---- */
  .room-item {
    /* Everything now lives in the card body — no right-side action column. */
    display: block;
  }

  .room-main {
    border-radius: var(--radius-control);
    cursor: pointer;
    transition: background-color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  /* Touch gets the press state (hover sticks on a phone after a tap). */
  .room-main:active {
    background: var(--fill);
  }
  .room-main:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---- header row: title + badges left, ⋮ menu right ---- */
  .room-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .room-top h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- price + held line ---- */
  .room-rate {
    margin: 8px 0 0;
    color: var(--label);
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }

  .room-rate span {
    color: var(--label-3);
    font-weight: 500;
  }

  .held-line {
    margin: var(--space-2) 0 0;
    color: var(--amber-deep);
    font-weight: 600;
    font-size: 0.85rem;
  }

  /* ---- bottom action row: Reserve left, View details right ---- */
  .room-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }

  .room-footer .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .btn-reserve {
    background: var(--accent);
    border-color: transparent;
    color: var(--accent-contrast);
  }
  .view-hint {
    color: var(--label-3);
    font-size: 0.78rem;
    font-weight: 600;
    transition: color 0.15s ease;
  }
  .view-hint.push-right {
    margin-left: auto;
  }
  .room-main:active .view-hint {
    color: var(--accent);
  }

  /* Pointer-only states: on touch, :hover would remain after the finger lifts. */
  @media (hover: hover) {
    .room-main:hover {
      background: var(--fill);
    }
    .btn-reserve:hover {
      background: var(--accent-press);
      border-color: transparent;
      color: var(--accent-contrast);
    }
    .room-main:hover .view-hint {
      color: var(--accent);
    }
  }

  .reserved-icon {
    display: inline-flex;
    margin-right: 6px;
    vertical-align: -0.15em;
  }
</style>
