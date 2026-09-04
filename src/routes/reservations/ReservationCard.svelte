<script lang="ts">
  import { formatDate, phpPesoPrecise, roomLabel } from "$lib/format";
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

  /** Uppercase hold badge, e.g. "1 BED" / "2 BEDS" / "WHOLE ROOM". */
  function holdBadge(r: Reservation): string {
    if (r.hold_type === "whole") return "WHOLE ROOM";
    if (r.hold_type === "bed") return "1 BED";
    const n = Math.max(1, r.bed_count ?? 1);
    return n === 1 ? "1 BED" : `${n} BEDS`;
  }

  const bannerText = $derived(
    daysLeft > 0
      ? daysLeft === 1
        ? "Move-in in 1 day"
        : `Move-in in ${daysLeft} days`
      : daysLeft === 0
        ? "Move-in today"
        : "Past target date"
  );
</script>

{#snippet phoneIcon()}
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
{/snippet}

{#snippet bedIcon()}
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/>
    <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/>
    <path d="M12 4v6"/>
    <path d="M2 18h20"/>
  </svg>
{/snippet}

{#snippet calendarIcon()}
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
{/snippet}

{#snippet moneyBagIcon()}
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 3h8l-1.75 4H9.75L8 3z"/>
    <path d="M6.5 7h11l1.5 4.75A7.5 7.5 0 1 1 5 11.75L6.5 7z"/>
    <circle cx="12" cy="14.5" r="1.8"/>
  </svg>
{/snippet}

{#snippet clockIcon()}
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
{/snippet}

<li class="card res-item">
  <div class="res-head">
    <h3>{reservation.name}</h3>
    {#if history}
      <span class="badge badge-{reservation.status}">
        {reservation.status === "converted" ? "Converted" : "Cancelled"}
      </span>
    {:else}
      <span class="badge hold-badge">{holdBadge(reservation)}</span>
    {/if}
  </div>

  {#if reservation.contact}
    <p class="res-row">
      <span class="icon icon-phone">{@render phoneIcon()}</span>
      <span class="row-text">{reservation.contact}</span>
    </p>
  {/if}
  <p class="res-row">
    <span class="icon icon-bed">{@render bedIcon()}</span>
    <span class="row-text">{roomLabel(reservation.room_number)}</span>
  </p>

  <div class="divider"></div>

  <div class="date-row">
    <span class="date-left">
      <span class="icon icon-cal">{@render calendarIcon()}</span>
      Reserved
    </span>
    <span class="date-dot" aria-hidden="true">•</span>
    <span class="date-value">{formatDate(reservation.reservation_date)}</span>
  </div>
  <div class="date-row">
    <span class="date-left">
      <span class="icon icon-cal">{@render calendarIcon()}</span>
      Move-in
    </span>
    <span class="date-dot" aria-hidden="true">•</span>
    <span class="date-value">{formatDate(reservation.target_move_in_date)}</span>
  </div>

  <div class="divider"></div>

  <div class="deposit-row">
    <span class="icon icon-bag">{@render moneyBagIcon()}</span>
    {#if reservation.deposit != null}
      <span class="deposit-amount">{phpPesoPrecise(reservation.deposit)}</span>
      <span class="deposit-label">Holding Deposit</span>
    {:else}
      <span class="deposit-none">No holding deposit</span>
    {/if}
  </div>

  {#if !history}
    <div class="divider"></div>

    <div class="status-banner">
      <span class="icon icon-clock">{@render clockIcon()}</span>
      <span>{bannerText}</span>
    </div>

    <div class="res-actions">
      {#if onConvert}
        <button class="btn btn-primary btn-wide" onclick={() => onConvert(reservation)}>Convert to Tenant</button>
      {/if}
      {#if onCancel}
        <button class="btn btn-wide" onclick={() => onCancel(reservation)}>Cancel Reservation</button>
      {/if}
    </div>
  {/if}
</li>

<style>
  /* ---- card layout: single column, sections separated by hairlines ---- */
  .res-item {
    display: block;
  }

  .res-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .res-head h3 {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1.15rem;
  }

  /* ---- icon rows ---- */
  .res-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0 0;
    font-size: 0.9rem;
    color: var(--label-2);
    min-width: 0;
  }

  .row-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon {
    display: inline-flex;
    flex-shrink: 0;
  }
  .icon-phone {
    color: var(--red);
  }
  .icon-bed {
    /* Image's purple — the app has no purple token, so this is the one
       fixed-color exception (spec §4.1). */
    color: #af52de;
  }
  .icon-cal {
    color: var(--label-3);
  }
  .icon-bag {
    color: var(--amber);
  }
  .icon-clock {
    color: var(--accent);
  }

  /* ---- section dividers ---- */
  .divider {
    height: 1px;
    background: var(--separator);
    margin: 10px 0;
  }

  /* ---- date rows: label left, bullet centered, date far right ---- */
  .date-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 0 0;
    font-size: 0.9rem;
  }

  .date-left {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--label-2);
    min-width: 0;
  }

  .date-dot {
    color: var(--label-3);
  }

  .date-value {
    color: var(--label);
    font-weight: 600;
    white-space: nowrap;
  }

  /* ---- deposit row ---- */
  .deposit-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
  }

  .deposit-amount {
    font-weight: 700;
    color: var(--label);
  }

  .deposit-label {
    color: var(--label-3);
  }

  .deposit-none {
    color: var(--label-3);
    font-style: italic;
  }

  /* ---- status banner: blue-tinted, one style for every state ---- */
  .status-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--accent-soft);
    color: var(--accent-deep);
    border-radius: 10px;
    padding: 8px 12px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  /* ---- hold badge: blue-tinted, uppercase via .badge ---- */
  .hold-badge {
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

  /* ---- action buttons: full-width, stacked ---- */
  .res-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }

  .btn-wide {
    width: 100%;
    padding: 10px 14px;
    font-size: 0.95rem;
  }
</style>