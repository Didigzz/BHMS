<script lang="ts">
  import { modalMaterial } from "$lib/motion";
  import { addMonths } from "$lib/payment-status";
  import { formatDate, phpPesoPrecise } from "$lib/format";
  import type { Room, Tenant } from "./types";

  const PAYMENT_METHODS = ["Cash", "GCash", "Maya", "Bank transfer", "Other"] as const;

  let {
    tenant,
    rooms,
    onConfirm,
    onClose,
  }: {
    tenant: Tenant;
    rooms: Room[];
    onConfirm: (t: Tenant, amount: number, months: number, method: string) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  function rateOf(t: Tenant): number {
    // Per-tenant rate (snapshot at move-in) takes precedence; legacy tenants
    // without one fall back to the room's current rate.
    return t.monthly_rate ?? rooms.find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
  }

  let months = $state(1);
  let method = $state<string>(PAYMENT_METHODS[0]);
  let saving = $state(false);
  let error: string | null = $state(null);

  // Total amount owed for the chosen months (rate × months). Partial payments
  // are not allowed — the amount is locked to the full rent for the months
  // being paid (billing-features-spec.md §3).
  const amount = $derived(rateOf(tenant) * months);
  // Due date jumps forward the chosen number of months.
  const newDue = $derived(addMonths(tenant.due_date, months));

  function changeMonths(delta: number) {
    months = Math.max(1, months + delta);
  }

  function close() {
    if (saving) return;
    onClose();
  }

  async function confirm() {
    saving = true;
    error = null;
    try {
      const err = await onConfirm(tenant, amount, months, method);
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

<div class="modal" role="dialog" aria-label="Mark as paid" transition:modalMaterial>
  <div class="pay-panel">
    <h2>Mark as Paid</h2>
    <p class="history-subtitle">{tenant.name} · {tenant.room_number}</p>

    <label>
      Months being paid
      <div class="month-stepper">
        <button type="button" class="btn btn-small" onclick={() => changeMonths(-1)} disabled={months <= 1}>−</button>
        <span class="month-count">{months} month{months === 1 ? "" : "s"}</span>
        <button type="button" class="btn btn-small" onclick={() => changeMonths(1)}>+</button>
      </div>
    </label>

    <label>
      Payment method
      <select bind:value={method}>
        {#each PAYMENT_METHODS as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </select>
    </label>

    <div class="amount-block" aria-label="Amount to collect">
      <span class="amount-value">{phpPesoPrecise(amount)}</span>
      <span class="amount-sub">
        Full payment for {months} month{months === 1 ? "" : "s"} · new due {formatDate(newDue)}
      </span>
    </div>

    {#if error}
      <p class="form-error">{error}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={close} disabled={saving}>Cancel</button>
      <button type="button" class="btn btn-paid" onclick={confirm} disabled={saving}>
        {saving ? "Saving…" : "Confirm Payment"}
      </button>
    </div>
  </div>
</div>

<style>
  /* ---- mark as paid ---- */
  .pay-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
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

  .pay-panel select {
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .pay-panel select:focus {
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
