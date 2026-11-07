<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { formatDate, formatMonthKey, phpPeso, phpPesoPrecise } from "$lib/format";
  import { pushOverlay } from "$lib/back-stack";
  import type { MonthSummary } from "$lib/earnings";

  let {
    summary,
    month,
    onClose,
  }: {
    summary: MonthSummary;
    month: string;
    onClose: () => void;
  } = $props();

  // Android back button closes this modal instead of navigating away.
  onMount(() => {
    const unregister = pushOverlay(onClose);
    return unregister;
  });
</script>

<div class="modal" role="dialog" aria-label="Earnings breakdown" transition:modalMaterial>
  <div class="breakdown-panel">
    <h2>Earnings — {formatMonthKey(month)}</h2>

    {#if summary.rows.length === 0}
      <p class="muted no-rows">No tenants were active in {formatMonthKey(month)}.</p>
    {:else}
      <ul class="breakdown-list">
        {#each summary.rows as row (row.tenant.id)}
          <li class="breakdown-item">
            <div class="b-main">
              <span class="b-name">{row.tenant.name}</span>
              <span class="b-meta">
                {row.tenant.room_number} · {phpPeso(row.tenant.rate)}/mo
                {#if row.paid && row.paidDueDate}
                  · Due {formatDate(row.paidDueDate)}
                {/if}
                {#if !row.paid && row.collected > 0}
                  · {phpPesoPrecise(row.collected)} collected
                {/if}
              </span>
            </div>
            <span class="b-status b-{row.paid ? "paid" : "unpaid"}">
              {row.paid ? "Paid" : "Unpaid"}
            </span>
          </li>
        {/each}
      </ul>

      <div class="b-footer">
        <span>Expected {phpPeso(summary.expected)}</span>
        <span class="b-collected">Collected {phpPeso(summary.collected)}</span>
        <span class="b-pending">Pending {phpPeso(summary.pending)}</span>
      </div>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose}>Close</button>
    </div>
  </div>
</div>

<style>
  .breakdown-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .breakdown-panel h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  .no-rows {
    font-style: italic;
  }

  .breakdown-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    /* dvh so the list measures the visible viewport on a phone, where the
       system bars take part of it. */
    max-height: 46vh;
    max-height: 46dvh;
    overflow-y: auto;
  }

  .breakdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--separator);
    border-radius: 10px;
    background: var(--fill);
  }

  .b-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .b-name {
    font-weight: 700;
    font-size: 0.95rem;
  }

  .b-meta {
    font-size: 0.78rem;
    color: var(--label-2);
  }

  .b-status {
    flex-shrink: 0;
    padding: 3px 12px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .b-paid {
    color: var(--green-deep);
    background: var(--green-soft);
  }

  .b-unpaid {
    color: var(--red-deep);
    background: var(--red-soft);
  }

  .b-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--label-2);
    border-top: 1px solid var(--separator);
    padding-top: 10px;
  }

  .b-collected {
    color: var(--green-deep);
  }

  .b-pending {
    color: var(--red-deep);
  }
</style>
