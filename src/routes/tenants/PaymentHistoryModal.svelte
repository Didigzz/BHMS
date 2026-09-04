<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { getDb } from "$lib/db";
  import { formatDate, formatMonthRange, monthKeyOf, phpPesoPrecise } from "$lib/format";
  import { heldBalanceOf } from "$lib/held-balance";
  import { pushOverlay } from "$lib/back-stack";
  import type { PaymentRecord, Tenant } from "./types";

  let {
    tenant,
    reloadKey = 0,
    onReceipt,
    onEdit,
    onApplyBalance,
    onClose,
  }: {
    tenant: Tenant;
    /** Bump to reload the list — used after an edit changes the payment rows. */
    reloadKey?: number;
    onReceipt?: (rows: PaymentRecord[]) => void;
    /** When provided, each row gets an Edit button (opens the edit flow). */
    onEdit?: (rows: PaymentRecord[]) => void;
    /** When provided, the modal shows the held balance with an Apply button. */
    onApplyBalance?: (t: Tenant) => void;
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
    /** Newest due date across the receipt's rows (the covered due date for new-style single payments). */
    due_date: string;
    total: number;
    method: string;
    count: number;
  }

  let groups = $state<PaymentGroup[]>([]);
  // The tenant's current balance pots — re-fetched so it stays fresh even
  // after an edit or an apply elsewhere (the prop may be a stale snapshot).
  let advanceHeld = $state(0);
  let depositHeld = $state(0);
  let loading = $state(true);
  let loadError: string | null = $state(null);
  let lastReloadKey = 0;

  // After an edit changes the rows, the page bumps reloadKey and we refresh
  // the list in place (the first render is handled by onMount).
  $effect(() => {
    if (reloadKey !== lastReloadKey) {
      lastReloadKey = reloadKey;
      if (reloadKey > 0) void loadHistory();
    }
  });

  onMount(() => {
    // Android back button closes this modal instead of navigating away. The
    // unregister must return synchronously (async onMount results are ignored
    // as cleanups), so the history load is kicked off separately.
    const unregister = pushOverlay(onClose);
    void loadHistory();
    return unregister;
  });

  async function loadHistory() {
    try {
      const db = await getDb();
      const [groupRows, balanceRows] = await Promise.all([
        db.select<PaymentGroup[]>(
          `SELECT receipt_no,
                  MIN(paid_date) AS paid_date,
                  MIN(covers_month) AS first_month,
                  MAX(covers_month) AS last_month,
                  MAX(due_date) AS due_date,
                  SUM(amount) AS total,
                  MAX(method) AS method,
                  COUNT(*) AS count
           FROM payments WHERE tenant_id=$1
           GROUP BY receipt_no
           ORDER BY MAX(id) DESC`,
          [tenant.id]
        ),
        db.select<{ advance_held: number; deposit_held: number }[]>(
          "SELECT advance_held, deposit_held FROM tenants WHERE id=$1",
          [tenant.id]
        ),
      ]);
      groups = groupRows;
      advanceHeld = balanceRows[0]?.advance_held ?? 0;
      depositHeld = balanceRows[0]?.deposit_held ?? 0;
    } catch (e) {
      loadError = `Failed to load payment history: ${String(e)}`;
    } finally {
      loading = false;
    }
  }

  /** Load one transaction's rows and hand them to the page (receipt or edit). */
  async function loadRows(receiptNo: string): Promise<PaymentRecord[] | null> {
    try {
      const db = await getDb();
      return await db.select<PaymentRecord[]>(
        "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
        [tenant.id, receiptNo]
      );
    } catch (e) {
      loadError = `Failed to load payment: ${String(e)}`;
      return null;
    }
  }

  /** Load one receipt's rows and hand them to the page to open the receipt. */
  async function openReceipt(g: PaymentGroup) {
    const rows = await loadRows(g.receipt_no);
    if (rows) onReceipt?.(rows);
  }

  /** Load one transaction's rows and hand them to the page to open the edit flow. */
  async function openEdit(g: PaymentGroup) {
    const rows = await loadRows(g.receipt_no);
    if (rows) onEdit?.(rows);
  }
</script>

<div class="modal" role="dialog" aria-label="Payment history" transition:modalMaterial>
  <div class="history-panel">
    <h2>Payment History</h2>
    <p class="history-subtitle">{tenant.name} · {tenant.room_number}</p>

    {#if heldBalanceOf({ advance_held: advanceHeld, deposit_held: depositHeld }) > 0}
      <div class="held-section">
        <div class="held-info">
          <span class="held-amount">💰 {phpPesoPrecise(heldBalanceOf({ advance_held: advanceHeld, deposit_held: depositHeld }))} held</span>
          <span class="held-split">
            {#if advanceHeld > 0 && depositHeld > 0}
              {phpPesoPrecise(advanceHeld)} advance · {phpPesoPrecise(depositHeld)} deposit
            {:else if advanceHeld > 0}
              {phpPesoPrecise(advanceHeld)} advance — used before any deposit
            {:else}
              {phpPesoPrecise(depositHeld)} deposit
            {/if}
          </span>
        </div>
        {#if onApplyBalance}
          <button
            type="button"
            class="btn btn-small btn-paid"
            onclick={() => onApplyBalance(tenant)}
          >
            Apply to months
          </button>
        {/if}
      </div>
    {/if}

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
              {#if onEdit}
                <button type="button" class="btn btn-small history-edit" onclick={() => openEdit(g)}>
                  Edit
                </button>
              {/if}
              {#if onReceipt}
                <button type="button" class="btn btn-small history-receipt" onclick={() => openReceipt(g)}>
                  Receipt
                </button>
              {/if}
            </div>
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

  /* ---- held balance banner ---- */
  .held-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--accent-soft);
    border: 1px solid rgba(10, 132, 255, 0.25);
    border-radius: 10px;
    padding: 10px 12px;
  }

  .held-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .held-amount {
    font-weight: 800;
    font-size: 0.95rem;
    color: var(--accent-deep);
  }

  .held-split {
    font-size: 0.78rem;
    color: var(--label-2);
  }

  /* Only the list scrolls (long histories), keeping the title and Close
     button always in view; the panel itself stays put. */
  .history-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: min(40vh, 380px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* Two-line rows: date + covered period on the left, amount + method +
     receipt on the right — no more awkward single-line wrapping. */
  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--separator);
    border-radius: 10px;
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
</style>
