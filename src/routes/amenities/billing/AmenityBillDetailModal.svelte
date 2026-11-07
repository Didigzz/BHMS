<script lang="ts">
  import { phpPesoPrecise, formatDate } from "$lib/format";
  import { round2 } from "$lib/amenity-billing";
  import { modalMaterial } from "$lib/motion";
  import type { AmenityBillRow, AmenityBillTenantRow, AmenityBillRoomRow } from "$lib/amenity-actions";

  let {
    bill,
    tenants,
    rooms,
    onClose,
    onEdit,
  }: {
    bill: AmenityBillRow;
    tenants: AmenityBillTenantRow[];
    rooms: AmenityBillRoomRow[];
    onClose: () => void;
    onEdit: () => void;
  } = $props();

  const tenantTotal = $derived(
    round2(tenants.reduce((sum, row) => round2(sum + row.amount), 0)),
  );
  /** Centavos no tenant is charged because the shares floor to 2dp (spec §8.1). */
  const absorbed = $derived(tenantTotal > 0 ? round2(bill.total_amount - tenantTotal) : 0);

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
      <p><strong>Division:</strong> {bill.division_mode}</p>
      {#if bill.status === "cancelled"}<span class="badge badge-cancelled">Cancelled</span>{/if}
      {#if bill.meter_start != null}<p class="muted">Meter {bill.meter_start} → {bill.meter_end} @ {bill.price_per_unit}/unit</p>{/if}
    </div>

    <h3>Tenants</h3>
    <ul class="tenant-list">
      {#each tenants as t}
        <li class:excluded={t.is_excluded} class="tenant-row">
          <span>{t.tenant_name_snapshot} — {t.room_number_snapshot}</span>
          {#if t.is_excluded}<span class="badge badge-inactive">Inactive/Excluded</span>{/if}
          <span class="amount">{phpPesoPrecise(t.amount)}</span>
          <span class="status-badge" class:paid={t.payment_status === "Paid"}>{t.payment_status}</span>
          {#if t.exclusion_reason}<span class="muted">Reason: {t.exclusion_reason}</span>{/if}
        </li>
      {/each}
    </ul>

    <div class="form-actions">
      <button class="btn" onclick={onClose}>Close</button>
      {#if bill.status !== "cancelled"}
        <button class="btn btn-primary" onclick={onEdit}>Edit</button>
      {/if}
    </div>
  </div>
</div>

<style>
  /* dvh (not vh) so the card measures the visible viewport — the .modal overlay
     above it now carries the system-bar insets. */
  .modal-card { background: var(--card); border-radius: 16px; padding: 20px; max-width: 560px; width: 100%; max-height: 90vh; max-height: 90dvh; overflow-y: auto; }
  .card { background: var(--fill); border: 1px solid var(--separator); border-radius: 10px; padding: 12px; margin: 12px 0; }
  .tenant-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .tenant-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px; border: 1px solid var(--separator); border-radius: 8px; }
  .tenant-row.excluded { background: var(--gray-soft); color: var(--gray-deep); }
  .badge-inactive { background: var(--gray-soft); color: var(--gray-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; }
  .badge-cancelled { background: var(--gray-soft); color: var(--gray-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
  .amount { font-weight: 700; margin-left: auto; }
  .status-badge { padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; background: var(--amber-soft); color: var(--amber-deep); }
  .status-badge.paid { background: var(--green-soft); color: var(--green-deep); }
</style>
