<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db/db";
  import {
    getPayments,
    updateAmenityPaymentDate,
    voidAmenityPayment,
    type AmenityPaymentRow,
  } from "$lib/amenities/amenity-payment-actions";
  import { sumActive, sumReversed } from "$lib/amenities/amenity-payments";
  import AmenityPaymentSheet from "$lib/amenities/AmenityPaymentSheet.svelte";
  import { formatDate, phpPesoPrecise } from "$lib/ui/format";
  import { pushToast } from "$lib/ui/toast.svelte";
  import SkeletonList from "$lib/ui/SkeletonList.svelte";

  let payments = $state<AmenityPaymentRow[]>([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  let sheet: { mode: "void" | "date"; row: AmenityPaymentRow } | null = $state(null);
  let sheetError: string | null = $state(null);

  const collected = $derived(sumActive(payments));
  const reversed = $derived(sumReversed(payments));

  async function load() {
    try {
      const db = await getDb();
      payments = await getPayments(db);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function open(mode: "void" | "date", row: AmenityPaymentRow) {
    sheetError = null;
    sheet = { mode, row };
  }

  async function confirmSheet(value: { paidDate?: string; note?: string }) {
    if (!sheet) return;
    const { mode, row } = sheet;
    const db = await getDb();
    const result =
      mode === "void"
        ? await voidAmenityPayment(db, row.id, value.note)
        : await updateAmenityPaymentDate(db, row.id, value.paidDate ?? "");
    if (result.error) {
      sheetError = result.error;
      return;
    }
    sheet = null;
    sheetError = null;
    pushToast(mode === "void" ? "Payment voided" : "Paid date updated", "success");
    await load();
  }

  function reversalTitle(row: AmenityPaymentRow): string {
    const parts = [row.reversal_reason || "Payment reversed"];
    if (row.reversed_at) parts.push(`on ${formatDate(row.reversed_at.slice(0, 10))}`);
    return parts.join(" ");
  }
</script>

<main>
  <header class="page-header">
    <div>
      <p class="eyebrow">Utilities</p>
      <h1>Amenities payments</h1>
      <p class="subtitle">{payments.length} payment{payments.length === 1 ? "" : "s"}</p>
    </div>
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}

  {#if !loading && !error}
    <div class="totals-strip">
      <span>Collected <strong>{phpPesoPrecise(collected)}</strong></span>
      <span class="muted">Reversed <strong>{phpPesoPrecise(reversed)}</strong></span>
    </div>
  {/if}

  {#if sheet}
    <AmenityPaymentSheet
      mode={sheet.mode}
      tenantName={sheet.row.tenant_name_snapshot}
      roomNumber={sheet.row.room_number_snapshot}
      amenityName={sheet.row.amenity_name}
      billingPeriod={sheet.row.billing_period}
      amount={sheet.row.amount}
      paidDate={sheet.row.paid_date}
      error={sheetError}
      onConfirm={confirmSheet}
      onClose={() => { sheet = null; sheetError = null; }}
    />
  {/if}

  {#if loading}
    <SkeletonList count={4} />
  {:else if payments.length === 0}
    <div class="card empty">
      <p class="muted">No amenity payments yet. Mark a share as paid on a bill to see it here.</p>
      <a class="btn btn-primary" href="/amenities/billing">Go to Billing</a>
    </div>
  {:else}
    <ul class="list-stack">
      {#each payments as row (row.id)}
        {@const isReversed = row.status === "reversed"}
        <li class="card payment-card" class:reversed={isReversed}>
          <div class="aligned-row">
            <div class="aligned-row__main">
              <span class="aligned-row__title" title={row.tenant_name_snapshot}>{row.tenant_name_snapshot}</span>
              <span class="aligned-row__sub">{row.room_number_snapshot}</span>
              <span class="aligned-row__sub">
                {row.amenity_name}{row.billing_period ? ` · ${row.billing_period}` : ""}
              </span>
            </div>
            <span class="aligned-row__amount payment-amount" class:struck={isReversed}>
              {phpPesoPrecise(row.amount)}
            </span>
            {#if isReversed}
              <span class="badge reversed-badge aligned-row__status" title={reversalTitle(row)}>Reversed</span>
            {:else}
              <span class="aligned-row__status payment-date">{formatDate(row.paid_date)}</span>
            {/if}
          </div>
          {#if !isReversed}
            <div class="payment-actions">
              <button class="btn btn-small" onclick={() => open("date", row)}>Edit date</button>
              <button class="btn btn-small btn-danger" onclick={() => open("void", row)}>Void</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .totals-strip {
    display: flex;
    gap: var(--space-4);
    justify-content: space-between;
    background: var(--fill);
    border: 1px solid var(--separator);
    border-radius: var(--radius-control);
    padding: 10px 12px;
    margin-bottom: var(--space-3);
    font-size: 0.85rem;
  }
  .payment-card.reversed {
    opacity: 0.72;
  }
  .payment-amount {
    font-weight: 700;
  }
  .payment-amount.struck {
    text-decoration: line-through;
    color: var(--label-3);
  }
  .payment-date {
    font-size: 0.78rem;
    color: var(--label-2);
    justify-self: end;
    white-space: nowrap;
  }
  .reversed-badge {
    background: var(--gray-soft);
    color: var(--gray-deep);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .payment-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
    justify-content: flex-end;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }
</style>
