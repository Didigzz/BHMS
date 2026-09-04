<script lang="ts">
  import { getPaymentStatus, paymentLabel } from "$lib/payment-status";
  import { roomLabel } from "$lib/format";
  import type { Tenant } from "./types";

  let {
    tenant,
    archived = false,
    expanded = false,
    onPay,
    onHistory,
    onEdit,
    onMoveOut,
    onDepositRefunded,
    onDelete,
    onToggleMore,
    onOpenDetails,
  }: {
    tenant: Tenant;
    archived?: boolean;
    /** Accordion state owned by the tenants page — only one card is open. */
    expanded?: boolean;
    onPay?: (t: Tenant) => void;
    onHistory: (t: Tenant) => void;
    onEdit?: (t: Tenant) => void;
    onMoveOut?: (t: Tenant) => void;
    onDepositRefunded?: (t: Tenant) => void;
    onDelete?: (t: Tenant) => void;
    /** Report a tap on "More options"; the page flips the open card id. */
    onToggleMore?: (t: Tenant) => void;
    /** Open the tenant details modal (tap on the header zone). */
    onOpenDetails?: (t: Tenant) => void;
  } = $props();

  const status = $derived(getPaymentStatus(tenant.due_date, new Date(), tenant.last_paid_date));
  const statusLabel = $derived(paymentLabel(status, tenant.due_date, new Date(), tenant.last_paid_date));

  function toggleMore() {
    onToggleMore?.(tenant);
  }

  const panelId = $derived(`tenant-more-${tenant.id}`);
</script>

<li class="card tenant-item">
  <!-- The whole header zone (name + room + badge) opens the details modal. -->
  <button type="button" class="tenant-head" onclick={() => onOpenDetails?.(tenant)}>
    <span class="tenant-id">
      <span class="tenant-name">
        <span class="tenant-name-text">{tenant.name}</span>
        <span class="name-chevron" aria-hidden="true">›</span>
      </span>
      <span class="tenant-room">{roomLabel(tenant.room_number)}</span>
    </span>
    {#if !archived}
      <span class="pay-badge pay-{status}" title={statusLabel}>
        {statusLabel}
      </span>
    {/if}
  </button>

  <div class="tenant-band" class:expanded>
    {#if !archived && onPay}
      <button class="btn btn-paid btn-full" onclick={() => onPay(tenant)}>Record Payment</button>
    {/if}

    <button
      type="button"
      class="more-toggle"
      aria-expanded={expanded}
      aria-controls={panelId}
      onclick={toggleMore}
    >
      <span>{expanded ? "Less options" : "More options"}</span>
      <span class="chevron" aria-hidden="true">▾</span>
    </button>

    <!-- Always in the DOM so the height transition can run both ways; the
         grid-template-rows 0fr→1fr trick collapses it visually. inert keeps
         the hidden mini-buttons out of the tab order / a11y tree. -->
    <div class="more-collapse" id={panelId} inert={!expanded} aria-hidden={!expanded}>
      <div class="more-inner">
        <div class="icon-grid">
          <button type="button" class="mini" onclick={() => onHistory(tenant)}>
            <span class="mini-icon" aria-hidden="true">🕐</span>
            <span class="mini-label">History</span>
          </button>
          {#if !archived && onEdit}
            <button type="button" class="mini" onclick={() => onEdit(tenant)}>
              <span class="mini-icon" aria-hidden="true">✏️</span>
              <span class="mini-label">Edit</span>
            </button>
          {/if}
          {#if !archived && onMoveOut}
            <button type="button" class="mini danger" onclick={() => onMoveOut(tenant)}>
              <span class="mini-icon" aria-hidden="true">🚪</span>
              <span class="mini-label">Move Out</span>
            </button>
          {/if}
          {#if archived && tenant.deposit_held > 0 && tenant.deposit_refunded === 0 && onDepositRefunded}
            <button type="button" class="mini refund" onclick={() => onDepositRefunded(tenant)}>
              <span class="mini-icon" aria-hidden="true">💵</span>
              <span class="mini-label">Deposit Refunded</span>
            </button>
          {/if}
          {#if archived && onDelete}
            <button type="button" class="mini danger" onclick={() => onDelete(tenant)}>
              <span class="mini-icon" aria-hidden="true">🗑️</span>
              <span class="mini-label">Delete</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</li>

<style>
  /* ---- tappable header zone ---- */
  .tenant-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: transform 0.12s cubic-bezier(0.23, 1, 0.32, 1);
    -webkit-tap-highlight-color: transparent;
  }

  .tenant-head:active {
    transform: scale(0.99);
  }

  .tenant-head:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .tenant-id {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .tenant-name {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.3;
    color: var(--label);
  }

  /* Long names truncate to one line; the chevron always stays visible. */
  .tenant-name-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .name-chevron {
    flex-shrink: 0;
    font-size: 1rem;
    line-height: 1;
    color: var(--label-3);
  }

  .tenant-room {
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .pay-badge {
    padding: 3px 12px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }
  .pay-green {
    color: var(--green-deep);
    background: var(--green-soft);
  }
  .pay-yellow {
    color: var(--amber-deep);
    background: var(--amber-soft);
  }
  .pay-red {
    color: var(--red-deep);
    background: var(--red-soft);
  }

  /* ---- bottom action band (full card width, separated by a divider) ---- */
  .tenant-band {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--separator);
  }

  .btn-full {
    width: 100%;
  }

  .more-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 44px;
    margin-top: 6px;
    padding: 4px 8px;
    border: none;
    border-radius: 8px;
    background: transparent;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--label-2);
    cursor: pointer;
    transition:
      transform 0.12s cubic-bezier(0.23, 1, 0.32, 1),
      color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .more-toggle:active {
    transform: scale(0.97);
  }

  .chevron {
    display: inline-block;
    font-size: 0.65rem;
    line-height: 1;
    transition: transform 0.2s ease;
  }

  .tenant-band.expanded .chevron {
    transform: rotate(180deg);
  }

  /* ---- expand/collapse: 0fr→1fr row + opacity fade ---- */
  .more-collapse {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.25s ease;
  }

  .tenant-band.expanded .more-collapse {
    grid-template-rows: 1fr;
  }

  .more-inner {
    overflow: hidden;
    min-height: 0;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .tenant-band.expanded .more-inner {
    opacity: 1;
  }

  .icon-grid {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 4px;
    padding: 10px 0 2px;
  }

  /* ---- compact icon buttons (icon 18px, label 11px) ---- */
  .mini {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 8px 4px;
    border: none;
    border-radius: 8px;
    background: transparent;
    font-family: inherit;
    color: var(--label-2);
    cursor: pointer;
    transition:
      transform 0.12s cubic-bezier(0.23, 1, 0.32, 1),
      color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .mini:active {
    transform: scale(0.94);
  }

  .mini-icon {
    font-size: 18px;
    line-height: 1;
  }

  .mini-label {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.35;
    text-align: center;
  }

  .mini.danger {
    color: var(--red-deep);
  }

  .mini.refund {
    color: var(--green-deep);
  }

  .more-toggle:focus-visible,
  .mini:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .more-collapse,
    .more-inner,
    .chevron {
      transition: none;
    }
    .more-toggle:active,
    .mini:active,
    .tenant-head:active {
      transform: none;
    }
  }
</style>