<script lang="ts">
  import { getDb } from "$lib/db";
  import { getSetting } from "$lib/settings";
  import { currentMonthKey } from "$lib/earnings";
  import { addMonthsKey, formatShortDay, phpPeso, roomLabel } from "$lib/format";
  import { pushToast } from "$lib/toast.svelte";
  import {
    atCurrentMonth,
    atCurrentYear,
    computeSalesReport,
    monthPeriod,
    salesReportQuery,
    stepMonthBack,
    stepYearBack,
    todayIso,
    yearPeriod,
    type ReportMode,
    type SalesReport,
    type SalesReportRaw,
  } from "$lib/sales-report";
  import { exportSalesReportPdf, generateSalesReportPdf } from "$lib/pdf-export";

  // "As of" date for the period (stable for this page session).
  const today = todayIso();

  // ----- filters (sales-report-spec.md §3) -----
  let mode: ReportMode = $state("month");
  let monthKey = $state(currentMonthKey());
  let year = $state(new Date().getFullYear());
  const currentKey = $derived(currentMonthKey());
  const currentYear = $derived(new Date().getFullYear());

  const period = $derived(
    mode === "month" ? monthPeriod(monthKey, today) : yearPeriod(year, today)
  );
  const atForwardLimit = $derived(
    mode === "month" ? atCurrentMonth(monthKey, currentKey) : atCurrentYear(year, currentYear)
  );

  // ----- data -----
  let raw: SalesReportRaw | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);
  let requestId = 0;

  async function loadFor(p: ReturnType<typeof monthPeriod> | ReturnType<typeof yearPeriod>) {
    const id = ++requestId;
    loading = true;
    error = null;
    try {
      const db = await getDb();
      const rows = await salesReportQuery(db, p);
      if (id !== requestId) return; // a newer period request superseded this one
      raw = rows;
    } catch (e) {
      if (id !== requestId) return;
      error = `Failed to load report: ${String(e)}`;
    } finally {
      if (id === requestId) loading = false;
    }
  }

  // Re-run the query whenever the selected period changes.
  $effect(() => {
    const p = period;
    void loadFor(p);
  });

  const report = $derived(raw ? computeSalesReport(raw, period, today) : null);

  // ----- navigation (free back, forward capped at the current period) -----
  function goBack() {
    if (mode === "month") monthKey = stepMonthBack(monthKey);
    else year = stepYearBack(year);
  }

  function goForward() {
    if (mode === "month") monthKey = addMonthsKey(monthKey, 1);
    else year = year + 1;
  }

  // ----- chart -----
  const maxBucket = $derived(report ? Math.max(1, ...report.buckets.map((b) => Math.abs(b.amount))) : 1);

  /** ₱ with a proper minus sign for negative totals (spec shows −₱1,500). */
  function phpPesoSigned(n: number): string {
    return phpPeso(n).replace(/^-/, "−");
  }

  // ----- export -----
  let exporting = $state(false);
  let pdfError: string | null = $state(null);

  async function exportPdf() {
    if (exporting || !report) return;
    exporting = true;
    pdfError = null;
    try {
      const houseName = await getSetting("house_name", "RentEase");
      const dataUrl = await generateSalesReportPdf({
        houseName,
        periodLabel: report.period.label,
        containsToday: report.period.containsToday,
        total: report.total,
        buckets: report.buckets,
        moveIns: report.moveIns,
        moveOuts: report.moveOuts,
        occupancy: report.occupancy,
        hasCapacity: report.hasCapacity,
      });
      // sales-report-YYYY-MM.pdf (month) / sales-report-YYYY.pdf (year).
      const filename =
        report.period.mode === "month"
          ? `sales-report-${report.period.start.slice(0, 7)}.pdf`
          : `sales-report-${report.period.start.slice(0, 4)}.pdf`;
      const result = await exportSalesReportPdf(dataUrl, filename);
      pushToast(
        result === "downloaded" ? "Sales report PDF downloaded" : "Sales report saved to Downloads",
        "success"
      );
    } catch (e) {
      const msg = String(e);
      pdfError = msg;
      pushToast(msg, "error");
    } finally {
      exporting = false;
    }
  }
</script>

