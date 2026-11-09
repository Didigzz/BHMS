<script lang="ts">
  import { formatDate, phpPesoPrecise, roomLabel } from "$lib/ui/format";
  import type { Reservation } from "../../lib/reservations/types";
  import Icon from "$lib/ui/Icon.svelte";
  import Phone from "@lucide/svelte/icons/phone";
  import BedDouble from "@lucide/svelte/icons/bed-double";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import HandCoins from "@lucide/svelte/icons/hand-coins";
  import Clock from "@lucide/svelte/icons/clock";

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
      <span class="icon icon-phone"><Icon icon={Phone} size={16} /></span>
      <span class="row-text">{reservation.contact}</span>
    </p>
  {/if}
  <p class="res-row">
    <span class="icon icon-bed"><Icon icon={BedDouble} size={16} /></span>
    <span class="row-text">{roomLabel(reservation.room_number)}</span>
  </p>

  <div class="divider"></div>

  <div class="date-row">
    <span class="date-left">
      <span class="icon icon-cal"><Icon icon={CalendarDays} size={16} /></span>
      Reserved
    </span>
    <span class="date-dot" aria-hidden="true">•</span>
    <span class="date-value">{formatDate(reservation.reservation_date)}</span>
  </div>
  <div class="date-row">
    <span class="date-left">
      <span class="icon icon-cal"><Icon icon={CalendarDays} size={16} /></span>
      Move-in
    </span>
    <span class="date-dot" aria-hidden="true">•</span>
    <span class="date-value">{formatDate(reservation.target_move_in_date)}</span>
  </div>

  <div class="divider"></div>

  <div class="deposit-row">
    <span class="icon icon-bag"><Icon icon={HandCoins} size={16} /></span>
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
      <span class="icon icon-clock"><Icon icon={Clock} size={16} /></span>
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
    letter-spacing: -0.02em;
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
  /* One glyph colour for reference details; the accent is spent only on the
     time-sensitive banner, so a card reads as one object instead of five
     unrelated icons. */
  .icon-phone,
  .icon-bed,
  .icon-cal,
  .icon-bag {
    color: var(--label-3);
  }
  .icon-clock {
    color: var(--accent-deep);
  }

  /* ---- section dividers ---- */
  .divider {
    height: 1px;
    background: var(--separator);
    margin: var(--space-3) 0;
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
    border-radius: var(--radius-control);
    padding: 9px 12px;
    font-size: 0.88rem;
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