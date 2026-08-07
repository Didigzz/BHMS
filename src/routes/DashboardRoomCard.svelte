<script lang="ts">
  import { badgeClass } from "$lib/room-status";
  import { paymentLabel } from "$lib/payment-status";
  import { phpPeso } from "$lib/format";
  import { effectiveOccupancy, heldCount, pct } from "$lib/rooms";
  import type { DashboardRoom } from "./types";

  let { room }: { room: DashboardRoom } = $props();
</script>

<li class="card room-item">
  <div class="room-top">
    <h3>{room.room_number}</h3>
    <span class="badge {badgeClass(room.status)}">{room.status}</span>
  </div>

  {#if room.reservation}
    <p class="reserved-line">
      {#if room.reservation.scope === "whole"}
        📅 Reserved — <strong>{room.reservation.name}</strong>
      {:else}
        📅 Held for <strong>{room.reservation.name}</strong> (1 slot)
      {/if}
    </p>
  {/if}

  <div class="occupancy-row">
    <span
      class="occupancy-count"
      class:full={effectiveOccupancy(room.tenant_count, heldCount(room.reservation?.scope)) >= room.capacity}
    >
      {room.tenant_count}/{room.capacity} tenants{#if heldCount(room.reservation?.scope) > 0}
        <span class="held-note"> · +{heldCount(room.reservation?.scope)} held</span>
      {/if}
    </span>
    <div class="progress-track" aria-label="occupancy">
      <div
        class="progress-fill"
        style:transform={`scaleX(${pct(effectiveOccupancy(room.tenant_count, heldCount(room.reservation?.scope)), room.capacity) / 100})`}
      ></div>
    </div>
    <span class="rate">{phpPeso(room.monthly_rate)}/mo</span>
  </div>

  <div class="tenants">
    {#if room.tenants.length === 0}
      <p class="no-tenants">No tenants yet</p>
    {:else}
      <ul class="tenant-name-list">
        {#each room.tenants as tenant (tenant.name)}
          <li
            class="tenant-chip chip-{tenant.status}"
            title={paymentLabel(tenant.status, tenant.dueDate, new Date(), tenant.lastPaidDate)}
          >
            {tenant.name}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</li>

<style>
  /* Dashboard cards sit in the gap-based .room-list — no global card margin. */
  .card {
    margin-bottom: 0;
  }

  /* ---- room header ---- */
  .room-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .room-top h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  /* ---- occupancy ---- */
  .occupancy-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px 0;
  }

  .occupancy-count {
    font-weight: 700;
    font-size: 0.92rem;
    min-width: 90px;
  }
  .occupancy-count.full {
    color: var(--red-deep);
  }

  .progress-track {
    flex: 1;
    height: 8px;
    border-radius: 999px;
    background: var(--fill);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    width: 100%;
    border-radius: 999px;
    background: var(--accent);
    transform-origin: left;
    transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
  }

  .rate {
    color: var(--label-2);
    font-size: 0.85rem;
    white-space: nowrap;
  }

  /* ---- tenants ---- */
  .tenants {
    border-top: 1px solid var(--separator);
    padding-top: 10px;
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

  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
  }
</style>
