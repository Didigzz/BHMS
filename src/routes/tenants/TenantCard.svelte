<script lang="ts">
  import { getPaymentStatus, paymentLabel } from "$lib/payment-status";
  import { formatDate, phpPesoPrecise } from "$lib/format";
  import type { Tenant } from "./types";

  let {
    tenant,
    archived = false,
    onPay,
    onHistory,
    onEdit,
    onMoveOut,
    onDepositRefunded,
    onDelete,
  }: {
    tenant: Tenant;
    archived?: boolean;
    onPay?: (t: Tenant) => void;
    onHistory: (t: Tenant) => void;
    onEdit?: (t: Tenant) => void;
    onMoveOut?: (t: Tenant) => void;
    onDepositRefunded?: (t: Tenant) => void;
    onDelete?: (t: Tenant) => void;
  } = $props();

  const status = $derived(getPaymentStatus(tenant.due_date, new Date(), tenant.last_paid_date));
  const statusLabel = $derived(paymentLabel(status, tenant.due_date, new Date(), tenant.last_paid_date));
</script>

{#if archived}
  <li class="card tenant-item">
    <div class="tenant-main">
      <h3>{tenant.name}</h3>
      <p class="tenant-meta">🛏️ <strong>{tenant.room_number}</strong></p>
      <p class="tenant-meta">Moved out: {formatDate(tenant.moved_out_date ?? "")}</p>
      {#if tenant.deposit_amount != null && tenant.deposit_amount > 0}
        <p class="tenant-meta">
          {#if tenant.deposit_refunded === 1}
            <span class="deposit-ok">Deposit {phpPesoPrecise(tenant.deposit_amount)} refunded</span>
          {:else}
            <span class="deposit-pending">Deposit {phpPesoPrecise(tenant.deposit_amount)} unrefunded</span>
          {/if}
        </p>
      {/if}
    </div>
    <div class="tenant-side">
      <div class="tenant-actions">
        <button class="btn btn-small" onclick={() => onHistory(tenant)}>History</button>
        {#if tenant.deposit_amount != null && tenant.deposit_amount > 0 && tenant.deposit_refunded === 0 && onDepositRefunded}
          <button class="btn btn-small btn-paid" onclick={() => onDepositRefunded(tenant)}>
            ✓ Deposit Refunded
          </button>
        {/if}
        {#if onDelete}
          <button class="btn btn-small btn-danger" onclick={() => onDelete(tenant)}>Delete</button>
        {/if}
      </div>
    </div>
  </li>
{:else}
  <li class="card tenant-item">
    <div class="tenant-main">
      <h3>{tenant.name}</h3>
      <p class="tenant-meta">
        📞 {tenant.contact}
      </p>
      <p class="tenant-meta">
        🛏️ <strong>{tenant.room_number}</strong>
      </p>
      <p class="tenant-meta">
        Move-in: {formatDate(tenant.move_in_date)} · Due: {formatDate(tenant.due_date)}
      </p>
      {#if tenant.deposit_amount != null && tenant.deposit_amount > 0}
        <p class="tenant-meta">💰 Deposit: {phpPesoPrecise(tenant.deposit_amount)}</p>
      {/if}
    </div>
    <div class="tenant-side">
      <span class="pay-badge pay-{status}" title={statusLabel}>
        {statusLabel}
      </span>
      <div class="tenant-actions">
        {#if onPay}
          <button class="btn btn-small btn-paid" onclick={() => onPay(tenant)}>✓ Mark as Paid</button>
        {/if}
        <button class="btn btn-small" onclick={() => onHistory(tenant)}>History</button>
        {#if onEdit}
          <button class="btn btn-small" onclick={() => onEdit(tenant)}>Edit</button>
        {/if}
        {#if onMoveOut}
          <button class="btn btn-small btn-danger" onclick={() => onMoveOut(tenant)}>Move Out</button>
        {/if}
      </div>
    </div>
  </li>
{/if}

<style>
  /* ---- list item ---- */
  .tenant-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .tenant-main {
    flex: 1;
    min-width: 0;
  }

  .tenant-main h3 {
    margin: 0 0 4px;
    font-size: 1.05rem;
  }

  .tenant-meta {
    margin: 2px 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .tenant-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }

  .tenant-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .pay-badge {
    padding: 3px 12px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
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

  .deposit-ok {
    color: var(--green-deep);
    font-weight: 600;
  }

  .deposit-pending {
    color: var(--red-deep);
    font-weight: 600;
  }

  @media (min-width: 600px) {
    .tenant-actions {
      flex-direction: row;
    }
  }
</style>
