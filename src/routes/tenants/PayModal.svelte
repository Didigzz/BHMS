<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { addMonths } from "$lib/payment-status";
  import { formatDate, phpPesoPrecise } from "$lib/format";
  import { heldBalanceOf } from "$lib/held-balance";
  import { pushOverlay } from "$lib/back-stack";
  import type { Room, Tenant } from "./types";

  const PAYMENT_METHODS = ["Cash", "GCash", "Maya", "Bank transfer", "Other"] as const;

  function todayIso(): string {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }

  let {
    tenant,
    rooms,
    onConfirm,
    onApplyBalance,
    onClose,
  }: {
    tenant: Tenant;
    rooms: Room[];
    onConfirm: (
      t: Tenant,
      amount: number,
      method: string,
      paidDate: string,
      coveredDueDate: string,
      nextDueDate: string
    ) => Promise<string | null>;
    /** When provided, the modal offers "Apply held balance" (opens the apply flow). */
    onApplyBalance?: (t: Tenant) => void;
    onClose: () => void;
  } = $props();

  function rateOf(t: Tenant): number {
    // Per-tenant rate (snapshot at move-in) takes precedence; legacy tenants
    // without one fall back to the room's current rate.
    return t.monthly_rate ?? rooms.find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
  }

  // Payment date = when money was actually received (defaults to today, editable).
  let paidDate = $state(todayIso());
  // Due date being paid = the specific due date this payment settles. Defaults
  // to the tenant's current next due date — the overdue period settles first.
  let coveredDueDate = $state(tenant.due_date);
  // Next due date = the tenant's new stored due date (landlord-managed). This
  // is also the manual lever to fix a "super overdue" tenant.
  let nextDueDate = $state(addMonths(tenant.due_date, 1));
  let method = $state<string>(PAYMENT_METHODS[0]);
  let saving = $state(false);
  let error: string | null = $state(null);

  // Partial payments are not allowed — the amount is locked to one month's
  // rate (payment-due-date-spec.md §6.2).
  const amount = $derived(rateOf(tenant));
  // Next due follows the covered due date (+1 month) unless the landlord
  // edits it manually.
  $effect(() => {
    nextDueDate = addMonths(coveredDueDate, 1);
  });
  // Held balance available for this tenant (shown as an alternative to cash).
  const held = $derived(heldBalanceOf(tenant));

  // All three dates required; the next due must come after the covered one.
  const datesValid = $derived(
    !!paidDate && !!coveredDueDate && !!nextDueDate && nextDueDate > coveredDueDate
  );

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

  async function confirm() {
    if (!datesValid) {
      error = "Payment date, due date being paid, and next due date are all required (next due must be after the covered due date).";
      return;
    }
    saving = true;
    error = null;
    try {
      const err = await onConfirm(tenant, amount, method, paidDate, coveredDueDate, nextDueDate);
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

<div class="modal" role="dialog" aria-label="Record payment" transition:modalMaterial>
  <div class="pay-panel">
    <h2>Record Payment</h2>
    <p class="history-subtitle">{tenant.name} · {tenant.room_number}</p>

    <label>
      Payment date
      <input type="date" bind:value={paidDate} />
    </label>

    <label>
      Due date being paid
      <input type="date" bind:value={coveredDueDate} />
    </label>

    <label>
      Next due date
      <input type="date" bind:value={nextDueDate} />
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
        Full payment for due date {formatDate(coveredDueDate)} · next due {formatDate(nextDueDate)}
      </span>
    </div>

    {#if error}
      <p class="form-error">{error}</p>
    {/if}

    {#if onApplyBalance && held > 0}
      <button type="button" class="btn btn-small" onclick={() => onApplyBalance(tenant)} disabled={saving}>
        Apply held balance ({phpPesoPrecise(held)})
      </button>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={close} disabled={saving}>Cancel</button>
      <button type="button" class="btn btn-paid" onclick={confirm} disabled={saving || !datesValid}>
        {saving ? "Saving…" : "Record Payment"}
      </button>
    </div>
  </div>
</div>

<style>
  /* ---- record payment ---- */
  .pay-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .pay-panel h2 {
    margin: 0;
    font-size: 1.2rem;
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