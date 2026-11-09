<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/ui/motion";
  import { getDb } from "$lib/db/db";
  import { phpPesoPrecise } from "$lib/ui/format";
  import { heldBalanceOf } from "$lib/tenants/held-balance";
  import { pushOverlay } from "$lib/ui/back-stack";
  import Icon from "$lib/ui/Icon.svelte";
  import HandCoins from "@lucide/svelte/icons/hand-coins";
  import type { PaymentRecord, Tenant } from "../../lib/tenants/types";
  import {
    buildHistoryRows,
    type AmenityPaymentRow,
    type RentHistoryGroup,
  } from "$lib/amenities/amenity-payments";
  import { getTenantAmenityPayments } from "$lib/amenities/amenity-payment-actions";
  import { groupReceipts, loadReceiptRows, type PaymentGroup } from "$lib/tenants/payment-groups";
  import HistoryRow from "./HistoryRow.svelte";

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

  let groups = $state<PaymentGroup[]>([]);
  let amenityRows = $state<AmenityPaymentRow[]>([]);
  let filter: "all" | "rent" | "amenity" = $state("all");

  const merged = $derived(buildHistoryRows(groups, amenityRows));
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
      const [groupRows, balanceRows, amenity] = await Promise.all([
        groupReceipts(db, tenant.id),
        db.select<{ advance_held: number; deposit_held: number }[]>(
          "SELECT advance_held, deposit_held FROM tenants WHERE id=$1",
          [tenant.id]
        ),
        getTenantAmenityPayments(db, tenant.id),
      ]);
      groups = groupRows;
      amenityRows = amenity;
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
      return await loadReceiptRows(db, tenant.id, receiptNo);
    } catch (e) {
      loadError = `Failed to load payment: ${String(e)}`;
      return null;
    }
  }

  /** Load one receipt's rows and hand them to the page to open the receipt. */
  async function openReceipt(g: RentHistoryGroup) {
    const rows = await loadRows(g.receipt_no);
    if (rows) onReceipt?.(rows);
  }

  /** Load one transaction's rows and hand them to the page to open the edit flow. */
  async function openEdit(g: RentHistoryGroup) {
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
          <span class="held-amount"><Icon icon={HandCoins} size={16} /> {phpPesoPrecise(heldBalanceOf({ advance_held: advanceHeld, deposit_held: depositHeld }))} held</span>
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

    <div class="chips history-filters" role="group" aria-label="Payment type">
      <button type="button" class:active={filter === "all"} aria-pressed={filter === "all"} onclick={() => (filter = "all")}>All</button>
      <button type="button" class:active={filter === "rent"} aria-pressed={filter === "rent"} onclick={() => (filter = "rent")}>Rent</button>
      <button type="button" class:active={filter === "amenity"} aria-pressed={filter === "amenity"} onclick={() => (filter = "amenity")}>Amenities</button>
    </div>

    {#if loading}
      <p class="muted">Loading payment history…</p>
    {:else if loadError}
      <p class="form-error">{loadError}</p>
    {:else if filter === "rent"}
      {#if groups.length === 0}
        <p class="muted no-history">No payments recorded yet.</p>
      {:else}
        <ul class="history-list">
          {#each groups as g (g.receipt_no)}
            <HistoryRow row={{ kind: "rent", paidDate: g.paid_date, group: g }} onEdit={onEdit ? openEdit : undefined} onReceipt={onReceipt ? openReceipt : undefined} />
          {/each}
        </ul>
      {/if}
    {:else if filter === "amenity"}
      {#if amenityRows.length === 0}
        <p class="muted no-history">No amenity payments recorded.</p>
      {:else}
        <ul class="history-list">
          {#each amenityRows as payment (payment.id)}
            <HistoryRow row={{ kind: "amenity", paidDate: payment.paid_date, payment }} />
          {/each}
        </ul>
      {/if}
    {:else if merged.length === 0}
      <p class="muted no-history">No payments recorded yet.</p>
    {:else}
      <ul class="history-list">
        {#each merged as row (row.kind === "rent" ? `rent-${row.group.receipt_no}` : `amenity-${row.payment.id}`)}
          <HistoryRow row={row} onEdit={onEdit ? openEdit : undefined} onReceipt={onReceipt ? openReceipt : undefined} />
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
    gap: var(--space-3);
    background: var(--accent-soft);
    border: 1px solid rgba(10, 132, 255, 0.25);
    border-radius: var(--radius-control);
    padding: 10px 12px;
  }

  .held-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .held-amount {
    display: inline-flex;
    align-items: center;
    gap: 5px;
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

  .history-filters {
    margin-bottom: 0;
  }
</style>
