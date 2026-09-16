<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db";
  import { getAmenityBills, getBillWithDetails, cancelAmenityBill, setAmenityPaymentStatus } from "$lib/amenity-actions";
  import type { AmenityBillRow } from "$lib/amenity-actions";
  import { phpPesoPrecise, formatDate } from "$lib/format";
  import { pushToast } from "$lib/toast.svelte";
  import AmenityBillFormModal from "./AmenityBillFormModal.svelte";
  import AmenityBillDetailModal from "./AmenityBillDetailModal.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";

  let bills: AmenityBillRow[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let segment: "active" | "cancelled" | "all" = $state("active");

  let formOpen = $state(false);
  let editingBill: AmenityBillRow | null = $state(null);
  let detailData: { bill: AmenityBillRow; tenants: any[]; rooms: any[] } | null = $state(null);
  let pendingCancel: AmenityBillRow | null = $state(null);

  let billDetailsCache: Map<number, any> = $state(new Map());

  async function loadBills() {
    try {
      const db = await getDb();
      bills = await getAmenityBills(db, null);
      for (const b of bills) {
        const d = await getBillWithDetails(db, b.id);
        if (d) billDetailsCache.set(b.id, d);
      }
      billDetailsCache = new Map(billDetailsCache);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadBills);

  let filteredBills = $derived.by(() => {
    if (segment === "active") return bills.filter((b) => b.status === "active");
    if (segment === "cancelled") return bills.filter((b) => b.status === "cancelled");
    return bills;
  });

  function openAdd() {
    editingBill = null;
    formOpen = true;
  }

  function openEdit(b: AmenityBillRow) {
    editingBill = b;
    formOpen = true;
  }

  async function openDetails(b: AmenityBillRow) {
    const db = await getDb();
    const d = await getBillWithDetails(db, b.id);
    if (d) detailData = d as any;
  }

  async function confirmCancel() {
    if (!pendingCancel) return;
    const db = await getDb();
    const res = await cancelAmenityBill(db, pendingCancel.id);
    if (res.error) {
      pushToast(res.error, "error");
    } else {
      pushToast("Bill cancelled", "success");
      pendingCancel = null;
      await loadBills();
    }
  }

  async function toggleStatus(billTenantId: number, current: string, billId: number) {
    const next = current === "Paid" ? "Unpaid" : "Paid";
    const db = await getDb();
    const res = await setAmenityPaymentStatus(db, billTenantId, next);
    if (res.error) pushToast(res.error, "error");
    else {
      const d = billDetailsCache.get(billId);
      if (d) {
        const t = d.tenants.find((x: any) => x.id === billTenantId);
        if (t) t.payment_status = next;
        billDetailsCache = new Map(billDetailsCache);
        if (detailData && detailData.bill.id === billId) {
          const td = detailData.tenants.find((x: any) => x.id === billTenantId);
          if (td) td.payment_status = next;
          detailData = { ...detailData };
        }
      }
    }
  }

  function methodLabel(b: AmenityBillRow): string {
    if (b.billing_method === "shared") return "Shared Billing";
    if (b.billing_method === "per_room") return "Per-Room Billing — Room-Specific Amenity";
    return "Connected Rooms — Joint Room Billing";
  }
</script>

<main>
  <header class="page-header">
    <div>
      <h1>Amenity Billing</h1>
      <p class="subtitle">{filteredBills.length} bill{filteredBills.length === 1 ? "" : "s"} shown</p>
    </div>
    <button class="btn btn-primary" onclick={openAdd}>+ Add New Bill</button>
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}

  <div class="segmented" role="tablist" aria-label="Bill status">
    <button class:active={segment === "active"} onclick={() => segment = "active"}>Active</button>
    <button class:active={segment === "cancelled"} onclick={() => segment = "cancelled"}>Cancelled</button>
    <button class:active={segment === "all"} onclick={() => segment = "all"}>All</button>
  </div>

  {#if formOpen}
    <AmenityBillFormModal editing={editingBill} onSaveDone={async () => { formOpen = false; loading = true; await loadBills(); }} onClose={() => formOpen = false} />
  {/if}

  {#if detailData}
    <AmenityBillDetailModal bill={detailData.bill} tenants={detailData.tenants} rooms={detailData.rooms} onClose={() => detailData = null} onEdit={() => { const b = detailData!.bill; detailData = null; openEdit(b); }} />
  {/if}

  {#if pendingCancel}
    <ConfirmModal title="Cancel Amenity Bill" message={`Cancel ${pendingCancel.amenity_name} — ${phpPesoPrecise(pendingCancel.total_amount)}? This marks it as Cancelled, keeps it in history, and removes its charges from Amenity Balances.`} confirmLabel="Cancel Bill" danger onConfirm={confirmCancel} onClose={() => pendingCancel = null} />
  {/if}

  {#if loading}
    <p class="muted">Loading bills…</p>
  {:else if filteredBills.length === 0}
    <div class="card empty">
      <p class="muted">No amenity bills yet. Add one to charge tenants for shared or room-specific amenities.</p>
      <button class="btn btn-primary" onclick={openAdd}>+ Add New Bill</button>
    </div>
  {:else}
    <ul class="bill-list">
      {#each filteredBills as bill (bill.id)}
        {@const details = billDetailsCache.get(bill.id)}
        <li class="card bill-card" class:cancelled={bill.status === "cancelled"}>
          <div class="bill-head">
            <div>
              <strong>{bill.amenity_name}</strong> <span class="muted">— {bill.amenity_type}</span>
              {#if bill.status === "cancelled"}<span class="badge badge-cancelled">Cancelled</span>{/if}
            </div>
            <span class="badge badge-method">{methodLabel(bill)}</span>
          </div>
          {#if details?.rooms?.length}
            <p class="muted">Rooms: {details.rooms.map((r: any) => r.room_number_snapshot).join(", ")}</p>
          {/if}
          <p class="muted">{formatDate(bill.billing_date)}{bill.billing_period ? ` — ${bill.billing_period}` : ""} · {phpPesoPrecise(bill.total_amount)}</p>
          {#if bill.notes}<p class="note">{bill.notes}</p>{/if}
          {#if details}
            <ul class="tenant-chips">
              {#each details.tenants as t}
                <li class="chip" class:excluded={t.is_excluded}>
                  <span>{t.tenant_name_snapshot} — {t.room_number_snapshot}</span>
                  {#if t.is_excluded}<span class="badge badge-inactive">Inactive/Excluded</span>{:else}<span class="badge badge-amenity">{phpPesoPrecise(t.amount)}</span>{/if}
                  <button class="btn btn-small status-toggle" class:paid={t.payment_status === "Paid"} onclick={() => toggleStatus(t.id, t.payment_status, bill.id)}>{t.payment_status}</button>
                  {#if t.exclusion_reason}<span class="muted">Reason: {t.exclusion_reason}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
          <div class="bill-actions">
            <button class="btn btn-small" onclick={() => openDetails(bill)}>View Details</button>
            {#if bill.status === "active"}
              <button class="btn btn-small" onclick={() => openEdit(bill)}>Edit</button>
              <button class="btn btn-small btn-danger" onclick={() => pendingCancel = bill}>Cancel Bill</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .page-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; padding-right: 44px; }
  .bill-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .bill-card.cancelled { opacity: 0.7; background: var(--gray-soft); }
  .bill-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap; }
  .badge-method { background: var(--accent-soft); color: var(--accent-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; }
  .badge-cancelled { background: var(--gray-soft); color: var(--gray-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
  .badge-amenity { background: var(--fill); color: var(--label); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; }
  .badge-inactive { background: var(--gray-soft); color: var(--gray-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.65rem; font-weight: 700; }
  .tenant-chips { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
  .chip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 8px; border: 1px solid var(--separator); border-radius: 8px; }
  .chip.excluded { background: var(--gray-soft); color: var(--gray-deep); }
  .status-toggle { padding: 2px 8px; font-size: 0.7rem; border-radius: 999px; background: var(--amber-soft); color: var(--amber-deep); border: none; }
  .status-toggle.paid { background: var(--green-soft); color: var(--green-deep); }
  .bill-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
</style>
