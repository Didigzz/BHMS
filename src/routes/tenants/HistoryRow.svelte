<script lang="ts">
  import { formatDate, formatMonthRange, monthKeyOf, phpPesoPrecise } from "$lib/ui/format";
  import type { HistoryRow, RentHistoryGroup } from "$lib/amenities/amenity-payments";

  /**
   * One row of the merged payment history — rent receipt or amenity payment.
   * Extracted from PaymentHistoryModal so the modal keeps the list, filters and
   * modal shell while the row owns its two-line layout and badges.
   */
  let {
    row,
    onEdit,
    onReceipt,
  }: {
    row: HistoryRow;
    /** Rent rows only, and only when the page supplied an edit flow. */
    onEdit?: (group: RentHistoryGroup) => void;
    /** Rent rows only, and only when the page supplied a receipt flow. */
    onReceipt?: (group: RentHistoryGroup) => void;
  } = $props();
</script>

<li class="history-item">
  {#if row.kind === "rent"}
    {@const g = row.group}
    <div class="history-info">
      <span class="history-date">{formatDate(g.paid_date)} <span class="type-tag">Rent</span></span>
      <span class="history-due">
        {#if g.count === 1 && g.first_month && g.due_date && monthKeyOf(g.due_date) === g.first_month}
          Due {formatDate(g.due_date)}
        {:else}
          {formatMonthRange(g.first_month, g.last_month)}
        {/if}
      </span>
    </div>
    <div class="history-side">
      <span class="history-amount">{phpPesoPrecise(g.total)}</span>
      {#if g.method !== "cash" && g.method !== "—"}
        <span class="history-method">{g.method}</span>
      {/if}
      {#if onEdit}
        <button type="button" class="btn btn-small history-edit" onclick={() => onEdit(g)}>
          Edit
        </button>
      {/if}
      {#if onReceipt}
        <button type="button" class="btn btn-small history-receipt" onclick={() => onReceipt(g)}>
          Receipt
        </button>
      {/if}
    </div>
  {:else}
    {@const payment = row.payment}
    <div class="history-info">
      <span class="history-date" title={payment.amenity_name}>
        <span class="amenity-name">{payment.amenity_name}</span> <span class="type-tag">Amenity</span>
      </span>
      <span class="history-due">
        {payment.billing_period ?? formatDate(payment.billing_date)}
      </span>
    </div>
    <div class="history-side">
      <span class="history-amount" class:struck={payment.status === "reversed"}>
        {phpPesoPrecise(payment.amount)}
      </span>
      <span class="history-due">{formatDate(payment.paid_date)}</span>
      {#if payment.status === "reversed"}
        <span class="history-method reversed">Reversed</span>
      {/if}
    </div>
  {/if}
</li>

<style>
  /* Two-line rows: date + covered period on the left, amount + method +
     receipt on the right — no more awkward single-line wrapping. */
  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--separator);
    border-radius: var(--radius-control);
    background: var(--fill);
  }

  .history-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .history-date {
    font-weight: 700;
    font-size: 0.9rem;
  }

  .history-due {
    color: var(--label-3);
    font-size: 0.8rem;
  }

  .history-side {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
  }

  .history-amount {
    color: var(--accent);
    font-weight: 700;
    font-size: 0.9rem;
    white-space: nowrap;
  }

  .history-method {
    color: var(--amber-deep);
    background: var(--amber-soft);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .history-receipt {
    flex-shrink: 0;
  }

  .type-tag {
    display: inline-block;
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--fill);
    color: var(--label-3);
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    vertical-align: 1px;
  }

  .amenity-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-amount.struck {
    text-decoration: line-through;
    color: var(--label-3);
  }

  .history-method.reversed {
    background: var(--gray-soft);
    color: var(--gray-deep);
  }
</style>
