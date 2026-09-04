<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { getDb } from "$lib/db";
  import { phpPeso } from "$lib/format";
  import { heldBalanceOf } from "$lib/held-balance";
  import {
    applyHeldBalance,
    recordPayment,
    updatePayment,
    markMovedOut,
    refundDeposit,
    type PaymentEditOptions,
  } from "$lib/tenant-actions";
  import { getSetting } from "$lib/settings";
  import { pushToast } from "$lib/toast.svelte";
  import ApplyBalanceModal from "./ApplyBalanceModal.svelte";
  import TenantFormModal from "./TenantFormModal.svelte";
  import PayModal from "./PayModal.svelte";
  import EditPayModal from "./EditPayModal.svelte";
  import MoveOutModal from "./MoveOutModal.svelte";
  import DepositRefundModal from "./DepositRefundModal.svelte";
  import PaymentHistoryModal from "./PaymentHistoryModal.svelte";
  import ReceiptModal from "./ReceiptModal.svelte";
  import TenantCard from "./TenantCard.svelte";
  import TenantDetailModal from "./TenantDetailModal.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import type { PaymentRecord, Room, Tenant, TenantFormState } from "./types";

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

  // ----- search (name / contact / room number) -----
  let searchQuery = $state("");

  function matchesSearch(t: Tenant): boolean {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.contact.toLowerCase().includes(q) ||
      t.room_number.toLowerCase().includes(q)
    );
  }

  // ----- room filter (?room= param — set by the rooms page's "Manage tenants"
  // menu item, deep-linkable). Applies to the Active list only. An unknown
  // room id degrades gracefully to no filter. -----
  const filterRoom = $derived(
    (() => {
      const raw = page.url.searchParams.get("room");
      if (!raw) return null;
      const id = Number(raw);
      if (!Number.isFinite(id)) return null;
      return rooms.find((r) => r.id === id) ?? null;
    })()
  );

  const visibleActive = $derived(
    activeTenants.filter(matchesSearch).filter((t) => !filterRoom || t.room_id === filterRoom.id)
  );
  const visibleArchived = $derived(archivedTenants.filter(matchesSearch));

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

  /** Persist the tenant form; returns an error message or null on success. */
  async function saveTenant(form: TenantFormState): Promise<string | null> {
    try {
      const db = await getDb();
      const deposit = String(form.deposit_amount ?? "").trim() === "" ? null : Number(form.deposit_amount);
      // Advance is MONEY (advance-money-field-spec.md) — entered directly as ₱
      // and stored straight into advance_held with NO multiplication.
      const advance = Number(form.advance_amount);
      // Per-tenant rate: a blank field falls back to the room's rate at save
      // time (snapshot semantics — later room-rate edits never touch this
      // tenant's rate).
      const room = rooms.find((r) => r.id === Number(form.room_id));
      const rateStr = String(form.monthly_rate ?? "").trim();
      const monthlyRate = rateStr === "" ? (room?.monthly_rate ?? 0) : Number(rateStr);
      if (form.id === null) {
        // Upfront money is HELD, not auto-applied (held-balance-spec.md §5.2):
        // the advance amount funds the advance pot (consumed first), the
        // deposit funds the deposit pot (consumed last), and nothing is
        // recorded as a payment until the landlord manually applies the
        // balance. advance_held = the entered ₱ (no months × rate math);
        // advance_months stays 0 for new tenants (legacy column).
        await db.execute(
          "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, monthly_rate, deposit_amount, advance_months, advance_held, deposit_held, last_paid_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [form.name.trim(), form.contact.trim(), Number(form.room_id), form.move_in_date, form.due_date, monthlyRate, deposit, 0, advance, deposit ?? 0, null]
        );
      } else {
        // Editing overwrites the REMAINING advance pot (the correction path
        // for a wrongly-large balance); legacy advance_months is left as-is.
        await db.execute(
          "UPDATE tenants SET name=$1, contact=$2, room_id=$3, move_in_date=$4, due_date=$5, monthly_rate=$6, deposit_amount=$7, advance_held=$8 WHERE id=$9",
          [form.name.trim(), form.contact.trim(), Number(form.room_id), form.move_in_date, form.due_date, monthlyRate, deposit, advance, form.id]
        );
      }
      await loadData();
      pushToast(form.id === null ? `Tenant added — ${form.name.trim()}` : `Tenant updated — ${form.name.trim()}`, "success");
      return null;
    } catch (e) {
      const msg = String(e);
      let friendly: string;
      if (msg.toLowerCase().includes("full capacity")) friendly = "That room is already at full capacity.";
      else if (msg.toLowerCase().includes("under maintenance")) friendly = "That room is under maintenance.";
      else if (msg.toLowerCase().includes("reserved")) friendly = "That room is reserved — cancel or convert the reservation first.";
      else friendly = `Failed to save tenant: ${msg}`;
      pushToast(friendly, "error");
      return friendly;
    }
  }

  /** Apply held balance to cover one due date; error message or null. */
  async function confirmApplyBalance(t: Tenant, coveredDueDate: string): Promise<string | null> {
    try {
      const db = await getDb();
      const rate = t.monthly_rate ?? rooms.find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
      const result = await applyHeldBalance(db, t, rate, { coveredDueDate });
      if (result.error) return result.error;
      const amount = result.rows.reduce((sum, r) => sum + r.amount, 0);
      await loadData();
      // An open Payment History modal holds its own snapshot — tell it to
      // reload so the balance + list reflect the application.
      historyReloadKey++;
      pushToast(`Applied ${phpPeso(amount)} from held balance`, "success");
      // The receipt doubles as the confirmation screen, like a cash payment.
      receiptTarget = { tenant: t, rows: result.rows, recorded: true };
      return null;
    } catch (e) {
      const msg = `Failed to apply held balance: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /** Record a payment and set the landlord-chosen next due date; error message or null. */
  async function confirmPay(
    t: Tenant,
    amount: number,
    method: string,
    paidDate: string,
    coveredDueDate: string,
    nextDueDate: string
  ): Promise<string | null> {
    try {
      const db = await getDb();
      const rate = t.monthly_rate ?? rooms.find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
      const result = await recordPayment(db, t, rate, amount, method, paidDate, coveredDueDate, nextDueDate);
      if (result.error) return result.error;
      await loadData();
      pushToast(`Payment recorded — ${phpPeso(amount)}`, "success");
      // Show the receipt for this transaction right after confirming (with the
      // success banner — it IS the confirmation screen, per payment-edit-spec).
      receiptTarget = { tenant: t, rows: result.rows, recorded: true };
      return null;
    } catch (e) {
      const msg = `Failed to record payment: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /** Open the edit flow for one payment transaction (receipt number). */
  function openPaymentEdit(t: Tenant, rows: PaymentRecord[]) {
    editTarget = { tenant: t, rows };
  }

  /** Apply an edit; error message or null. On success the corrected receipt shows. */
  async function confirmEdit(t: Tenant, opts: PaymentEditOptions): Promise<string | null> {
    try {
      const target = editTarget;
      if (!target) return "No payment selected.";
      const db = await getDb();
      const receiptNo = target.rows[0]?.receipt_no ?? "";
      const rate = t.monthly_rate ?? rooms.find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
      const result = await updatePayment(db, t, rate, receiptNo, opts);
      if (result.error) return result.error;
      const amount = result.rows.reduce((sum, r) => sum + r.amount, 0);
      editTarget = null;
      await loadData();
      // The history modal (if open) holds its own snapshot — tell it to reload.
      historyReloadKey++;
      pushToast(`Payment updated — ${phpPeso(amount)}`, "success");
      // Show the corrected receipt for this transaction right after saving.
      receiptTarget = { tenant: t, rows: result.rows, recorded: false };
      return null;
    } catch (e) {
      const msg = `Failed to update payment: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  // ----- move out / archive -----
  async function confirmMoveOut(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await markMovedOut(db, t.id);
      moveOutTarget = null;
      await loadData();
      const fresh = tenants.find((x) => x.id === t.id) ?? t;
      pushToast(`${fresh.name} marked as moved out`, "success");
      // Refund behavior is configurable (held-balance-spec.md §5.4): when
      // refunds are allowed, prompt for the remaining deposit pot. When they
      // aren't, the balance is meant to be consumed covering months instead.
      const refundAllowed = (await getSetting("deposit_refund_allowed", "1")) === "1";
      if (refundAllowed && fresh.deposit_held > 0 && fresh.deposit_refunded === 0) {
        depositPrompt = fresh;
      } else if (!refundAllowed && heldBalanceOf(fresh) > 0) {
        pushToast(`${fresh.name} moved out — ${phpPeso(heldBalanceOf(fresh))} held. Apply it to cover unpaid months.`, "info");
      }
    } catch (e) {
      reportError(`Failed to mark as moved out: ${String(e)}`);
    }
  }

  async function markDepositRefunded(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await refundDeposit(db, t.id);
      depositPrompt = null;
      await loadData();
      pushToast(`Deposit refunded — ${t.name}`, "success");
    } catch (e) {
      reportError(`Failed to update deposit: ${String(e)}`);
    }
  }

  /** Open the in-app confirm for permanent deletion. */
  function permanentlyDelete(t: Tenant) {
    pendingDelete = t;
  }

  /** Actually wipe the tenant and their payment history after confirmation. */
  async function deleteTenant(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM tenants WHERE id=$1", [t.id]);
      pendingDelete = null;
      await loadData();
      pushToast(`Tenant deleted — ${t.name}`, "success");
    } catch (e) {
      // Keep the modal open so the landlord can retry or cancel.
      reportError(`Failed to delete tenant: ${String(e)}`);
    }
  }
</script>

<main>
  <header class="page-header">
    <div>
      <h1>Tenant Management</h1>
      <p class="subtitle">{activeTenants.length} tenant{activeTenants.length === 1 ? "" : "s"} in total</p>
    </div>
    {#if view === "active"}
      <button class="btn btn-primary" onclick={openAdd} disabled={formOpen}>+ Add Tenant</button>
    {/if}
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}

  {#if !loading}
    <div class="segmented" role="tablist" aria-label="Tenant view">
      <button class:active={view === "active"} onclick={() => {
        view = "active";
        moreOptionsId = null;
      }}>
        Active
      </button>
      <button class:active={view === "archived"} onclick={() => {
        view = "archived";
        moreOptionsId = null;
      }}>
        Archived
      </button>
    </div>

    {#if filterRoom && view === "active"}
      <div class="room-filter-row">
        <span class="room-filter-chip">
          Room {filterRoom.room_number}
          <button type="button" class="room-filter-clear" aria-label="Clear room filter" onclick={() => goto("/tenants")}>
            ✕
          </button>
        </span>
      </div>
    {/if}

    <div class="search-wrap">
      <input
        type="search"
        class="search-input"
        placeholder="Search name, contact, or room…"
        bind:value={searchQuery}
      />
    </div>
  {/if}

  {#if formOpen}
    <TenantFormModal
      editing={editingTenant}
      rooms={rooms}
      tenants={tenants}
      onSave={saveTenant}
      onClose={closeForm}
    />
  {/if}

  {#if payTarget}
    <PayModal
      tenant={payTarget}
      rooms={rooms}
      onConfirm={confirmPay}
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
      onApply={confirmApplyBalance}
      onClose={() => (applyTarget = null)}
    />
  {/if}

  {#if moveOutTarget}
    <MoveOutModal tenant={moveOutTarget} onConfirm={confirmMoveOut} onClose={() => (moveOutTarget = null)} />
  {/if}

  {#if depositPrompt}
    <DepositRefundModal tenant={depositPrompt} onRefund={markDepositRefunded} onClose={() => (depositPrompt = null)} />
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
      onSave={(opts) => confirmEdit(target.tenant, opts)}
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
      onConfirm={() => deleteTenant(target)}
      onClose={() => (pendingDelete = null)}
    />
  {/if}

  {#if loading}
    <p class="muted">Loading tenants…</p>
  {:else if view === "active"}
    {#if activeTenants.length === 0}
      <div class="card empty">
        <p class="muted">No tenants yet. Add one to link a room.</p>
        <button class="btn btn-primary" onclick={openAdd}>+ Add Tenant</button>
      </div>
    {:else if visibleActive.length === 0}
      <div class="card empty">
        <p class="muted">No tenants match “{searchQuery.trim()}”.</p>
      </div>
    {:else}
      <ul class="tenant-list">
        {#each visibleActive as tenant (tenant.id)}
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
    {:else if visibleArchived.length === 0}
      <div class="card empty">
        <p class="muted">No tenants match “{searchQuery.trim()}”.</p>
      </div>
    {:else}
      <ul class="tenant-list">
        {#each visibleArchived as tenant (tenant.id)}
          <TenantCard
            tenant={tenant}
            archived
            expanded={moreOptionsId === tenant.id}
            onHistory={(t) => (historyTarget = t)}
            onDepositRefunded={markDepositRefunded}
            onDelete={permanentlyDelete}
            onToggleMore={toggleMoreOptions}
            onOpenDetails={openDetails}
          />
        {/each}
      </ul>
    {/if}
  {/if}
</main>

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
    padding-right: 44px;
  }

  .tenant-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ---- room filter chip (?room= param) ---- */
  .room-filter-row {
    margin-bottom: 10px;
  }

  .room-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    color: #ffffff;
    border-radius: 999px;
    padding: 6px 8px 6px 12px;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .room-filter-clear {
    border: none;
    background: none;
    color: inherit;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .room-filter-clear:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  .room-filter-clear:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---- search ---- */
  .search-wrap {
    margin-bottom: 14px;
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 10px 14px;
    font-size: 0.95rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .search-input:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }
</style>
