<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db/db";
  import {
    cancelAmenityBill,
    getAmenityBills,
    getBillWithDetails,
    getPaidTenantNames,
    type AmenityBillRow,
    type AmenityBillTenantRow,
  } from "$lib/amenities/amenity-actions";
  import { summaryLabel, todayIso } from "$lib/amenities/amenity-payments";
  import AmenityPaymentSheet from "$lib/amenities/AmenityPaymentSheet.svelte";
  import type { AmenityBillRoomRow } from "$lib/amenities/amenity-actions";
  import { phpPesoPrecise, formatDate } from "$lib/ui/format";
  import { pushToast } from "$lib/ui/toast.svelte";
  import AmenityBillFormModal from "./AmenityBillFormModal.svelte";
  import AmenityBillDetailModal from "./AmenityBillDetailModal.svelte";
  import BillTenantChips from "./BillTenantChips.svelte";
  import {
    editLocked,
    methodLabel,
    summaryFor,
    unpaidOn,
    unpaidTotal,
    type BillSheetState,
  } from "./bill-summaries";
  import { createPaymentSheet } from "./bill-payments";
  import ConfirmModal from "$lib/ui/ConfirmModal.svelte";
  import SkeletonList from "$lib/ui/SkeletonList.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import Plus from "@lucide/svelte/icons/plus";

  interface BillDetails {
    bill: AmenityBillRow;
    tenants: AmenityBillTenantRow[];
    rooms: AmenityBillRoomRow[];
  }

  let bills: AmenityBillRow[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let segment: "active" | "cancelled" | "all" = $state("active");

  let formOpen = $state(false);
  let editingBill: AmenityBillRow | null = $state(null);
  let detailData: BillDetails | null = $state(null);
  let pendingCancel: AmenityBillRow | null = $state(null);
  /** Tenants with recorded money on the bill being cancelled — named in the confirm (spec §11). */
  let paidOnCancel: string[] = $state([]);

  let billDetailsCache: Map<number, BillDetails> = $state(new Map());

  let sheet: BillSheetState | null = $state(null);
  let sheetError: string | null = $state(null);

  async function loadBills() {
    try {
      const db = await getDb();
      bills = await getAmenityBills(db, null);
      const cache = new Map<number, BillDetails>();
      for (const b of bills) {
        const d = await getBillWithDetails(db, b.id);
        if (d) cache.set(b.id, d as BillDetails);
      }
      billDetailsCache = cache;
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
    if (d) detailData = d as BillDetails;
  }

  async function requestCancel(bill: AmenityBillRow) {
    try {
      const db = await getDb();
      paidOnCancel = await getPaidTenantNames(db, bill.id);
    } catch {
      paidOnCancel = [];
    }
    pendingCancel = bill;
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

  // -------------------------------------------------------------------------
  // cached shares (the pure summaries live in bill-summaries.ts)
  // -------------------------------------------------------------------------

  /** Replace one cached share row in both the card cache and an open modal. */
  function setRowLocally(
    billId: number,
    shareId: number,
    patch: Partial<AmenityBillTenantRow>,
  ) {
    const cached = billDetailsCache.get(billId);
    if (cached) {
      const row = cached.tenants.find((t) => t.id === shareId);
      if (row) Object.assign(row, patch);
      billDetailsCache = new Map(billDetailsCache);
    }
    if (detailData && detailData.bill.id === billId) {
      const row = detailData.tenants.find((t) => t.id === shareId);
      if (row) Object.assign(row, patch);
      detailData = { ...detailData };
    }
  }

  async function refreshBill(billId: number) {
    const db = await getDb();
    const fresh = await getBillWithDetails(db, billId);
    if (!fresh) return;
    billDetailsCache.set(billId, fresh as BillDetails);
    billDetailsCache = new Map(billDetailsCache);
    if (detailData && detailData.bill.id === billId) detailData = { ...(fresh as BillDetails) };
  }

  /** Bulk-payment sheet reads the live counts for its header. */
  function unpaidCountFor(billId: number): number {
    return unpaidOn(billDetailsCache.get(billId)).length;
  }

  function unpaidTotalFor(billId: number): number {
    return unpaidTotal(billDetailsCache.get(billId));
  }

  // -------------------------------------------------------------------------
  // payment sheet
  // -------------------------------------------------------------------------

  function openRecord(bill: AmenityBillRow, row: AmenityBillTenantRow) {
    sheetError = null;
    sheet = { mode: "record", bill, row };
  }

  function openVoid(bill: AmenityBillRow, row: AmenityBillTenantRow) {
    sheetError = null;
    sheet = { mode: "void", bill, row };
  }

  function openDate(bill: AmenityBillRow, row: AmenityBillTenantRow) {
    sheetError = null;
    sheet = { mode: "date", bill, row };
  }

  function openBulk(bill: AmenityBillRow) {
    sheetError = null;
    sheet = { mode: "bulk", bill };
  }

  function closeSheet() {
    sheet = null;
    sheetError = null;
  }

  // The four sheet confirmations (record / bulk / void / re-date) live in
  // bill-payments.ts; the page supplies the cache and the optimistic patch.
  const payments = createPaymentSheet({
    get: () => sheet,
    clear: () => (sheet = null),
    setError: (message) => (sheetError = message),
    setRow: setRowLocally,
    refresh: refreshBill,
    toast: (message) => pushToast(message, "success"),
  });
</script>

<main>
  <header class="page-header with-action">
    <div>
      <p class="eyebrow">Utilities</p>
      <h1>Amenity billing</h1>
      <p class="subtitle">{filteredBills.length} bill{filteredBills.length === 1 ? "" : "s"} shown</p>
    </div>
    <button class="btn btn-primary btn-icon" onclick={openAdd} aria-label="Add new bill" title="Add new bill">
      <Icon icon={Plus} size={24} />
    </button>
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
    <AmenityBillDetailModal
      bill={detailData.bill}
      tenants={detailData.tenants}
      rooms={detailData.rooms}
      locked={editLocked(detailData)}
      onClose={() => detailData = null}
      onEdit={() => { const b = detailData!.bill; detailData = null; openEdit(b); }}
      onVoid={(row) => openVoid(detailData!.bill, row)}
      onEditDate={(row) => openDate(detailData!.bill, row)}
    />
  {/if}

  {#if sheet}
    <AmenityPaymentSheet
      mode={sheet.mode}
      tenantName={sheet.mode === "bulk" ? "" : sheet.row.tenant_name_snapshot}
      roomNumber={sheet.mode === "bulk" ? "" : sheet.row.room_number_snapshot}
      amenityName={sheet.bill.amenity_name}
      billingPeriod={sheet.bill.billing_period}
      amount={sheet.mode === "bulk" ? null : sheet.row.amount}
      unpaidCount={sheet.mode === "bulk" ? unpaidCountFor(sheet.bill.id) : 0}
      unpaidTotal={sheet.mode === "bulk" ? unpaidTotalFor(sheet.bill.id) : 0}
      paidDate={sheet.mode === "record" || sheet.mode === "bulk"
        ? todayIso()
        : (sheet.row.paid_date ?? "")}
      error={sheetError}
      onConfirm={payments.confirm}
      onClose={closeSheet}
    />
  {/if}

  {#if pendingCancel}
    <ConfirmModal
      title="Cancel Amenity Bill"
      message={`Cancel ${pendingCancel.amenity_name} — ${phpPesoPrecise(pendingCancel.total_amount)}? This marks it as Cancelled, keeps it in history, and removes its charges from Amenity Balances.${paidOnCancel.length > 0 ? ` Already marked Paid: ${paidOnCancel.join(", ")} — their payments are reversed and the charges removed.` : ""}`}
      confirmLabel="Cancel Bill"
      danger
      onConfirm={confirmCancel}
      onClose={() => { pendingCancel = null; paidOnCancel = []; }}
    />
  {/if}

  {#if loading}
    <SkeletonList count={3} />
  {:else if filteredBills.length === 0}
    <div class="card empty">
      <p class="muted">No amenity bills yet. Add one to charge tenants for shared or room-specific amenities.</p>
      <button class="btn btn-primary" onclick={openAdd}>+ Add New Bill</button>
    </div>
  {:else}
    <ul class="list-stack">
      {#each filteredBills as bill (bill.id)}
        {@const details = billDetailsCache.get(bill.id)}
        {@const summary = summaryFor(details)}
        {@const locked = editLocked(details)}
        <li class="card bill-card" class:cancelled={bill.status === "cancelled"}>
          <div class="bill-head">
            <strong class="bill-name" title={bill.amenity_name}>{bill.amenity_name}</strong>
            {#if bill.status === "cancelled"}<span class="badge badge-cancelled">Cancelled</span>{/if}
            <span class="badge badge-method" title={methodLabel(bill)}>{methodLabel(bill)}</span>
          </div>
          {#if details?.rooms?.length}
            <p class="muted">Rooms: {details.rooms.map((r) => r.room_number_snapshot).join(", ")}</p>
          {/if}
          <p class="muted">{formatDate(bill.billing_date)}{bill.billing_period ? ` — ${bill.billing_period}` : ""} · {phpPesoPrecise(bill.total_amount)}</p>
          {#if bill.notes}<p class="note">{bill.notes}</p>{/if}
          {#if details && bill.status !== "cancelled"}
            <p class="bill-summary">{summaryLabel(summary, phpPesoPrecise)}</p>
          {/if}
          {#if details}
            <BillTenantChips
              {bill}
              tenants={details.tenants}
              onRecord={(t) => openRecord(bill, t)}
              onVoid={(t) => openVoid(bill, t)}
            />
          {/if}
          <div class="bill-actions">
            <button class="btn btn-small" onclick={() => openDetails(bill)}>View Details</button>
            {#if bill.status === "active"}
              <button
                class="btn btn-small"
                disabled={locked}
                title={locked ? "Payments recorded — void them before editing." : undefined}
                onclick={() => openEdit(bill)}
              >Edit</button>
              {#if summary.payableCount > summary.paidCount}
                <button class="btn btn-small" onclick={() => openBulk(bill)}>Mark all paid</button>
              {/if}
              <button class="btn btn-small btn-danger" onclick={() => requestCancel(bill)}>Cancel Bill</button>
            {/if}
          </div>
          {#if bill.status === "active" && locked}
            <p class="muted lock-note">Payments recorded — void them before editing.</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .bill-card.cancelled { opacity: 0.7; background: var(--gray-soft); }
  .bill-head { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
  .bill-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge-method { flex: 0 1 auto; min-width: 0; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--accent-soft); color: var(--accent-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.01em; }
  .badge-cancelled { flex-shrink: 0; background: var(--gray-soft); color: var(--gray-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
  .badge-inactive, .badge-cancelled { letter-spacing: 0.01em; }
  .bill-actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); flex-wrap: wrap; }
  .bill-actions .btn:disabled { opacity: 0.45; }
  .bill-summary { margin: var(--space-2) 0 0; font-size: 0.82rem; font-weight: 600; color: var(--label-2); }
  .lock-note { margin: var(--space-1) 0 0; font-size: 0.78rem; }
</style>