<main>
  <header class="page-header">
    <div>
      <div class="title-row">
        <h1>Sales Report</h1>
        {#if report?.period.containsToday}
          <span class="badge badge-reserved">as of today</span>
        {/if}
      </div>
      <p class="subtitle">{period.label}</p>
    </div>
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}

  <!-- filters -->
  <div class="segmented" role="tablist" aria-label="Report period mode">
    <button class:active={mode === "month"} onclick={() => (mode = "month")}>Month</button>
    <button class:active={mode === "year"} onclick={() => (mode = "year")}>Year</button>
  </div>

  <div class="picker" aria-label="Pick report period">
    <button type="button" class="picker-btn" aria-label="Previous period" onclick={goBack}>◀</button>
    <span class="picker-label">{period.label}</span>
    <button
      type="button"
      class="picker-btn"
      aria-label="Next period"
      disabled={atForwardLimit}
      onclick={goForward}
    >▶</button>
  </div>

  {#if loading}
    <p class="muted">Loading report…</p>
  {:else if report}
    {#if report.isEmpty}
      <div class="card empty">
        <p class="muted">No activity this period.</p>
      </div>
    {:else}
      <!-- bar chart (hand-rolled: flex row, heights scale from the max bucket) -->
      <div class="card">
        <h2 class="section-title">Sales by {mode === "month" ? "week" : "month"}</h2>
        <div class="chart">
          {#each report.buckets as b (b.start)}
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
      </div>

      <!-- net sales -->
      <div class="card">
        <h2 class="section-title">Sales total</h2>
        <div class="sales-total">{phpPesoSigned(report.total)}</div>
      </div>

      <!-- move-ins -->
      <div class="card">
        <h2 class="section-title">Move-ins</h2>
        {#if report.moveIns.length === 0}
          <p class="muted">No move-ins this period.</p>
        {:else}
          <ul class="event-list">
            {#each report.moveIns as e (e.date + e.name)}
              <li class="event-line">
                <span class="event-tag event-in">Move-in</span>
                <span>{e.name} — {formatShortDay(e.date)} · {roomLabel(e.room)} · {phpPeso(e.rate)}/mo</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- move-outs -->
      <div class="card">
        <h2 class="section-title">Move-outs</h2>
        {#if report.moveOuts.length === 0}
          <p class="muted">No move-outs this period.</p>
        {:else}
          <ul class="event-list">
            {#each report.moveOuts as e (e.date + e.name)}
              <li class="event-line">
                <span class="event-tag event-out">Move-out</span>
                <span>{e.name} — {formatShortDay(e.date)} · {roomLabel(e.room)} · {phpPeso(e.rate)}/mo</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- occupancy (always meaningful, even in an empty period) -->
    <div class="card">
      <h2 class="section-title">Occupancy</h2>
      {#if report.hasCapacity}
        <div class="occ-line">
          {report.occupancy.occupied}/{report.occupancy.total} ({report.occupancy.pct}%)
        </div>
      {:else}
        <p class="muted">Set total capacity in Settings to see occupancy</p>
      {/if}
    </div>

    {#if pdfError}
      <p class="form-error">{pdfError}</p>
    {/if}

    <button type="button" class="btn btn-primary export-btn" onclick={exportPdf} disabled={exporting}>
      {exporting ? "Generating…" : "Download PDF"}
    </button>
  {/if}
</main>

<style>
  .page-header {
    margin-bottom: 20px;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .title-row h1 {
    line-height: 1.2;
  }

  /* ---- period picker ---- */
  .picker {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }

  .picker-btn {
    border: 1px solid var(--separator);
    background: var(--card);
    color: var(--label);
    border-radius: 10px;
    width: 40px;
    height: 40px;
    font-size: 1rem;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.15s ease,
      transform 0.12s cubic-bezier(0.23, 1, 0.32, 1);
    -webkit-tap-highlight-color: transparent;
  }

  .picker-btn:active {
    transform: scale(0.94);
  }

  .picker-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .picker-label {
    flex: 1;
    text-align: center;
    font-size: 1.1rem;
    font-weight: 700;
  }

  /* ---- chart ---- */
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 150px;
    margin-top: 14px;
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

  /* ---- sales total ---- */
  .sales-total {
    font-size: 1.5rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  /* ---- move lists ---- */
  .event-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .event-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 0.92rem;
  }

  .event-tag {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border-radius: 999px;
    padding: 2px 8px;
    flex-shrink: 0;
  }

  .event-in {
    color: var(--green-deep);
    background: var(--green-soft);
  }

  .event-out {
    color: var(--red-deep);
    background: var(--red-soft);
  }

  /* ---- occupancy ---- */
  .occ-line {
    font-size: 1.1rem;
    font-weight: 700;
  }

  .export-btn {
    width: 100%;
    padding: 12px;
    font-size: 1rem;
    margin-bottom: 8px;
  }
</style>