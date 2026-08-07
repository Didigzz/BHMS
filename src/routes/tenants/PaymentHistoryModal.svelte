<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { getDb } from "$lib/db";
  import { formatDate, formatMonthRange, phpPesoPrecise } from "$lib/format";
  import type { PaymentRecord, Tenant } from "./types";

  let {
    tenant,
    onReceipt,
    onClose,
  }: {
    tenant: Tenant;
    onReceipt?: (rows: PaymentRecord[]) => void;
    onClose: () => void;
  } = $props();

  /**
   * Payments are grouped by receipt number: an advance payment for several
   * months is one row per covered month in the DB but one receipt transaction
   * in the UI (billing-features-spec.md §5).
   */
  interface PaymentGroup {
    receipt_no: string;
    paid_date: string;
    first_month: string | null;
    last_month: string | null;
    total: number;
    method: string;
    count: number;
  }

  let groups = $state<PaymentGroup[]>([]);
  let loading = $state(true);
  let loadError: string | null = $state(null);

  onMount(async () => {
    try {
      const db = await getDb();
      groups = await db.select<PaymentGroup[]>(
        `SELECT receipt_no,
                MIN(paid_date) AS paid_date,
                MIN(covers_month) AS first_month,
                MAX(covers_month) AS last_month,
                SUM(amount) AS total,
                MAX(method) AS method,
                COUNT(*) AS count
         FROM payments WHERE tenant_id=$1
         GROUP BY receipt_no
         ORDER BY MAX(id) DESC`,
        [tenant.id]
      );
    } catch (e) {
      loadError = `Failed to load payment history: ${String(e)}`;
    } finally {
      loading = false;
    }
  });

  /** Load one receipt's rows and hand them to the page to open the receipt. */
  async function openReceipt(g: PaymentGroup) {
    try {
      const db = await getDb();
      const rows = await db.select<PaymentRecord[]>(
        "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
        [tenant.id, g.receipt_no]
      );
      onReceipt?.(rows);
    } catch (e) {
      loadError = `Failed to load receipt: ${String(e)}`;
    }
  }
</script>

<div class="modal" role="dialog" aria-label="Payment history" transition:modalMaterial>
  <div class="history-panel">
    <h2>Payment History</h2>
    <p class="history-subtitle">{tenant.name} · {tenant.room_number}</p>

    {#if loading}
      <p class="muted">Loading payment history…</p>
    {:else if loadError}
      <p class="form-error">{loadError}</p>
    {:else if groups.length === 0}
      <p class="muted no-history">No payments recorded yet.</p>
    {:else}
      <ul class="history-list">
        {#each groups as g (g.receipt_no)}
          <li class="history-item">
            <span class="history-date">{formatDate(g.paid_date)}</span>
            <span class="history-amount">{phpPesoPrecise(g.total)}</span>
            <span class="history-due">{formatMonthRange(g.first_month, g.last_month)}</span>
            {#if g.method !== "cash" && g.method !== "—"}
              <span class="history-method">{g.method}</span>
            {/if}
            {#if onReceipt}
              <button type="button" class="btn btn-small history-receipt" onclick={() => openReceipt(g)}>
                Receipt
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose}>Close</button>
    </div>
  </div>
</div>

<style>
  /* ---- payment history ---- */
  .history-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .history-panel h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  .no-history {
    font-style: italic;
  }

  .history-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 40vh;
    overflow-y: auto;
  }

  .history-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--separator);
    border-radius: 10px;
    background: var(--fill);
  }

  .history-date {
    font-weight: 700;
    font-size: 0.9rem;
  }

  .history-amount {
    color: var(--accent);
    font-weight: 600;
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .history-due {
    color: var(--label-3);
    font-size: 0.8rem;
  }

  .history-method {
    color: var(--amber-deep);
    background: var(--amber-soft);
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .history-receipt {
    margin-left: auto;
    flex-shrink: 0;
  }
</style>
