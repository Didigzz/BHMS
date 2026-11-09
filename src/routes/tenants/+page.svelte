<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db/db";
  import { pushToast } from "$lib/ui/toast.svelte";
  import ApplyBalanceModal from "../../lib/tenants/ApplyBalanceModal.svelte";
  import TenantFormModal from "./TenantFormModal.svelte";
  import PayModal from "../../lib/tenants/PayModal.svelte";
  import EditPayModal from "../../lib/tenants/EditPayModal.svelte";
  import MoveOutModal from "../../lib/tenants/MoveOutModal.svelte";
  import DepositRefundModal from "../../lib/tenants/DepositRefundModal.svelte";
  import PaymentHistoryModal from "./PaymentHistoryModal.svelte";
  import ReceiptModal from "../../lib/tenants/ReceiptModal.svelte";
  import TenantCard from "./TenantCard.svelte";
  import TenantListToolbar from "./TenantListToolbar.svelte";
  import { createTenantListFilters } from "$lib/tenants/tenant-list-filters.svelte";
  import { createTenantPageFlows } from "$lib/tenants/tenant-page-flows";
  import TenantDetailModal from "./TenantDetailModal.svelte";
  import ConfirmModal from "$lib/ui/ConfirmModal.svelte";
  import SkeletonList from "$lib/ui/SkeletonList.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import Plus from "@lucide/svelte/icons/plus";
  import type { PaymentRecord, Room, Tenant } from "../../lib/tenants/types";

  let tenants: Tenant[] = $state([]);
  let rooms: Room[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let view: "active" | "archived" = $state("active");
  // Accordion: which tenant's "More options" grid is open (null = all collapsed).
  let moreOptionsId: number | null = $state(null);

  function toggleMoreOptions(t: Tenant) {
    moreOptionsId = moreOptionsId === t.id ? null : t.id;
  }

  /** Open the tenant details modal; collapse any open More options grid first. */
  function openDetails(t: Tenant) {
    moreOptionsId = null;
    detailTarget = t;
  }

  const activeTenants = $derived(tenants.filter((t) => !t.moved_out_date));
  const archivedTenants = $derived(tenants.filter((t) => !!t.moved_out_date));

  const filters = createTenantListFilters({
    getActive: () => activeTenants,
    getArchived: () => archivedTenants,
    getRooms: () => rooms,
    isLoading: () => loading,
    onBeforeMutate: () => {
      moreOptionsId = null;
    },
  });

  // ----- modal targets -----
  let formOpen = $state(false);
  let editingTenant: Tenant | null = $state(null);
  let payTarget: Tenant | null = $state(null);
  let applyTarget: Tenant | null = $state(null);
  let moveOutTarget: Tenant | null = $state(null);
  let depositPrompt: Tenant | null = $state(null);
  let detailTarget: Tenant | null = $state(null);
  let historyTarget: Tenant | null = $state(null);
  let editTarget: { tenant: Tenant; rows: PaymentRecord[] } | null = $state(null);
  let receiptTarget: { tenant: Tenant; rows: PaymentRecord[]; recorded: boolean } | null = $state(null);
  let pendingDelete: Tenant | null = $state(null);
  // Bumped after an edit so the open Payment History modal reloads its list.
  let historyReloadKey = $state(0);

  /** Set the inline alert AND surface an error toast (kept in one place). */
  function reportError(msg: string) {
    error = msg;
    pushToast(msg, "error");
  }

  function openAdd() {
    editingTenant = null;
    formOpen = true;
  }

  function openEdit(t: Tenant) {
    editingTenant = t;
    formOpen = true;
  }

  function closeForm() {
    formOpen = false;
  }

  async function loadData() {
    // Cards start collapsed on every list re-render (tenant-more-options-spec §R5).
    moreOptionsId = null;
    try {
      const db = await getDb();
      tenants = await db.select<Tenant[]>(
        `SELECT t.*, r.room_number FROM tenants t
         JOIN rooms r ON r.id = t.room_id ORDER BY t.id`
      );
      rooms = await db.select<Room[]>(
        `SELECT r.id, r.room_number, r.capacity, r.monthly_rate, r.maintenance,
                COALESCE((SELECT SUM(t.beds_occupied) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL), 0) AS occupied_beds,
                (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id AND x.status = 'active' AND x.hold_type = 'whole') AS whole_reservations,
                COALESCE((SELECT SUM(x.bed_count) FROM reservations x WHERE x.room_id = r.id
                          AND x.status = 'active' AND x.hold_type IN ('bed','custom')), 0) AS held_beds
         FROM rooms r ORDER BY r.id`
      );
    } catch (e) {
      error = `Failed to load data: ${String(e)}`;
    } finally {
      loading = false;
    }
  }

  onMount(loadData);

  const flows = createTenantPageFlows({
    getRooms: () => rooms,
    getAll: () => tenants,
    reload: loadData,
    historyChanged: () => {
      historyReloadKey++;
    },
    showReceipt: (receipt) => {
      receiptTarget = receipt;
    },
    promptDepositRefund: (t) => {
      depositPrompt = t;
    },
    clearMoveOut: () => {
      moveOutTarget = null;
    },
    clearEdit: () => {
      editTarget = null;
    },
    askDelete: (t) => {
      pendingDelete = t;
    },
    reportError,
  });

  /** Open the edit flow for one payment transaction (receipt number). */
  function openPaymentEdit(t: Tenant, rows: PaymentRecord[]) {
    editTarget = { tenant: t, rows };
  }
</script>

<main>
  <header class="page-header with-action">
    <div>
      <p class="eyebrow">People</p>
      <h1>Tenants</h1>
      <p class="subtitle">{activeTenants.length} tenant{activeTenants.length === 1 ? "" : "s"} in total</p>
    </div>
    {#if view === "active"}
      <button
        class="btn btn-primary btn-icon"
        onclick={openAdd}
        disabled={formOpen}
        aria-label="Add tenant"
        title="Add tenant"
      >
        <Icon icon={Plus} size={24} />
      </button>
    {/if}
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}

  {#if !loading}
    <TenantListToolbar
      view={view}
      onView={(next) => {
        view = next;
        moreOptionsId = null;
      }}
      bind:searchQuery={filters.searchQuery}
      statusFilter={filters.statusFilter}
      onSelectBucket={filters.selectBucket}
      filterRoom={filters.filterRoom}
      onClearRoom={filters.clearRoomFilter}
    />
  {/if}

  {#if formOpen}
    <TenantFormModal
      editing={editingTenant}
      rooms={rooms}
      tenants={tenants}
      onSave={flows.saveTenant}
      onClose={closeForm}
    />
  {/if}

  {#if payTarget}
    <PayModal
      tenant={payTarget}
      rooms={rooms}
      onConfirm={flows.pay}
      onApplyBalance={(t) => {
        payTarget = null;
        applyTarget = t;
      }}
      onClose={() => (payTarget = null)}
    />
  {/if}

  {#if applyTarget}
    <ApplyBalanceModal
      tenant={applyTarget}
      rooms={rooms}
      onApply={flows.applyBalance}
      onClose={() => (applyTarget = null)}
    />
  {/if}

  {#if moveOutTarget}
    <MoveOutModal tenant={moveOutTarget} onConfirm={flows.moveOut} onClose={() => (moveOutTarget = null)} />
  {/if}

  {#if depositPrompt}
    <DepositRefundModal tenant={depositPrompt} onRefund={flows.depositRefunded} onClose={() => (depositPrompt = null)} />
  {/if}

  {#if historyTarget}
    {@const target = historyTarget}
    <PaymentHistoryModal
      tenant={target}
      reloadKey={historyReloadKey}
      onReceipt={(rows) => (receiptTarget = { tenant: target, rows, recorded: false })}
      onEdit={(rows) => openPaymentEdit(target, rows)}
      onApplyBalance={(t) => (applyTarget = t)}
      onClose={() => (historyTarget = null)}
    />
  {/if}

  {#if editTarget}
    {@const target = editTarget}
    <EditPayModal
      tenant={target.tenant}
      rooms={rooms}
      rows={target.rows}
      onSave={(opts) => flows.edit(target.tenant, target.rows, opts)}
      onClose={() => (editTarget = null)}
    />
  {/if}

  {#if receiptTarget}
    {@const target = receiptTarget}
    <ReceiptModal
      tenant={target.tenant}
      rows={target.rows}
      recorded={target.recorded}
      onEdit={() => {
        // The editor replaces the receipt (both modals share a z-index, so
        // only one can be up at a time). Saving shows the corrected receipt.
        // Snapshot the target before clearing it: `target` is derived from
        // `receiptTarget`, so nulling first would make it null in here.
        const { tenant, rows } = target;
        receiptTarget = null;
        openPaymentEdit(tenant, rows);
      }}
      onClose={() => (receiptTarget = null)}
    />
  {/if}

  {#if detailTarget}
    <TenantDetailModal tenant={detailTarget} onClose={() => (detailTarget = null)} />
  {/if}

  {#if pendingDelete}
    {@const target = pendingDelete}
    <ConfirmModal
      title="Permanently Delete Tenant"
      subtitle={target.name}
      message={`Permanently delete ${target.name}? This removes their record AND all payment history. This cannot be undone.`}
      confirmLabel="Delete Forever"
      busyLabel="Deleting…"
      danger
      onConfirm={() => flows.deleteTenant(target)}
      onClose={() => (pendingDelete = null)}
    />
  {/if}

  {#if loading}
    <SkeletonList count={4} />
  {:else if view === "active"}
    {#if activeTenants.length === 0}
      <div class="card empty">
        <p class="muted">No tenants yet. Add one to link a room.</p>
        <button class="btn btn-primary" onclick={openAdd}>+ Add Tenant</button>
      </div>
    {:else if filters.visibleActive.length === 0}
      <div class="card empty">
        <p class="muted">{filters.activeEmptyMessage}</p>
      </div>
    {:else}
      <ul class="list-stack">
        {#each filters.visibleActive as tenant (tenant.id)}
          <TenantCard
            tenant={tenant}
            expanded={moreOptionsId === tenant.id}
            onPay={(t) => (payTarget = t)}
            onHistory={(t) => (historyTarget = t)}
            onEdit={openEdit}
            onMoveOut={(t) => (moveOutTarget = t)}
            onToggleMore={toggleMoreOptions}
            onOpenDetails={openDetails}
          />
        {/each}
      </ul>
    {/if}
  {:else}
    {#if archivedTenants.length === 0}
      <div class="card empty">
        <p class="muted">No archived tenants. Moved-out tenants appear here.</p>
      </div>
    {:else if filters.visibleArchived.length === 0}
      <div class="card empty">
        <p class="muted">No tenants match “{filters.searchQuery.trim()}”.</p>
      </div>
    {:else}
      <ul class="list-stack">
        {#each filters.visibleArchived as tenant (tenant.id)}
          <TenantCard
            tenant={tenant}
            archived
            expanded={moreOptionsId === tenant.id}
            onHistory={(t) => (historyTarget = t)}
            onDepositRefunded={flows.depositRefunded}
            onDelete={flows.requestDelete}
            onToggleMore={toggleMoreOptions}
            onOpenDetails={openDetails}
          />
        {/each}
      </ul>
    {/if}
  {/if}
</main>
