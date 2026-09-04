<script lang="ts">
  import { badgeClass } from "$lib/room-status";
  import { paymentLabel } from "$lib/payment-status";
  import { phpPeso } from "$lib/format";
  import { effectiveOccupancy, pct } from "$lib/rooms";
  import type { Room, RoomTenantChip } from "./types";

  let {
    room,
    overdue = false,
    tenants = [],
    onEdit,
    onDelete,
    onView,
    onManageTenants,
  }: {
    room: Room;
    overdue?: boolean;
    tenants?: RoomTenantChip[];
    onEdit: (r: Room) => void;
    onDelete: (r: Room) => void;
    onView: (r: Room) => void;
    onManageTenants: (r: Room) => void;
  } = $props();

  // Collapse the tenant chips at 3 (room-card-redesign-spec §4.4).
  const MAX_CHIPS = 3;
  const visibleChips = $derived(tenants.slice(0, MAX_CHIPS));
  const hiddenCount = $derived(tenants.length - visibleChips.length);

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

  // ----- ⋮ menu state -----
  let menuOpen = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);

  function toggleMenu(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function onDocClick(e: MouseEvent) {
    if (!menuOpen) return;
    const t = e.target as Node;
    if (triggerEl && !triggerEl.contains(t) && menuEl && !menuEl.contains(t)) {
      menuOpen = false;
    }
  }

  function onDocKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") menuOpen = false;
  }

  $effect(() => {
    if (menuOpen) {
      // Focus the first item so keyboard users land inside the menu.
      menuEl?.querySelector<HTMLButtonElement>("button")?.focus();
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onDocKeydown);
      return () => {
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onDocKeydown);
      };
    }
  });
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
      <div class="menu-wrap">
        <button
          type="button"
          class="menu-trigger"
          aria-label={`Actions for ${room.room_number}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          bind:this={triggerEl}
          onclick={toggleMenu}
        >
          ⋮
        </button>
        {#if menuOpen}
          <div
            class="room-menu"
            role="menu"
            aria-label={`Actions for ${room.room_number}`}
            bind:this={menuEl}
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
          >
            <button type="button" role="menuitem" onclick={() => { closeMenu(); onEdit(room); }}>Edit</button>
            <button type="button" role="menuitem" onclick={() => { closeMenu(); onView(room); }}>Manage beds</button>
            <button type="button" role="menuitem" onclick={() => { closeMenu(); onManageTenants(room); }}>Manage tenants</button>
            <button type="button" role="menuitem" class="menu-danger" onclick={() => { closeMenu(); onDelete(room); }}>Delete</button>
          </div>
        {/if}
      </div>
    </div>

    {#if room.has_whole_hold === 1 && room.whole_hold_name}
      <p class="reserved-line">
        📅 Reserved — <strong>{room.whole_hold_name}</strong>
      </p>
    {/if}

    <p
      class="room-meta"
      class:full={effectiveOccupancy(room.occupied_beds, room.held_beds) >= room.capacity}
      class:partial={room.occupied_beds > 0 && effectiveOccupancy(room.occupied_beds, room.held_beds) < room.capacity}
    >
      {room.occupied_beds}/{room.capacity} bed{room.occupied_beds === 1 ? "" : "s"} occupied
    </p>
    <div class="progress-track" aria-label="occupancy">
      <div class="progress-fill" style:transform={`scaleX(${pct(effectiveOccupancy(room.occupied_beds, room.held_beds), room.capacity) / 100})`}></div>
    </div>

    {#if tenants.length > 0}
      <ul class="room-chips" aria-label="Boarders">
        {#each visibleChips as t (t.id)}
          <li
            class="tenant-chip chip-{t.status}"
            title={paymentLabel(t.status, t.dueDate, new Date(), t.lastPaidDate)}
          >
            {t.name}
          </li>
        {/each}
        {#if hiddenCount > 0}
          <li class="more-chip">+{hiddenCount} more</li>
        {/if}
      </ul>
    {:else}
      <p class="no-tenants">No tenants yet</p>
    {/if}

    <p class="room-rate">{phpPeso(room.monthly_rate)}/month</p>

    {#if room.has_whole_hold === 0 && room.held_beds > 0}
      <p class="held-line">+{room.held_beds} bed{room.held_beds === 1 ? "" : "s"} held</p>
    {/if}

    <div class="room-footer">
      {#if canReserve}
        <a
          class="btn btn-small btn-reserve"
          href={`/reservations?room=${room.id}`}
          onclick={(e) => e.stopPropagation()}
        >
          Reserve
        </a>
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
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .room-main:hover {
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
    font-size: 1.05rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-wrap {
    position: relative;
    margin-left: auto;
    flex-shrink: 0;
    z-index: 30;
  }

  .menu-trigger {
    border: none;
    background: none;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    line-height: 1;
    color: var(--label-2);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .menu-trigger:hover {
    background: var(--fill);
    color: var(--label);
  }
  .menu-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---- anchored dropdown ---- */
  .room-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 180px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--card);
    border: 1px solid var(--separator);
    border-radius: 12px;
    box-shadow: var(--shadow-modal);
    z-index: 50;
  }
  .room-menu button {
    display: flex;
    align-items: center;
    width: 100%;
    border: none;
    background: none;
    padding: 9px 12px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--label);
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .room-menu button:hover {
    background: var(--fill);
  }
  .room-menu button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .room-menu .menu-danger {
    color: var(--red-deep);
  }

  /* ---- occupancy ---- */
  .room-meta {
    margin: 10px 0 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .room-meta.full {
    color: var(--red-deep);
    font-weight: 700;
  }
  .room-meta.partial {
    color: var(--amber-deep);
    font-weight: 600;
  }

  .progress-track {
    height: 8px;
    border-radius: 999px;
    background: var(--fill);
    overflow: hidden;
    margin-top: 8px;
  }

  .progress-fill {
    height: 100%;
    width: 100%;
    border-radius: 999px;
    background: var(--accent);
    transform-origin: left;
    transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
  }

  /* ---- boarder chips (payment-status tinted, like the dashboard) ---- */
  .room-chips {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tenant-chip {
    background: var(--accent-soft);
    color: var(--accent-deep);
    border-radius: 999px;
    padding: 3px 12px;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .chip-green {
    background: var(--green-soft);
    color: var(--green-deep);
  }
  .chip-yellow {
    background: var(--amber-soft);
    color: var(--amber-deep);
  }
  .chip-red {
    background: var(--red-soft);
    color: var(--red-deep);
  }

  /* static "N more" count pill (not interactive — room-card-redesign-spec §4.4) */
  .more-chip {
    background: var(--gray-soft);
    color: var(--gray-deep);
    border-radius: 999px;
    padding: 3px 12px;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .no-tenants {
    margin: 10px 0 0;
    color: var(--label-3);
    font-size: 0.85rem;
    font-style: italic;
  }

  /* ---- price + held line ---- */
  .room-rate {
    margin: 8px 0 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .held-line {
    margin: 6px 0 0;
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

  .room-footer a.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }

  .btn-reserve {
    background: var(--accent);
    border-color: transparent;
    color: #ffffff;
  }
  .btn-reserve:hover {
    background: var(--accent-press);
    border-color: transparent;
    color: #ffffff;
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
  .room-main:hover .view-hint {
    color: var(--accent);
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
  }
</style>