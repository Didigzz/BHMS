<script lang="ts">
  import { phpPesoPrecise, formatDate } from "$lib/ui/format";
  import { round2 } from "$lib/amenities/amenity-billing";
  import { summarizeBillPayments, summaryLabel } from "$lib/amenities/amenity-payments";
  import { modalMaterial } from "$lib/ui/motion";
  import type { AmenityBillRow, AmenityBillTenantRow, AmenityBillRoomRow } from "$lib/amenities/amenity-actions";

  let {
    bill,
    tenants,
    rooms,
    locked = false,
    onClose,
    onEdit,
    onVoid,
    onEditDate,
  }: {
    bill: AmenityBillRow;
    tenants: AmenityBillTenantRow[];
    rooms: AmenityBillRoomRow[];
    locked?: boolean;
    onClose: () => void;
    onEdit: () => void;
    onVoid: (row: AmenityBillTenantRow) => void;
    onEditDate: (row: AmenityBillTenantRow) => void;
  } = $props();

  const tenantTotal = $derived(
    round2(tenants.reduce((sum, row) => round2(sum + row.amount), 0)),
  );
  /** Centavos no tenant is charged because the shares floor to 2dp (spec §8.1). */
  const absorbed = $derived(tenantTotal > 0 ? round2(bill.total_amount - tenantTotal) : 0);

  const customCount = $derived(tenants.filter((t) => t.is_manual === 1).length);

  const summary = $derived(
    summarizeBillPayments(
      tenants,
      tenants
        .filter((t) => t.payment_id != null)
        .map((t) => ({ bill_tenant_id: t.id, amount: t.amount, status: "active" })),
    ),
  );

  const methodLabel = $derived(
    bill.billing_method === "shared" ? "Shared Billing" : bill.billing_method === "per_room" ? "Per-Room Billing — Room-Specific Amenity" : "Connected Rooms — Joint Room Billing",
  );
</script>

<div class="modal" role="dialog" aria-label="Amenity Bill Details" onclick={onClose}>
  <div class="modal-card" onclick={(e) => e.stopPropagation()} transition:modalMaterial>
    <h2>{bill.amenity_name}</h2>
    <p class="muted">{methodLabel}</p>
    <div class="card">
      <p><strong>Billing Date:</strong> {formatDate(bill.billing_date)}</p>
      {#if bill.billing_period}<p><strong>Period:</strong> {bill.billing_period}</p>{/if}
      <p><strong>Total:</strong> {phpPesoPrecise(bill.total_amount)}</p>
      {#if bill.notes}<p><strong>Notes:</strong> {bill.notes}</p>{/if}
      {#if rooms.length > 0}<p><strong>Rooms:</strong> {rooms.map((r) => r.room_number_snapshot).join(", ")}</p>{/if}
      {#if absorbed > 0}
        <p><strong>Landlord absorbs:</strong> {phpPesoPrecise(absorbed)}</p>
      {/if}
      <p><strong>Division:</strong> {bill.division_mode}{#if customCount > 0} · {customCount} custom{/if}</p>
      {#if bill.status === "cancelled"}<span class="badge badge-cancelled">Cancelled</span>{/if}
      {#if bill.meter_start != null}<p class="muted">Meter {bill.meter_start} → {bill.meter_end} @ {bill.price_per_unit}/unit</p>{/if}
    </div>

    {#if bill.status !== "cancelled"}
      <p class="bill-summary">{summaryLabel(summary, phpPesoPrecise)}</p>
    {/if}

    <h3>Tenants</h3>
    <ul class="tenant-list">
      {#each tenants as t}
        <li class:excluded={t.is_excluded} class="tenant-row aligned-row">
          <div class="aligned-row__main">
            <span class="aligned-row__title" title={t.tenant_name_snapshot}>{t.tenant_name_snapshot}</span>
            <span class="aligned-row__sub">{t.room_number_snapshot}</span>
            {#if t.is_manual === 1 && !t.is_excluded}
              <span class="badge badge-custom pick-marker">Custom</span>
            {/if}
          </div>
          {#if t.is_excluded}
            <span class="aligned-row__amount muted">—</span>
            <span class="badge badge-inactive aligned-row__status">Excluded</span>
          {:else if t.amount === 0}
            <span class="badge badge-amenity aligned-row__amount">{phpPesoPrecise(t.amount)}</span>
            <span class="muted aligned-row__status">—</span>
          {:else}
            <span class="badge badge-amenity aligned-row__amount">{phpPesoPrecise(t.amount)}</span>
            {#if t.payment_status === "Paid" && t.paid_date}
              <span class="status-stack aligned-row__status">
                <span class="status-badge paid">Paid</span>
                <span class="status-date">{formatDate(t.paid_date)}</span>
              </span>
            {:else}
              <span class="status-badge aligned-row__status">{t.payment_status}</span>
            {/if}
          {/if}
          {#if t.exclusion_reason}
            <p class="muted aligned-row__note" title={t.exclusion_reason}>Reason: {t.exclusion_reason}</p>
          {/if}
          {#if bill.status === "active" && t.payment_status === "Paid" && t.payment_id != null}
            <div class="row-actions">
              <button class="btn btn-small" onclick={() => onEditDate(t)}>Edit date</button>
              <button class="btn btn-small btn-danger" onclick={() => onVoid(t)}>Void</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="form-actions">
      <button class="btn" onclick={onClose}>Close</button>
      {#if bill.status !== "cancelled" && !locked}
        <button class="btn btn-primary" onclick={onEdit}>Edit</button>
      {/if}
    </div>
  </div>
</div>

<style>
  /* dvh (not vh) so the card measures the visible viewport — the .modal overlay
     above it now carries the system-bar insets. */
  /* Surface, border, radius, and padding come from the shared `.modal > *`
     rules; this only widens the panel and lets long bills scroll. */
  .modal-card { max-width: 560px; width: 100%; max-height: 90vh; max-height: 90dvh; overflow-y: auto; }
  .card { background: var(--fill); border: 1px solid var(--separator); border-radius: var(--radius-control); padding: 12px; margin: 12px 0; }
  .bill-summary { margin: 0 0 var(--space-3); font-size: 0.85rem; font-weight: 600; color: var(--label-2); }
  .tenant-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .tenant-row { padding: 8px; border: 1px solid var(--separator); border-radius: 8px; }
  .tenant-row.excluded { background: var(--gray-soft); color: var(--gray-deep); }
  .badge-amenity { background: var(--fill); color: var(--label); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; }
  .badge-inactive { background: var(--gray-soft); color: var(--gray-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; }
  .badge-cancelled { background: var(--gray-soft); color: var(--gray-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
  .badge-custom { align-self: flex-start; margin-top: 2px; background: var(--accent-soft); color: var(--accent-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.01em; }
  .status-badge { padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; white-space: nowrap; background: var(--amber-soft); color: var(--amber-deep); }
  .status-badge.paid { background: var(--green-soft); color: var(--green-deep); }
  .status-stack { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .status-date { font-size: 0.62rem; color: var(--label-3); white-space: nowrap; }
  .row-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
  /* See the list: one font step down before the amount column can clip. */
  @media (max-width: 380px) {
    .badge-amenity { font-size: 0.65rem; }
  }
</style>
