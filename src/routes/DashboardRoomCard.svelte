<script lang="ts">
  import { badgeClass } from "$lib/room-status";
  import { paymentLabel } from "$lib/payment-status";
  import { phpPeso } from "$lib/format";
  import { effectiveOccupancy, pct } from "$lib/rooms";
  import type { DashboardRoom } from "./types";
  import Icon from "$lib/components/Icon.svelte";
  import CalendarCheck from "@lucide/svelte/icons/calendar-check";

  let {
    room,
    onView,
  }: {
    room: DashboardRoom;
    onView: (r: DashboardRoom) => void;
  } = $props();

  // Collapse the tenant chips at 3 (room-card-redesign-spec §4.4).
  const MAX_CHIPS = 3;
  const visibleChips = $derived(room.tenants.slice(0, MAX_CHIPS));
  const hiddenCount = $derived(room.tenants.length - visibleChips.length);

  function onKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onView(room);
    }
  }
</script>

<li class="card room-item">
  <div
    class="room-main"
    role="button"
    tabindex="0"
    aria-label={`View boarders in ${room.room_number}`}
    onclick={() => onView(room)}
    onkeydown={onKeydown}
  >
    <div class="room-top">
      <h3>{room.room_number}</h3>
      <span class="badge {badgeClass(room.status)}">{room.status}</span>
    </div>

    {#if room.whole_hold_name}
      <p class="reserved-line">
        <span class="reserved-icon"><Icon icon={CalendarCheck} size={16} /></span>Reserved — <strong>{room.whole_hold_name}</strong>
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
      <div
        class="progress-fill"
        style:transform={`scaleX(${pct(effectiveOccupancy(room.occupied_beds, room.held_beds), room.capacity) / 100})`}
      ></div>
    </div>

    <div class="tenants">
      {#if room.tenants.length === 0}
        <p class="no-tenants">No tenants yet</p>
      {:else}
        <ul class="tenant-name-list">
          {#each visibleChips as tenant (tenant.id)}
            <li
              class="tenant-chip chip-{tenant.status}"
              title={paymentLabel(tenant.status, tenant.dueDate, new Date(), tenant.lastPaidDate)}
            >
              {tenant.name}
            </li>
          {/each}
          {#if hiddenCount > 0}
            <li class="more-chip">+{hiddenCount} more</li>
          {/if}
        </ul>
      {/if}
    </div>

    <p class="room-rate">{phpPeso(room.monthly_rate)}/month</p>

    {#if room.held_beds > 0}
      <p class="held-line">+{room.held_beds} bed{room.held_beds === 1 ? "" : "s"} held</p>
    {/if}

    <span class="view-hint">View details ›</span>
  </div>
</li>

<style>
  /* Dashboard cards sit in the gap-based .room-list — no global card margin. */
  .card {
    margin-bottom: 0;
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

  /* ---- room header ---- */
  .room-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .room-top h3 {
    margin: 0;
    font-size: 1.1rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- occupancy (matches the rooms page card hierarchy) ---- */
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

  /* ---- tenants ---- */
  .tenants {
    margin-top: 12px;
  }

  .no-tenants {
    margin: 0;
    color: var(--label-3);
    font-size: 0.85rem;
    font-style: italic;
  }

  .tenant-name-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tenant-name-list li {
    background: var(--accent-soft);
    color: var(--accent-deep);
    border-radius: 999px;
    padding: 3px 12px;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .tenant-chip.chip-green {
    background: var(--green-soft);
    color: var(--green-deep);
  }
  .tenant-chip.chip-yellow {
    background: var(--amber-soft);
    color: var(--amber-deep);
  }
  .tenant-chip.chip-red {
    background: var(--red-soft);
    color: var(--red-deep);
  }

  /* static "N more" count pill (not interactive — room-card-redesign-spec §4.4) */
  .more-chip {
    background: var(--gray-soft);
    color: var(--gray-deep);
    border-radius: 999px;
    padding: 3px 12px;
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
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

  /* ---- view-details hint ---- */
  .view-hint {
    display: inline-block;
    margin-top: 12px;
    color: var(--label-3);
    font-size: 0.78rem;
    font-weight: 600;
    transition: color 0.15s ease;
  }
  .room-main:hover .view-hint {
    color: var(--accent);
  }

  .reserved-icon {
    display: inline-flex;
    margin-right: 6px;
    vertical-align: -0.15em;
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
  }
</style>