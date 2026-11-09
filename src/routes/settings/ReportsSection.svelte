<script lang="ts">
  import { onMount } from "svelte";
  import { getSetting, setSetting } from "$lib/db/settings";
  import { pushToast } from "$lib/ui/toast.svelte";

  let {
    onError,
  }: {
    onError: (msg: string | null) => void;
  } = $props();

  // Total capacity (beds) drives the sales report's occupancy line
  // (sales-report-spec.md §7). Stored as a string in the key/value settings
  // table like house_name; independent of per-room capacity.
  let totalCapacity = $state("");
  let loaded = $state(false);

  onMount(async () => {
    try {
      totalCapacity = await getSetting("total_capacity", "");
    } catch (e) {
      onError(`Failed to load settings: ${String(e)}`);
    } finally {
      loaded = true;
    }
  });

  /** Persist the capacity; must be a non-empty integer ≥ 1. */
  async function save() {
    const trimmed = totalCapacity.trim();
    const n = Number(trimmed);
    if (!trimmed || !Number.isInteger(n) || n < 1) {
      pushToast("Total capacity must be a whole number of at least 1", "error");
      totalCapacity = await getSetting("total_capacity", "");
      return;
    }
    try {
      await setSetting("total_capacity", String(n));
      totalCapacity = String(n);
      pushToast("Total capacity saved", "success");
    } catch (e) {
      onError(`Failed to save: ${String(e)}`);
    }
  }
</script>

<div class="card">
  <h2 class="section-title">Reports</h2>
  <p class="muted">Sales, move-ins, move-outs &amp; occupancy for a period — exportable to PDF.</p>

  <a class="report-row" href="/settings/sales-report">
    <span class="report-row-label">Sales Report</span>
    <span class="report-row-chevron">›</span>
  </a>

  <label class="capacity-label">
    Total capacity (beds)
    <div class="capacity-row">
      <input
        type="number"
        min="1"
        step="1"
        inputmode="numeric"
        placeholder="e.g. 20"
        bind:value={totalCapacity}
      />
      <button type="button" class="btn btn-primary" onclick={save} disabled={!loaded}>Save</button>
    </div>
  </label>
  <p class="capacity-hint">Used for occupancy in the Sales Report. Counts beds, not rooms.</p>
</div>

<style>
  .report-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: var(--radius-control);
    background: var(--fill);
    text-decoration: none;
    color: var(--label);
    transition:
      background 0.15s ease,
      transform 0.12s cubic-bezier(0.23, 1, 0.32, 1);
    -webkit-tap-highlight-color: transparent;
  }

  .report-row:active {
    transform: scale(0.98);
    background: var(--gray-soft);
  }

  .report-row-label {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .report-row-chevron {
    color: var(--label-3);
    font-size: 1.3rem;
    line-height: 1;
  }

  .capacity-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: var(--space-3);
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .capacity-row {
    display: flex;
    gap: 8px;
  }

  .capacity-row input {
    flex: 1;
    min-width: 0;
    border-radius: var(--radius-control);
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .capacity-row input:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }

  .capacity-hint {
    margin: var(--space-2) 0 0;
    font-size: 0.8rem;
    color: var(--label-3);
  }
</style>