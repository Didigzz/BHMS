<script lang="ts">
  import { badgeClass } from "$lib/room-status";
  import { phpPeso } from "$lib/format";
  import { effectiveOccupancy, pct } from "$lib/rooms";
  import type { Room } from "./types";

  let {
    room,
    overdue = false,
    onEdit,
    onDelete,
  }: {
    room: Room;
    overdue?: boolean;
    onEdit: (r: Room) => void;
    onDelete: (r: Room) => void;
  } = $props();
</script>

<li class="card room-item">
  <div class="room-main">
    <div class="room-top">
      <h3>{room.room_number}</h3>
      <span class="badge {badgeClass(room.status)}">{room.status}</span>
      {#if overdue}
        <span class="badge badge-overdue">Overdue</span>
      {/if}
    </div>

    {#if room.reservation_name && room.reservation_scope}
      <p class="reserved-line">
        {#if room.reservation_scope === "whole"}
          📅 Reserved — <strong>{room.reservation_name}</strong>
        {:else}
          📅 Held for <strong>{room.reservation_name}</strong> (1 slot)
        {/if}
      </p>
    {/if}

    <p class="room-meta">
      <span
        class:full={effectiveOccupancy(room.tenant_count, room.slot_holds) >= room.capacity}
        class:partial={room.tenant_count > 0 && effectiveOccupancy(room.tenant_count, room.slot_holds) < room.capacity}
      >
        {room.tenant_count}/{room.capacity} tenants{#if room.slot_holds > 0}
          <span class="held-note"> · +{room.slot_holds} held</span>
        {/if}
      </span>
      &nbsp;·&nbsp; {phpPeso(room.monthly_rate)}/month
    </p>
    <div class="progress-track" aria-label="occupancy">
      <div class="progress-fill" style:transform={`scaleX(${pct(effectiveOccupancy(room.tenant_count, room.slot_holds), room.capacity) / 100})`}></div>
    </div>
  </div>
  <div class="room-actions">
    {#if room.status !== "Maintenance" && room.reservation_count === 0 && effectiveOccupancy(room.tenant_count, room.slot_holds) < room.capacity}
      <a class="btn btn-small btn-reserve" href={`/reservations?room=${room.id}`}>Reserve</a>
    {/if}
    <button class="btn btn-small" onclick={() => onEdit(room)}>Edit</button>
    <button class="btn btn-small btn-danger" onclick={() => onDelete(room)}>Delete</button>
  </div>
</li>

<style>
  /* ---- list item ---- */
  .room-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .room-main {
    flex: 1;
    min-width: 0;
  }

  .room-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .room-top h3 {
    margin: 0;
    font-size: 1.05rem;
  }

  .room-meta {
    margin: 4px 0 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .room-meta .full {
    color: var(--red-deep);
    font-weight: 700;
  }
  .room-meta .partial {
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

  .room-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }

  .room-actions a.btn {
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

  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
  }

  @media (min-width: 600px) {
    .room-actions {
      flex-direction: row;
    }
  }
</style>
