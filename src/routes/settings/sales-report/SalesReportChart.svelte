<script lang="ts">
  import { phpPesoSigned } from "$lib/ui/format";

  /** One bucket of the sales report (week for a month, month for a year). */
  interface SalesBucket {
    start: string;
    amount: number;
    label: string;
  }

  /** Bar chart for the sales report (hand-rolled: flex row, heights scale from max). */
  let { buckets, maxBucket }: { buckets: SalesBucket[]; maxBucket: number } = $props();
</script>

<div class="chart">
  {#each buckets as b (b.start)}
    <div class="chart-col">
      <div class="bar-wrap">
        {#if b.amount !== 0}
          <span class="bar-value">{phpPesoSigned(b.amount)}</span>
        {/if}
        <div
          class="bar"
          class:bar-negative={b.amount < 0}
          style="height: {Math.max(2, Math.round((Math.abs(b.amount) / maxBucket) * 100))}%"
        ></div>
      </div>
      <span class="bar-label">{b.label}</span>
    </div>
  {/each}
</div>

<style>
  /* ---- chart ---- */
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 150px;
    margin-top: var(--space-3);
    padding-top: 18px; /* room for the value labels above the bars */
  }

  .chart-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    height: 100%;
  }

  .bar-wrap {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    min-height: 0;
  }

  .bar {
    width: 60%;
    max-width: 30px;
    border-radius: 4px 4px 2px 2px;
    background: var(--accent);
    min-height: 2px; /* zero-bucket stub */
  }

  .bar-negative {
    background: var(--red);
  }

  .bar-value {
    font-size: 0.66rem;
    color: var(--label-2);
    margin-bottom: 3px;
    white-space: nowrap;
    transform: rotate(-25deg);
    transform-origin: left bottom;
  }

  .bar-label {
    font-size: 0.7rem;
    color: var(--label-3);
    margin-top: 6px;
  }
</style>
