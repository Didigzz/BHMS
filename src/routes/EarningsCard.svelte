<script lang="ts">
  import { addMonthsKey, formatMonthKey, phpPeso } from "$lib/format";
  import { computeMonthSummary, currentMonthKey, type EarningsPayment, type EarningsTenant } from "$lib/earnings";
  import EarningsModal from "./EarningsModal.svelte";

  let {
    tenants,
    payments,
    month = $bindable(),
  }: {
    tenants: EarningsTenant[];
    payments: EarningsPayment[];
    month: string;
  } = $props();

  const summary = $derived(computeMonthSummary(tenants, payments, month));
  const isFutureMonth = $derived(month > currentMonthKey());
  let breakdownOpen = $state(false);
</script>

<div class="card earnings-card">
  <div class="earnings-head">
    <h2 class="earnings-title">Monthly Earnings</h2>
    <div class="month-picker" role="group" aria-label="Select month">
      <button
        type="button"
        class="btn btn-small month-btn"
        aria-label="Previous month"
        onclick={() => (month = addMonthsKey(month, -1))}
      >
        ◀
      </button>
      <span class="month-label">{formatMonthKey(month)}</span>
      <button
        type="button"
        class="btn btn-small month-btn"
        aria-label="Next month"
        onclick={() => (month = addMonthsKey(month, 1))}
      >
        ▶
      </button>
    </div>
  </div>

  <div class="earnings-stats">
    <div class="stat">
      <span class="stat-label">Expected</span>
      <span class="stat-value">{phpPeso(summary.expected)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Collected</span>
      <span class="stat-value stat-collected">{phpPeso(summary.collected)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Pending</span>
      <span class="stat-value" class:pending={summary.pending > 0}>{phpPeso(summary.pending)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Paid</span>
      <span class="stat-value">
        {summary.paidCount}/{summary.rows.length}
      </span>
    </div>
  </div>

  {#if isFutureMonth}
    <p class="earnings-note">Projected — based on currently active tenants.</p>
  {/if}

  <button type="button" class="btn btn-primary earnings-breakdown" onclick={() => (breakdownOpen = true)}>
    View breakdown
  </button>
</div>

{#if breakdownOpen}
  <EarningsModal summary={summary} month={month} onClose={() => (breakdownOpen = false)} />
{/if}

<style>
  .earnings-card {
    margin-bottom: var(--space-4);
  }

  .earnings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .earnings-title {
    margin: 0;
    font-size: 1.05rem;
  }

  .month-picker {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .month-btn {
    padding: 4px 10px;
    font-size: 0.8rem;
    line-height: 1;
  }

  .month-label {
    font-size: 0.9rem;
    font-weight: 700;
    min-width: 118px;
    text-align: center;
  }

  .earnings-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--fill);
    border: 1px solid var(--separator);
    border-radius: 10px;
    padding: 10px 12px;
  }

  .stat-label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--label-3);
  }

  .stat-value {
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--label);
  }

  .stat-collected {
    color: var(--green-deep);
  }

  .stat-value.pending {
    color: var(--red-deep);
  }

  .earnings-note {
    margin: 0 0 var(--space-3);
    font-size: 0.8rem;
    background: var(--accent-soft);
    color: var(--accent-deep);
    border-radius: 8px;
    padding: 8px 10px;
  }

  .earnings-breakdown {
    width: 100%;
  }

  @media (min-width: 480px) {
    .earnings-stats {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
