<script lang="ts">
  import { dueDateRowLabel, paymentLabel } from "$lib/tenants/payment-status";
  import { formatDate, formatMonthRange, monthKeyOf, phpPeso, phpPesoPrecise } from "$lib/ui/format";
  import Icon from "$lib/ui/Icon.svelte";
  import Phone from "@lucide/svelte/icons/phone";
  import { boarderStatus, type Boarder, type PaymentGroup } from "./boarders";

  /**
   * One boarder at level 2: the tinted card, payment badge, facts, quick
   * actions, and the lazily-loaded payment history. The parent keeps the
   * targets and the data; this owns the row's layout and styling.
   */
  let {
    boarder,
    roomMonthlyRate,
    expanded,
    historyLoading,
    historyError,
    historyGroups,
    onToggleHistory,
    onPay,
    onApply,
    onMoveOut,
    onEditPayment,
  }: {
    boarder: Boarder;
    roomMonthlyRate: number;
    expanded: boolean;
    historyLoading: boolean;
    historyError: string | undefined;
    historyGroups: PaymentGroup[] | undefined;
    onToggleHistory: () => void;
    onPay: () => void;
    onApply: () => void;
    onMoveOut: () => void;
    onEditPayment: (receiptNo: string) => void;
  } = $props();

  const b = $derived(boarder);
  const status = $derived(boarderStatus(b));
  const label = $derived(paymentLabel(status, b.due_date, new Date(), b.last_paid_date));
</script>

<!-- Due/overdue tenants are flagged by tinting the whole card (level 2);
     the name itself stays plain text — see room-modal-add-tenant-ui-spec.md. -->
