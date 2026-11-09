<script lang="ts">
  import { addMonthsKey, formatMonthKey, phpPeso } from "$lib/ui/format";
  import { computeMonthSummary, currentMonthKey, type EarningsPayment, type EarningsTenant } from "$lib/reports/earnings";
  import Icon from "$lib/ui/Icon.svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
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
  const progress = $derived(
    summary.expected > 0
      ? Math.min(100, Math.round((summary.collected / summary.expected) * 100))
      : 0
  );
  const complete = $derived(summary.expected > 0 && summary.collected >= summary.expected);
  let breakdownOpen = $state(false);
</script>

<div class="card earnings-card">
  <div class="earnings-head">
    <div class="earnings-title-block">
      <p class="eyebrow">This month</p>
      <h2 class="earnings-title">{formatMonthKey(month)}</h2>
    </div>
    <div class="month-picker" role="group" aria-label="Select month">
      <button
        type="button"
        class="btn btn-small month-btn"
        aria-label="Previous month"
        onclick={() => (month = addMonthsKey(month, -1))}
      >
        <Icon icon={ChevronLeft} size={16} />
      </button>
      <button
        type="button"
        class="btn btn-small month-btn"
        aria-label="Next month"
        onclick={() => (month = addMonthsKey(month, 1))}
      >
        <Icon icon={ChevronRight} size={16} />
      </button>
    </div>
  </div>

  <p class="hero-label">Collected</p>
  <p class="hero-amount">{phpPeso(summary.collected)}</p>
  <p class="hero-sub">of {phpPeso(summary.expected)} expected</p>

  <div
    class="progress"
    role="img"
    aria-label={`${progress}% of expected earnings collected`}
  >
    <span class="progress-fill" class:complete style:width={`${progress}%`}></span>
  </div>

  <dl class="metrics">
    <div>
      <dt>Expected</dt>
      <dd>{phpPeso(summary.expected)}</dd>
    </div>
    <div>
      <dt>Pending</dt>
      <dd class:pending={summary.pending > 0}>{phpPeso(summary.pending)}</dd>
    </div>
    <div>
      <dt>Paid</dt>
      <dd>{summary.paidCount}<span>/{summary.rows.length}</span></dd>
    </div>
  </dl>

  {#if isFutureMonth}
    <p class="earnings-note">Projected — based on currently active tenants.</p>
  {/if}

  <button type="button" class="btn btn-quiet breakdown" onclick={() => (breakdownOpen = true)}>
    View breakdown
    <span class="arrow" aria-hidden="true">→</span>
  </button>
</div>

{#if breakdownOpen}
  <EarningsModal summary={summary} month={month} onClose={() => (breakdownOpen = false)} />
{/if}

<style>
  .earnings-card {
    padding-bottom: 12px;
  }

  .earnings-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }

  .earnings-title-block {
    min-width: 0;
  }

  .earnings-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.2;
    white-space: nowrap;
  }

  .month-picker {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .month-btn {
    width: 40px;
    height: 40px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: var(--radius-control);
    color: var(--label-2);
    background: var(--card-2);
  }

  .hero-label {
    margin: 0;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--label-3);
  }

  .hero-amount {
    margin: 2px 0 0;
    font-size: 2.2rem;
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.045em;
    font-variant-numeric: tabular-nums;
    color: var(--label);
  }

  .hero-sub {
    margin: 3px 0 0;
    font-size: 0.9rem;
    color: var(--label-2);
  }

  .progress {
    height: 6px;
    margin: 16px 0 18px;
    border-radius: var(--radius-pill);
    background: var(--fill);
    overflow: hidden;
  }

  .progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.35s cubic-bezier(0.23, 1, 0.32, 1);
  }

  .progress-fill.complete {
    background: var(--green);
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin: 0;
    padding-top: 14px;
    border-top: 1px solid var(--separator);
  }

  .metrics div {
    min-width: 0;
  }

  .metrics dt {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--label-3);
  }

  .metrics dd {
    margin: 4px 0 0;
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--label);
    overflow-wrap: anywhere;
  }

  /* Pending money is not necessarily late — red is reserved for overdue. */
  .metrics dd.pending {
    color: var(--amber-deep);
  }

  .metrics dd span {
    color: var(--label-3);
    font-weight: 600;
  }

  .earnings-note {
    margin: 14px 0 0;
    padding: 9px 12px;
    border-radius: var(--radius-control);
    background: var(--accent-soft);
    color: var(--accent-deep);
    font-size: 0.82rem;
    font-weight: 600;
  }

  .breakdown {
    width: 100%;
    margin-top: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .arrow {
    transition: transform 0.18s cubic-bezier(0.23, 1, 0.32, 1);
  }

  @media (hover: hover) {
    .breakdown:hover .arrow {
      transform: translateX(3px);
    }
  }

  @media (max-width: 360px) {
    .hero-amount {
      font-size: 1.95rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-fill,
    .arrow {
      transition: none;
    }
  }
</style>
