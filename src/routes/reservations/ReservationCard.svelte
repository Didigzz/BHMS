<script lang="ts">
  import { formatDate, phpPesoPrecise } from "$lib/format";
  import type { Reservation } from "./types";

  let {
    reservation,
    history = false,
    onConvert,
    onCancel,
  }: {
    reservation: Reservation;
    history?: boolean;
    onConvert?: (r: Reservation) => void;
    onCancel?: (r: Reservation) => void;
  } = $props();

  function daysUntil(iso: string): number {
    const [y, m, d] = iso.split("-").map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
  }

  const daysLeft = $derived(daysUntil(reservation.target_move_in_date));
</script>

{#if history}
  <li class="card res-item">
    <div class="res-main">
      <div class="res-top">
        <h3>{reservation.name}</h3>
        <span class="badge badge-{reservation.status}">
          {reservation.status === "converted" ? "Converted" : "Cancelled"}
        </span>
      </div>
      <p class="res-meta">🛏️ {reservation.room_number}</p>
      <p class="res-meta">
        Reserved {formatDate(reservation.reservation_date)} · Move-in {formatDate(reservation.target_move_in_date)}
      </p>
    </div>
  </li>
{:else}
  <li class="card res-item">
    <div class="res-main">
      <div class="res-top">
        <h3>{reservation.name}</h3>
        <span class="badge badge-{reservation.scope}">
          {reservation.scope === "whole" ? "Whole room" : "One slot"}
        </span>
      </div>
      <p class="res-meta">📞 {reservation.contact}</p>
      <p class="res-meta">🛏️ {reservation.room_number}</p>
      <p class="res-meta">
        Reserved {formatDate(reservation.reservation_date)} · Move-in {formatDate(reservation.target_move_in_date)}
      </p>
      {#if reservation.deposit != null}
        <p class="res-meta">💰 {phpPesoPrecise(reservation.deposit)} holding deposit</p>
      {/if}
      <p class="res-meta countdown">
        {#if daysLeft > 0}
          Move-in in {daysLeft}d
        {:else if daysLeft === 0}
          Move-in today
        {:else}
          <span class="past-hint">Past target date</span>
        {/if}
      </p>
    </div>
    <div class="res-actions">
      {#if onConvert}
        <button class="btn btn-small btn-primary" onclick={() => onConvert(reservation)}>Convert to Tenant</button>
      {/if}
      {#if onCancel}
        <button class="btn btn-small btn-danger" onclick={() => onCancel(reservation)}>Cancel</button>
      {/if}
    </div>
  </li>
{/if}

<style>
  /* ---- list item ---- */
  .res-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .res-main {
    flex: 1;
    min-width: 0;
  }

  .res-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .res-top h3 {
    margin: 0;
    font-size: 1.05rem;
  }

  .res-meta {
    margin: 2px 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .countdown {
    margin-top: 4px;
    font-weight: 600;
    color: var(--accent);
  }

  .past-hint {
    color: var(--label-3);
    font-weight: 500;
    font-style: italic;
  }

  .res-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }

  /* ---- reservation-scope badges ---- */
  .badge-whole {
    color: var(--amber-deep);
    background: var(--amber-soft);
  }
  .badge-slot {
    color: var(--accent-deep);
    background: var(--accent-soft);
  }
  .badge-converted {
    color: var(--green-deep);
    background: var(--green-soft);
  }
  .badge-cancelled {
    color: var(--gray-deep);
    background: var(--gray-soft);
  }

  @media (min-width: 600px) {
    .res-actions {
      flex-direction: row;
    }
  }
</style>
