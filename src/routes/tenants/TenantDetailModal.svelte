<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { formatDate, phpPesoPrecise, roomLabel } from "$lib/format";
  import { getPaymentStatus, dueDateRowLabel } from "$lib/payment-status";
  import { pushOverlay } from "$lib/back-stack";
  import type { Tenant } from "./types";

  let {
    tenant,
    onClose,
  }: {
    tenant: Tenant;
    onClose: () => void;
  } = $props();

  // Android back closes this modal instead of navigating away (app-wide pattern).
  onMount(() => {
    const unregister = pushOverlay(onClose);
    return unregister;
  });

  const totalHeld = $derived(tenant.advance_held + tenant.deposit_held);

  // Payment status drives the title color (text-only): green/current names
  // stay plain, due-soon turns amber, due/overdue turns red
  // (tenant-name-status-spec.md §3.4).
  const paymentStatus = $derived(getPaymentStatus(tenant.due_date, new Date(), tenant.last_paid_date));

  // Due-row label mirrors the room modal (due-date-status-fix-spec.md §3.6):
  // active tenants get the dynamic Due soon/Due/Due today/Overdue label;
  // archived tenants keep the static "Due" row (historical record, no live
  // status).
  const dueRowLabel = $derived(
    tenant.moved_out_date ? "Due" : dueDateRowLabel(tenant.due_date, new Date(), tenant.last_paid_date)
  );

  /** Backdrop tap closes, but only when the tap lands on the dim overlay itself. */
  function onOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label="Tenant details"
  tabindex="-1"
  transition:modalMaterial
  onclick={onOverlayClick}
  onkeydown={(e) => {
    if (e.key === "Escape") onClose();
  }}
>
  <div class="detail-panel">
    <div class="detail-header">
      <div class="detail-title">
        <h2 class:title-red={paymentStatus === "red"} class:title-yellow={paymentStatus === "yellow"}>{tenant.name}</h2>
        <p class="history-subtitle">{roomLabel(tenant.room_number)}</p>
      </div>
      <button type="button" class="detail-close" aria-label="Close" onclick={onClose}>✕</button>
    </div>

    <div class="detail-rows">
      {#if tenant.contact.trim() !== ""}
        <div class="detail-row">
          <span class="row-label">Phone</span>
          <span class="row-value">{tenant.contact}</span>
        </div>
      {/if}

      <div class="detail-row">
        <span class="row-label">Move-in</span>
        <span class="row-value">{formatDate(tenant.move_in_date)}</span>
      </div>

      <div class="detail-row">
        <span class="row-label">{dueRowLabel}</span>
        <span class="row-value">{formatDate(tenant.due_date)}</span>
      </div>

      <div class="detail-row">
        <span class="row-label">Monthly rate</span>
        <span class="row-value">{phpPesoPrecise(tenant.monthly_rate ?? 0)}</span>
      </div>

      <div class="detail-row">
        <span class="row-label">Beds</span>
        <span class="row-value">{tenant.beds_occupied}</span>
      </div>

      <div class="detail-row">
        <span class="row-label">Amenity Balance</span>
        <span class="row-value">{phpPesoPrecise(tenant.amenity_balance ?? 0)}</span>
      </div>

      <div class="detail-row">
        <span class="row-label">Held</span>
        <span class="row-value row-value-col">
          <span>{phpPesoPrecise(totalHeld)}</span>
          {#if tenant.advance_held > 0 && tenant.deposit_held > 0}
            <span class="row-sub">
              {phpPesoPrecise(tenant.advance_held)} advance · {phpPesoPrecise(tenant.deposit_held)} deposit
            </span>
          {:else if tenant.advance_held > 0}
            <span class="row-sub">{phpPesoPrecise(tenant.advance_held)} advance — used before any deposit</span>
          {:else if tenant.deposit_held > 0}
            <span class="row-sub">{phpPesoPrecise(tenant.deposit_held)} deposit</span>
          {/if}
        </span>
      </div>

      {#if tenant.moved_out_date}
        <div class="detail-row">
          <span class="row-label">Moved out</span>
          <span class="row-value">{formatDate(tenant.moved_out_date)}</span>
        </div>
        <div class="detail-row">
          <span class="row-label">Deposit</span>
          <span class="row-value">
            {#if tenant.deposit_refunded === 1}
              <span class="refunded">Deposit refunded</span>
            {:else if totalHeld > 0}
              <span class="pending">Held {phpPesoPrecise(totalHeld)} unrefunded</span>
            {:else}
              —
            {/if}
          </span>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .detail-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .detail-title {
    flex: 1;
    min-width: 0;
  }

  .detail-title h2 {
    margin: 0;
    font-size: 1.2rem;
    line-height: 1.25;
    word-break: break-word;
  }

  /* Payment-status title tint (text only — tenant-name-status-spec.md §3.4). */
  .detail-title h2.title-yellow {
    color: var(--amber-deep);
  }
  .detail-title h2.title-red {
    color: var(--red-deep);
  }

  .detail-close {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--fill);
    color: var(--label-2);
    font-family: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    transition:
      transform 0.12s cubic-bezier(0.23, 1, 0.32, 1),
      color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .detail-close:active {
    transform: scale(0.92);
  }

  .detail-close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Touch: the only way to dismiss the detail sheet without the hardware back
     button, at a 32px target. */
  @media (pointer: coarse) {
    .detail-close {
      width: 44px;
      height: 44px;
    }
  }

  /* ---- label / value rows, Settings-list style ---- */
  .detail-rows {
    display: flex;
    flex-direction: column;
  }

  .detail-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 2px;
  }

  .detail-row + .detail-row {
    border-top: 1px solid var(--separator);
  }

  .row-label {
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .row-value {
    color: var(--label);
    font-size: 0.9rem;
    font-weight: 600;
    text-align: right;
    word-break: break-word;
  }

  .row-value-col {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .row-sub {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--label-3);
  }

  .refunded {
    color: var(--green-deep);
  }

  .pending {
    color: var(--red-deep);
  }
</style>