<article class="boarder-card" class:overdue={status === "red"}>
  <div class="boarder-head">
    <h3>{b.name}</h3>
    <span class="pay-badge pay-{status}"><span class="pay-dot"></span>{label}</span>
  </div>

  {#if b.contact}
    <p class="boarder-contact"><Icon icon={Phone} size={16} /><span>{b.contact}</span></p>
  {/if}

  <dl class="boarder-facts">
    <div>
      <dt>Move-in</dt>
      <dd>{formatDate(b.move_in_date)}</dd>
    </div>
    <div>
      <dt>{dueDateRowLabel(b.due_date, new Date(), b.last_paid_date)}</dt>
      <dd>{formatDate(b.due_date)}</dd>
    </div>
    <div>
      <dt>Monthly rate</dt>
      <dd>{phpPeso(b.monthly_rate ?? roomMonthlyRate)}</dd>
    </div>
    {#if b.advance_held + b.deposit_held > 0}
      <div>
        <dt>Held</dt>
        <dd>
          {phpPesoPrecise(b.advance_held + b.deposit_held)}
          {#if b.advance_held > 0 && b.deposit_held > 0}
            · {phpPesoPrecise(b.advance_held)} adv · {phpPesoPrecise(b.deposit_held)} dep
          {:else if b.advance_held > 0}
            · advance
          {/if}
          {#if b.deposit_refunded === 1}
            · Refunded
          {/if}
        </dd>
      </div>
    {/if}
    {#if b.last_paid_date}
      <div>
        <dt>Last paid</dt>
        <dd>{formatDate(b.last_paid_date)}</dd>
      </div>
    {/if}
  </dl>

  <div class="boarder-actions">
    <button type="button" class="btn btn-small btn-paid" onclick={onPay}>
      Record Payment
    </button>
    {#if b.advance_held + b.deposit_held > 0}
      <button type="button" class="btn btn-small" onclick={onApply}>
        Apply held balance ({phpPesoPrecise(b.advance_held + b.deposit_held)})
      </button>
    {/if}
    <button type="button" class="btn btn-small btn-danger" onclick={onMoveOut}>
      Move Out
    </button>
  </div>

  <div class="history-block">
    <button
      type="button"
      class="history-toggle"
      aria-expanded={expanded}
      onclick={onToggleHistory}
    >
      <span>Payment history</span>
      <span class="history-chevron">{expanded ? "▾" : "▸"}</span>
    </button>
    {#if expanded}
      {#if historyLoading}
        <p class="muted history-note">Loading payment history…</p>
      {:else if historyError}
        <p class="form-error history-note">{historyError}</p>
      {:else if (historyGroups ?? []).length === 0}
        <p class="muted history-note">No payments recorded yet.</p>
      {:else}
        <ul class="history-list">
          {#each historyGroups ?? [] as g (g.receipt_no)}
            <li class="history-item">
              <div class="history-info">
                <span class="history-date">{formatDate(g.paid_date)}</span>
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
                <button
                  type="button"
                  class="btn btn-small history-edit"
                  onclick={() => onEditPayment(g.receipt_no)}
                >
                  Edit
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</article>

<style>
  /* ---- boarder sections ---- */
  .boarder-card {
    border: 1px solid var(--separator);
    border-radius: var(--radius-card);
    background: var(--card-2);
    padding: 14px;
    margin-bottom: 12px;
  }
  .boarder-card:last-child {
    margin-bottom: 0;
  }
  /* Due/overdue accent — mirrors the reserved-card pattern (soft border +
     tint) so only the outstanding tenants stand out. Paid and due-soon cards
     stay neutral. */
  .boarder-card.overdue {
    border-color: rgba(255, 59, 48, 0.35);
    background: var(--red-soft);
    background: color-mix(in srgb, var(--red-soft) 25%, var(--fill));
  }
  .boarder-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .boarder-head h3 {
    margin: 0;
    font-size: 1.05rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .boarder-contact {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .boarder-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px 16px;
    margin: 12px 0 0;
  }
  .boarder-facts div {
    min-width: 0;
  }
  .boarder-facts dt {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--label-3);
  }
  .boarder-facts dd {
    margin: 2px 0 0;
    font-size: 0.92rem;
    font-weight: 600;
  }

  /* ---- payment status badge (color dot + label) ---- */
  .pay-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .pay-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .pay-green {
    background: var(--green-soft);
    color: var(--green-deep);
  }
  .pay-yellow {
    background: var(--amber-soft);
    color: var(--amber-deep);
  }
  .pay-red {
    background: var(--red-soft);
    color: var(--red-deep);
  }
  .pay-green .pay-dot {
    background: var(--green);
  }
  .pay-yellow .pay-dot {
    background: var(--amber);
  }
  .pay-red .pay-dot {
    background: var(--red);
  }

  /* ---- quick actions (record payment / move out) ---- */
  .boarder-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .boarder-actions .btn-paid {
    flex: 1;
    min-width: 130px;
  }

  /* ---- expandable payment history ---- */
  .history-block {
    margin-top: 12px;
    border-top: 1px solid var(--separator);
    padding-top: 10px;
  }
  .history-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    padding: 4px 0;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--label-2);
    cursor: pointer;
    transition: color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  @media (hover: hover) {
    .history-toggle:hover {
      color: var(--accent);
    }
  }

  /* Touch: full-width but only ~24px tall — pad it out to a real row. */
  @media (pointer: coarse) {
    .history-toggle {
      min-height: 44px;
    }
  }
  .history-chevron {
    font-size: 0.7rem;
  }
  .history-note {
    margin: 8px 0 0;
    font-size: 0.85rem;
    font-style: italic;
  }
  .history-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--card);
    border: 1px solid var(--separator);
    border-radius: var(--radius-control);
    padding: 8px 10px;
  }
  .history-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .history-date {
    font-weight: 700;
    font-size: 0.85rem;
  }
  .history-due {
    color: var(--label-3);
    font-size: 0.78rem;
  }
  .history-side {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .history-amount {
    color: var(--accent);
    font-weight: 700;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .history-method {
    color: var(--amber-deep);
    background: var(--amber-soft);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.7rem;
    font-weight: 700;
    white-space: nowrap;
  }
</style>
