<script lang="ts">
  import { onMount } from "svelte";
  import type Database from "@tauri-apps/plugin-sql";
  import { addMonths } from "$lib/payment-status";
  import { getDb } from "$lib/db";
  import { monthKeyOf, phpPeso } from "$lib/format";
  import { pushToast } from "$lib/toast.svelte";
  import TenantFormModal from "./TenantFormModal.svelte";
  import PayModal from "./PayModal.svelte";
  import MoveOutModal from "./MoveOutModal.svelte";
  import DepositRefundModal from "./DepositRefundModal.svelte";
  import PaymentHistoryModal from "./PaymentHistoryModal.svelte";
  import ReceiptModal from "./ReceiptModal.svelte";
  import TenantCard from "./TenantCard.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import type { PaymentRecord, Room, Tenant, TenantFormState } from "./types";

  let tenants: Tenant[] = $state([]);
  let rooms: Room[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let view: "active" | "archived" = $state("active");

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

  const visibleActive = $derived(activeTenants.filter(matchesSearch));
  const visibleArchived = $derived(archivedTenants.filter(matchesSearch));

  // ----- modal targets -----
  let formOpen = $state(false);
  let editingTenant: Tenant | null = $state(null);
  let payTarget: Tenant | null = $state(null);
  let moveOutTarget: Tenant | null = $state(null);
  let depositPrompt: Tenant | null = $state(null);
  let historyTarget: Tenant | null = $state(null);
  let receiptTarget: { tenant: Tenant; rows: PaymentRecord[] } | null = $state(null);
  let pendingDelete: Tenant | null = $state(null);

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
    try {
      const db = await getDb();
      tenants = await db.select<Tenant[]>(
        `SELECT t.*, r.room_number FROM tenants t
         JOIN rooms r ON r.id = t.room_id ORDER BY t.id`
      );
      rooms = await db.select<Room[]>(
        `SELECT r.id, r.room_number, r.capacity, r.monthly_rate, r.maintenance,
                (SELECT COUNT(*) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL) AS tenant_count,
                (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id AND x.status = 'active' AND x.scope = 'whole') AS whole_reservations,
                (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id AND x.status = 'active' AND x.scope = 'slot') AS slot_reservations
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
      const advance = Number(form.advance_months);
      // Per-tenant rate: a blank field falls back to the room's rate at save
      // time (snapshot semantics — later room-rate edits never touch this
      // tenant's rate).
      const room = rooms.find((r) => r.id === Number(form.room_id));
      const rateStr = String(form.monthly_rate ?? "").trim();
      const monthlyRate = rateStr === "" ? (room?.monthly_rate ?? 0) : Number(rateStr);
      if (form.id === null) {
        // Paying advance months at move-in counts as a recorded payment, so the
        // payment status starts green instead of using the legacy heuristic.
        const lastPaid = advance >= 1 ? form.move_in_date : null;
        // lastInsertId comes from the statement's own connection — safe even
        // though the plugin pools connections (SELECT last_insert_rowid() would
        // not be).
        const result = await db.execute(
          "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, monthly_rate, deposit_amount, advance_months, last_paid_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [form.name.trim(), form.contact.trim(), Number(form.room_id), form.move_in_date, form.due_date, monthlyRate, deposit, advance, lastPaid]
        );
        // Record the advance months as payment rows so the Earnings page counts
        // them as collected from day one.
        if (advance >= 1 && result.lastInsertId != null) {
          await recordMoveInAdvances(result.lastInsertId, form.move_in_date, monthlyRate, advance);
        }
      } else {
        await db.execute(
          "UPDATE tenants SET name=$1, contact=$2, room_id=$3, move_in_date=$4, due_date=$5, monthly_rate=$6, deposit_amount=$7, advance_months=$8 WHERE id=$9",
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

  /** Next receipt number, from the current max payment id (RCPT-######). */
  async function nextReceiptNo(db: Database): Promise<string> {
    const row = await db.select<{ n: number }[]>("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM payments");
    return `RCPT-${String(row[0].n).padStart(6, "0")}`;
  }

  /**
   * Record the move-in advance months as payment rows — one per covered month
   * starting from the move-in month, all sharing one receipt number. The method
   * isn't asked at move-in, so it's stored as "—".
   */
  async function recordMoveInAdvances(tenantId: number, moveInDate: string, rate: number, count: number): Promise<void> {
    const db = await getDb();
    const receiptNo = await nextReceiptNo(db);
    for (let i = 0; i < count; i++) {
      await db.execute(
        "INSERT INTO payments (tenant_id, amount, paid_date, due_date, covers_month, method, receipt_no) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [tenantId, rate, moveInDate, addMonths(moveInDate, i + 1), monthKeyOf(addMonths(moveInDate, i)), "—", receiptNo]
      );
    }
  }

  /** Record a payment and roll the due date forward; error message or null. */
  async function confirmPay(t: Tenant, amount: number, months: number, method: string): Promise<string | null> {
    try {
      const db = await getDb();
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
        today.getDate()
      ).padStart(2, "0")}`;

      // Full payment only (billing-features-spec.md §3): the amount must be
      // exactly rate × months. The UI locks it, but keep the guard so a future
      // caller can't silently record a partial payment.
      const rate = t.monthly_rate ?? rooms.find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
      if (amount !== rate * months) {
        return "Amount must equal the full monthly rate for the months being paid.";
      }

      // One payment row per covered month (§5). The first covered month is the
      // month of the tenant's current due date, so early / on-time / late
      // collections all land on the right month. All rows share a receipt number.
      const receiptNo = await nextReceiptNo(db);
      for (let i = 0; i < months; i++) {
        await db.execute(
          "INSERT INTO payments (tenant_id, amount, paid_date, due_date, covers_month, method, receipt_no) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [t.id, rate, todayIso, addMonths(t.due_date, i + 1), monthKeyOf(addMonths(t.due_date, i)), method, receiptNo]
        );
      }

      await db.execute(
        "UPDATE tenants SET last_paid_date=$1, due_date=$2 WHERE id=$3",
        [todayIso, addMonths(t.due_date, months), t.id]
      );
      await loadData();
      pushToast(`Payment recorded — ${phpPeso(amount)}`, "success");

      // Show the receipt for this transaction right after confirming.
      const rows = await db.select<PaymentRecord[]>(
        "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
        [t.id, receiptNo]
      );
      receiptTarget = { tenant: t, rows };
      return null;
    } catch (e) {
      const msg = `Failed to mark as paid: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  // ----- move out / archive -----
  async function confirmMoveOut(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
        today.getDate()
      ).padStart(2, "0")}`;
      await db.execute("UPDATE tenants SET moved_out_date=$1 WHERE id=$2", [todayIso, t.id]);
      moveOutTarget = null;
      await loadData();
      pushToast(`${t.name} marked as moved out`, "success");
      // Prompt for the deposit refund right after, if one is still outstanding.
      if (t.deposit_amount != null && t.deposit_amount > 0 && t.deposit_refunded === 0) {
        depositPrompt = tenants.find((x) => x.id === t.id) ?? t;
      }
    } catch (e) {
      reportError(`Failed to mark as moved out: ${String(e)}`);
    }
  }

  async function markDepositRefunded(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await db.execute("UPDATE tenants SET deposit_refunded=1 WHERE id=$1", [t.id]);
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
      <button class:active={view === "active"} onclick={() => (view = "active")}>Active</button>
      <button class:active={view === "archived"} onclick={() => (view = "archived")}>Archived</button>
    </div>

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
    <PayModal tenant={payTarget} rooms={rooms} onConfirm={confirmPay} onClose={() => (payTarget = null)} />
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
      onReceipt={(rows) => (receiptTarget = { tenant: target, rows })}
      onClose={() => (historyTarget = null)}
    />
  {/if}

  {#if receiptTarget}
    {@const target = receiptTarget}
    <ReceiptModal tenant={target.tenant} rows={target.rows} onClose={() => (receiptTarget = null)} />
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
            onPay={(t) => (payTarget = t)}
            onHistory={(t) => (historyTarget = t)}
            onEdit={openEdit}
            onMoveOut={(t) => (moveOutTarget = t)}
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
            onHistory={(t) => (historyTarget = t)}
            onDepositRefunded={markDepositRefunded}
            onDelete={permanentlyDelete}
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
