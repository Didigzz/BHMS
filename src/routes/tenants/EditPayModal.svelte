<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { formatDate, isDueDatePayment, phpPesoPrecise } from "$lib/format";
  import { pushOverlay } from "$lib/back-stack";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import type { PaymentEditOptions } from "$lib/tenant-actions";
  import type { PaymentRecord, Room, Tenant } from "./types";

  const METHOD_OPTIONS = ["Cash", "GCash", "Maya", "Bank transfer", "Other", "—"] as const;

  let {
    tenant,
    rooms,
    rows,
    onSave,
    onClose,
  }: {
    tenant: Tenant;
    rooms: Room[];
    /** The transaction being edited (all rows sharing one receipt number). */
    rows: PaymentRecord[];
    onSave: (opts: PaymentEditOptions) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  function rateOf(t: Tenant): number {
    // Per-tenant rate (snapshot at move-in) takes precedence; legacy tenants
    // without one fall back to the room's current rate.
    return t.monthly_rate ?? rooms.find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
  }

  const receiptNo = rows[0]?.receipt_no ?? "";
  const currentMethod = rows[0]?.method ?? "";
  const currentPaidDate = rows[0]?.paid_date ?? "";
  // New-style receipts are a single row whose due_date IS the covered due
  // date; legacy multi-month receipts keep the months-based editor.
  const singleDueDate = rows.length === 1 && isDueDatePayment(rows[0]);
  const currentCoveredDue = rows[0]?.due_date ?? tenant.due_date;

  let method = $state<string>(
    METHOD_OPTIONS.find((m) => m.toLowerCase() === currentMethod.toLowerCase()) ?? "Cash"
  );
  let paidDate = $state(currentPaidDate);
  let coveredDueDate = $state(currentCoveredDue);
  let months = $state(Math.max(1, rows.length));
  let saving = $state(false);
  let error: string | null = $state(null);
  let confirming = $state(false);

  // Partial payments are not allowed — the amount is locked to one month's
  // rate per covered month (billing-features-spec.md §3).
  const amount = $derived(rateOf(tenant) * (singleDueDate ? 1 : months));
  const formValid = $derived(singleDueDate ? !!paidDate && !!coveredDueDate : months >= 1 && !!paidDate);

  function changeMonths(delta: number) {
    months = Math.max(1, months + delta);
  }

  function close() {
    if (saving) return;
    onClose();
  }

  // Android back button closes this modal (and only this modal) instead of
  // letting the WebView navigate its history.
  onMount(() => {
    const unregister = pushOverlay(close);
    return unregister;
  });

  /** ConfirmModal approved — apply the edit. The host shows the corrected receipt. */
  async function apply() {
    confirming = false;
    saving = true;
    error = null;
    try {
      const opts: PaymentEditOptions = singleDueDate
        ? { method, paidDate, coveredDueDate }
        : { method, paidDate, months };
      const err = await onSave(opts);
      if (err) {
        error = err;
      } else {
        onClose();
      }
    } finally {
      saving = false;
    }
  }
</script>

<div class="modal" role="dialog" aria-label="Edit payment" transition:modalMaterial>
  <div class="pay-panel">
    <h2>Edit Payment</h2>
    <p class="history-subtitle">{tenant.name} · {tenant.room_number} · {receiptNo}</p>

    {#if singleDueDate}
      <label>
        Paid date
        <input type="date" bind:value={paidDate} />
      </label>

      <label>
        Due date being paid
        <input type="date" bind:value={coveredDueDate} />
      </label>
    {:else}
      <label>
        Months being paid
        <div class="month-stepper">
          <button type="button" class="btn btn-small" onclick={() => changeMonths(-1)} disabled={months <= 1}>−</button>
          <span class="month-count">{months} month{months === 1 ? "" : "s"}</span>
          <button type="button" class="btn btn-small" onclick={() => changeMonths(1)}>+</button>
        </div>
      </label>

      <label>
        Paid date
        <input type="date" bind:value={paidDate} />
      </label>
    {/if}

    <label>
      Payment method
      <select bind:value={method}>
        {#each METHOD_OPTIONS as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </select>
    </label>

    <div class="amount-block" aria-label="Amount to collect">
      <span class="amount-value">{phpPesoPrecise(amount)}</span>
      <span class="amount-sub">
        {#if singleDueDate}
          Full payment for due date {formatDate(coveredDueDate)}
        {:else}
          Full payment for {months} month{months === 1 ? "" : "s"}
        {/if}
      </span>
    </div>

    {#if error}
      <p class="form-error">{error}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={close} disabled={saving}>Cancel</button>
      <button
        type="button"
        class="btn btn-paid"
        onclick={() => (confirming = true)}
        disabled={saving || !formValid}
      >
        Save Changes
      </button>
    </div>
  </div>
</div>

{#if confirming}
  <ConfirmModal
    title="Apply Payment Changes"
    message={`Update receipt ${receiptNo} with the corrected details? The tenant's last-paid date will be recalculated from their payments; their due date is left as-is.`}
    confirmLabel="Apply Changes"
    busyLabel="Saving…"
    onConfirm={apply}
    onClose={() => (confirming = false)}
  />
{/if}

<style>
  /* ---- edit payment ---- */
  .pay-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .pay-panel h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  .month-stepper {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
  }

  .month-count {
    font-size: 1.05rem;
    font-weight: 700;
    min-width: 90px;
    text-align: center;
  }

  .pay-panel select,
  .pay-panel input[type="date"] {
    width: 100%;
    box-sizing: border-box;
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .pay-panel select:focus,
  .pay-panel input[type="date"]:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }

  /* ---- locked full-payment amount ---- */
  .amount-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--fill);
    border: 1px solid var(--separator);
    border-radius: 10px;
    padding: 12px 14px;
  }

  .amount-value {
    font-size: 1.35rem;
    font-weight: 800;
    color: var(--label);
  }

  .amount-sub {
    font-size: 0.82rem;
    color: var(--label-2);
  }
</style>