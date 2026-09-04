<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { getDb } from "$lib/db";
  import { formatDate, phpPesoPrecise } from "$lib/format";
  import { heldBalanceOf, validateApply } from "$lib/held-balance";
  import { pushOverlay } from "$lib/back-stack";
  import type { Room, Tenant } from "./types";

  let {
    tenant,
    rooms,
    onApply,
    onClose,
  }: {
    tenant: Tenant;
    rooms: Room[];
    onApply: (t: Tenant, coveredDueDate: string) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  function rateOf(t: Tenant): number {
    // Per-tenant rate (snapshot at move-in) takes precedence; legacy tenants
    // without one fall back to the room's current rate.
    return t.monthly_rate ?? rooms.find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
  }

  // The tenant prop may be a stale snapshot (e.g. opened from Payment History
  // after an apply elsewhere), so the pots are re-fetched on mount. The modal
  // is mounted per-open via {#if}, so capturing the prop once is explicit.
  let advanceHeld = $state(untrack(() => tenant.advance_held ?? 0));
  let depositHeld = $state(untrack(() => tenant.deposit_held ?? 0));

  const balance = $derived(heldBalanceOf({ advance_held: advanceHeld, deposit_held: depositHeld }));
  const rate = $derived(rateOf(tenant));
  // Like cash payments, the application settles one specific due date. The
  // tenant's current due date is the sensible default (the overdue month is
  // covered first).
  let coveredDueDate = $state(tenant.due_date);
  let saving = $state(false);
  let error: string | null = $state(null);

  const validation = $derived(
    validateApply({
      rate,
      coveredDueDate,
      dueDate: tenant.due_date,
      advanceHeld,
      depositHeld,
    })
  );
  // Whole months only: even one month must fit in the balance.
  const insufficient = $derived(balance < rate);

  async function refreshPots() {
    try {
      const db = await getDb();
      const rows = await db.select<{ advance_held: number; deposit_held: number }[]>(
        "SELECT advance_held, deposit_held FROM tenants WHERE id=$1",
        [tenant.id]
      );
      if (rows[0]) {
        advanceHeld = rows[0].advance_held;
        depositHeld = rows[0].deposit_held;
      }
    } catch {
      // Keep the prop values — the DB is unreachable, the modal still works
      // for display and the apply will surface any mismatch as an error.
    }
  }

  function close() {
    if (saving) return;
    onClose();
  }

  // Android back button closes this modal (and only this modal) instead of
  // letting the WebView navigate its history. Pots are refreshed in the
  // background so the displayed balance is always current.
  onMount(() => {
    const unregister = pushOverlay(close);
    void refreshPots();
    return unregister;
  });

  async function apply() {
    if (saving || validation.error) return;
    saving = true;
    error = null;
    try {
      const err = await onApply(tenant, coveredDueDate);
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

<div class="modal" role="dialog" aria-label="Apply held balance" transition:modalMaterial>
  <div class="pay-panel">
    <h2>Apply Held Balance</h2>
    <p class="history-subtitle">{tenant.name} · {tenant.room_number}</p>

    <div class="balance-block" aria-label="Held balance">
      <span class="balance-value">{phpPesoPrecise(balance)} held</span>
      <span class="balance-sub">
        {#if advanceHeld > 0 && depositHeld > 0}
          {phpPesoPrecise(advanceHeld)} advance · {phpPesoPrecise(depositHeld)} deposit
        {:else if advanceHeld > 0}
          {phpPesoPrecise(advanceHeld)} advance — used before any deposit
        {:else if depositHeld > 0}
          {phpPesoPrecise(depositHeld)} deposit
        {:else}
          No balance to apply
        {/if}
      </span>
    </div>

    <label>
      Due date being covered
      <input type="date" bind:value={coveredDueDate} />
    </label>

    <div class="amount-block" aria-label="Amount to apply">
      <span class="amount-value">{phpPesoPrecise(validation.amount)}</span>
      <span class="amount-sub">
        Full month for due date {formatDate(coveredDueDate)}
        {#if validation.newDue}
          · new due {formatDate(validation.newDue)}
        {:else if validation.error === null}
          · due date unchanged
        {/if}
      </span>
    </div>

    {#if insufficient && validation.error}
      <p class="form-error">{validation.error}</p>
    {:else if error}
      <p class="form-error">{error}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={close} disabled={saving}>Cancel</button>
      <button
        type="button"
        class="btn btn-paid"
        onclick={apply}
        disabled={saving || validation.error !== null}
      >
        {saving ? "Applying…" : "Apply Balance"}
      </button>
    </div>
  </div>
</div>

<style>
  /* ---- apply held balance ---- */
  .pay-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .pay-panel h2 {
    margin: 0;
    font-size: 1.2rem;
  }

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

  .pay-panel input[type="date"]:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }

  /* ---- held balance ---- */
  .balance-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--accent-soft);
    border: 1px solid rgba(10, 132, 255, 0.25);
    border-radius: 10px;
    padding: 12px 14px;
  }

  .balance-value {
    font-size: 1.2rem;
    font-weight: 800;
    color: var(--accent-deep);
  }

  .balance-sub {
    font-size: 0.82rem;
    color: var(--label-2);
  }

  /* ---- locked full-month amount ---- */
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