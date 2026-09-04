<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db";
  import { badgeClass } from "$lib/room-status";
  import { getPaymentStatus, paymentLabel, type PaymentStatus } from "$lib/payment-status";
  import { formatDate, formatMonthRange, monthKeyOf, phpPeso, phpPesoPrecise, roomLabel } from "$lib/format";
  import {
    applyHeldBalance,
    recordPayment,
    updatePayment,
    markMovedOut,
    refundDeposit,
    type PaymentEditOptions,
  } from "$lib/tenant-actions";
  import { getSetting } from "$lib/settings";
  import { heldBalanceOf } from "$lib/held-balance";
  import { pushToast } from "$lib/toast.svelte";
  import { pushOverlay } from "$lib/back-stack";
  import { buildBedBoxes } from "$lib/bed-boxes";
  import type { BoarderSheetRoom } from "$lib/rooms";
  import PayModal from "../../routes/tenants/PayModal.svelte";
  import ApplyBalanceModal from "../../routes/tenants/ApplyBalanceModal.svelte";
  import EditPayModal from "../../routes/tenants/EditPayModal.svelte";
  import MoveOutModal from "../../routes/tenants/MoveOutModal.svelte";
  import DepositRefundModal from "../../routes/tenants/DepositRefundModal.svelte";
  import ReceiptModal from "../../routes/tenants/ReceiptModal.svelte";
  import type { PaymentRecord, Room as TenantRoom, Tenant } from "../../routes/tenants/types";

  /** An active boarder in the room (tenants row, moved_out_date IS NULL). */
  interface Boarder {
    id: number;
    name: string;
    contact: string;
    /** Beds this tenant occupies in this room (multi-bed, v050+). */
    beds_occupied: number;
    monthly_rate: number | null;
    move_in_date: string;
    due_date: string;
    last_paid_date: string | null;
    deposit_amount: number | null;
    deposit_refunded: number;
    advance_months: number;
    advance_held: number;
    deposit_held: number;
  }

  /** One receipt transaction, grouped like the Payment History modal. */
  interface PaymentGroup {
    receipt_no: string;
    paid_date: string;
    first_month: string | null;
    last_month: string | null;
    /** Newest due date across the receipt's rows (the covered due date for new-style single payments). */
    due_date: string;
    total: number;
    method: string;
    count: number;
  }

  /** An active reservation held on this room (a guest, not yet a tenant). */
  interface ReservedGuest {
    id: number;
    name: string;
    contact: string;
    reservation_date: string;
    target_move_in_date: string;
    hold_type: "whole" | "bed" | "custom";
    bed_count: number | null;
    deposit: number | null;
  }

  let {
    room,
    onClose,
    onDataChanged,
  }: {
    room: BoarderSheetRoom;
    onClose: () => void;
    /** Called after any successful payment mutation so the dashboard can refresh earnings. */
    onDataChanged?: () => void;
  } = $props();

  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CLOSE_MS = 300;

  let boarders = $state<Boarder[]>([]);
  let reservations = $state<ReservedGuest[]>([]);
  let loading = $state(true);
  let loadError: string | null = $state(null);

  // ----- two-level view (room-bed-view-spec) -----
  // Level 1 shows the capacity-sized bed grid; tapping a tenant's box opens
  // their full detail view (level 2), which also hosts the bed-count control.
  let selected: Boarder | null = $state(null);
  let bedsDraft = $state(1);
  let savingBeds = $state(false);

  // ----- quick actions (record payment / move out / edit payment) -----
  let payTarget: Boarder | null = $state(null);
  let applyTarget: Boarder | null = $state(null);
  let moveOutTarget: Boarder | null = $state(null);
  let depositPrompt: Tenant | null = $state(null);
  let editTarget: { tenant: Tenant; rows: PaymentRecord[] } | null = $state(null);
  let receiptTarget: { tenant: Tenant; rows: PaymentRecord[]; recorded: boolean } | null = $state(null);

  // ----- payment history (loaded lazily on first expand, per boarder) -----
  let expanded = $state<Record<number, boolean>>({});
  let histories = $state<Record<number, PaymentGroup[]>>({});
  let historyLoading = $state<Record<number, boolean>>({});
  let historyErrors = $state<Record<number, string>>({});

  // ----- sheet motion / dismissal -----
  let closing = $state(false);
  let dragging = $state(false);
  let dragOffset = $state(0);
  let dragStartY = 0;
  let dragPointerId: number | null = null;
  let sheetEl: HTMLElement;
  let bodyEl: HTMLElement;
  let previousFocus: HTMLElement | null = null;

  /** True while one of the nested action modals (Pay / Apply / Edit / Move Out / etc.) is up. */
  const actionModalOpen = $derived(!!(payTarget || applyTarget || moveOutTarget || depositPrompt || editTarget || receiptTarget));

  // The ReceiptModal must outlive the PayModal that created it (tenants-page
  // behavior): PayModal closes only payTarget, then ReceiptModal shows on top.
  function closePay() {
    payTarget = null;
    sheetEl?.focus();
  }
  function closeApply() {
    applyTarget = null;
    sheetEl?.focus();
  }
  function closeMoveOut() {
    moveOutTarget = null;
    sheetEl?.focus();
  }
  function closeEdit() {
    editTarget = null;
    sheetEl?.focus();
  }
  function closeDeposit() {
    depositPrompt = null;
    sheetEl?.focus();
  }
  function closeReceipt() {
    receiptTarget = null;
    sheetEl?.focus();
  }

  onMount(() => {
    previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    sheetEl?.focus();
    loadBoarders();
    // Android back button: step out of level 2 to the grid first, then close
    // this sheet (or whatever nested modal is up) instead of letting the
    // WebView navigate its history.
    const unregister = pushOverlay(handleBack);
    return () => {
      unregister();
      document.body.style.overflow = "";
      // Also restore focus if the sheet is unmounted directly (e.g. the room
      // vanished and the page cleared it without going through close()).
      previousFocus?.focus?.();
    };
  });

  /** Load the room's active boarders and any active reservations on open. */
  async function loadBoarders() {
    try {
      const db = await getDb();
      [boarders, reservations] = await Promise.all([
        db.select<Boarder[]>(
          `SELECT id, name, contact, beds_occupied, monthly_rate, move_in_date, due_date, last_paid_date,
                  deposit_amount, deposit_refunded, advance_months, advance_held, deposit_held
           FROM tenants WHERE room_id=$1 AND moved_out_date IS NULL ORDER BY id`,
          [room.id]
        ),
        db.select<ReservedGuest[]>(
          `SELECT id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count, deposit
           FROM reservations WHERE room_id=$1 AND status='active' ORDER BY id`,
          [room.id]
        ),
      ]);
    } catch (e) {
      loadError = `Failed to load room details: ${String(e)}`;
    } finally {
      loading = false;
    }
  }

  // ----- two-level navigation + bed-count editing (room-bed-view-spec) -----

  // The $state proxy doesn't stay narrowed inside $derived callbacks, so each
  // derived captures `selected` into a plain local const first.
  /** Beds taken by the OTHER boarders (excluding the selected tenant). */
  const otherBeds = $derived.by(() => {
    const sel = selected;
    return sel
      ? boarders.filter((b) => b.id !== sel.id).reduce((sum, b) => sum + b.beds_occupied, 0)
      : 0;
  });
  /** Highest bed count this tenant may take (held beds count against free space). */
  const maxBeds = $derived.by(() => {
    const sel = selected;
    return Math.max(
      sel?.beds_occupied ?? 1,
      Math.min(room.capacity, room.capacity - otherBeds - room.held_beds)
    );
  });
  /** Beds still free in the room, shown next to the stepper. */
  const roomFree = $derived.by(() => {
    const sel = selected;
    return Math.max(0, room.capacity - otherBeds - (sel?.beds_occupied ?? 0) - room.held_beds);
  });

  /** Open a tenant's full detail view (level 2) from one of their bed boxes. */
  function openTenant(id: number) {
    const b = boarders.find((x) => x.id === id);
    if (!b) return;
    selected = b;
    bedsDraft = b.beds_occupied;
  }

  /** Persist the bed count; the DB trigger (v057) backs up the same guard. */
  async function applyBeds() {
    const b = selected;
    if (!b || bedsDraft === b.beds_occupied) return;
    try {
      savingBeds = true;
      const db = await getDb();
      await db.execute("UPDATE tenants SET beds_occupied=$1 WHERE id=$2", [bedsDraft, b.id]);
      pushToast(`${b.name} now occupies ${bedsDraft} bed${bedsDraft === 1 ? "" : "s"}`, "success");
      await loadBoarders();
      refreshSelected();
    } catch (e) {
      const msg = String(e);
      pushToast(
        msg.toLowerCase().includes("full capacity")
          ? `${room.room_number} is at full capacity.`
          : `Failed to update beds: ${msg}`,
        "error"
      );
    } finally {
      savingBeds = false;
    }
  }

  /** Re-point the open tenant at its freshly loaded row (or drop level 2 if gone). */
  function refreshSelected() {
    const sel = selected;
    if (!sel) return;
    const fresh = boarders.find((x) => x.id === sel.id);
    if (fresh) {
      selected = fresh;
      bedsDraft = fresh.beds_occupied;
    } else {
      selected = null;
    }
  }

  /** Android back / Esc: step level 2 → grid, then close the sheet. */
  function handleBack() {
    if (closing || actionModalOpen) return;
    if (selected) {
      selected = null;
      return;
    }
    close();
  }

  /** Lift a boarder into the full Tenant shape the action modals expect. */
  function toTenant(b: Boarder): Tenant {
    return {
      id: b.id,
      name: b.name,
      contact: b.contact,
      room_id: room.id,
      room_number: room.room_number,
      beds_occupied: b.beds_occupied,
      monthly_rate: b.monthly_rate,
      move_in_date: b.move_in_date,
      due_date: b.due_date,
      last_paid_date: b.last_paid_date,
      deposit_amount: b.deposit_amount,
      deposit_refunded: b.deposit_refunded,
      advance_months: b.advance_months,
      advance_held: b.advance_held,
      deposit_held: b.deposit_held,
      moved_out_date: null,
    };
  }

  /** Room list the Pay modal uses for the per-tenant rate fallback. */
  const payRooms = $derived<TenantRoom[]>([
    {
      id: room.id,
      room_number: room.room_number,
      capacity: room.capacity,
      monthly_rate: room.monthly_rate,
      occupied_beds: room.occupied_beds,
      maintenance: 0,
      // Only the rate fallback is read by Pay/EditPay — hold counts are
      // irrelevant to a payment modal, so this can stay 0.
      whole_reservations: 0,
      held_beds: room.held_beds,
    },
  ]);

  /** Record a payment, then show the receipt and refresh the boarders. */
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
      const result = await recordPayment(db, t, room.monthly_rate, amount, method, paidDate, coveredDueDate, nextDueDate);
      if (result.error) return result.error;
      pushToast(`Payment recorded — ${phpPeso(amount)}`, "success");
      // Success banner on the receipt — it IS the confirmation screen.
      receiptTarget = { tenant: t, rows: result.rows, recorded: true };
      await loadBoarders();
      refreshSelected();
      onDataChanged?.();
      return null;
    } catch (e) {
      const msg = `Failed to record payment: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /** Open the edit flow for one payment transaction (inline history row). */
  async function openEditGroup(b: Boarder, receiptNo: string) {
    try {
      const db = await getDb();
      const rows = await db.select<PaymentRecord[]>(
        "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
        [b.id, receiptNo]
      );
      if (rows.length === 0) {
        pushToast("Payment not found — it may have been deleted.", "error");
        return;
      }
      editTarget = { tenant: toTenant(b), rows };
    } catch (e) {
      pushToast(`Failed to load payment: ${String(e)}`, "error");
    }
  }

  /** Apply an edit; error message or null. On success the corrected receipt shows. */
  async function confirmEdit(t: Tenant, opts: PaymentEditOptions): Promise<string | null> {
    try {
      const target = editTarget;
      if (!target) return "No payment selected.";
      const db = await getDb();
      const receiptNo = target.rows[0]?.receipt_no ?? "";
      const result = await updatePayment(db, t, room.monthly_rate, receiptNo, opts);
      if (result.error) return result.error;
      const amount = result.rows.reduce((sum, r) => sum + r.amount, 0);
      editTarget = null;
      pushToast(`Payment updated — ${phpPeso(amount)}`, "success");
      // Show the corrected receipt right after saving, then refresh the boarder.
      receiptTarget = { tenant: t, rows: result.rows, recorded: false };
      await loadBoarders();
      refreshSelected();
      const b = boarders.find((x) => x.id === t.id);
      if (b) await loadHistoryFor(b);
      onDataChanged?.();
      return null;
    } catch (e) {
      const msg = `Failed to update payment: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /** Mark a boarder as moved out; offer the deposit refund if outstanding. */
  async function confirmMoveOut(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await markMovedOut(db, t.id);
      moveOutTarget = null;
      pushToast(`${t.name} marked as moved out`, "success");
      // Refund behavior is configurable (held-balance-spec.md §5.4): when
      // refunds are allowed, prompt for the remaining deposit pot. When they
      // aren't, the balance is meant to be consumed covering months instead.
      const refundAllowed = (await getSetting("deposit_refund_allowed", "1")) === "1";
      if (refundAllowed && t.deposit_held > 0 && t.deposit_refunded === 0) {
        depositPrompt = t;
      } else if (!refundAllowed && heldBalanceOf(t) > 0) {
        pushToast(`${t.name} moved out — ${phpPeso(heldBalanceOf(t))} held. Apply it to cover unpaid months.`, "info");
      }
      await loadBoarders();
      refreshSelected();
    } catch (e) {
      pushToast(`Failed to mark as moved out: ${String(e)}`, "error");
    }
  }

  /** Apply held balance to cover one due date; error message or null. */
  async function confirmApply(t: Tenant, coveredDueDate: string): Promise<string | null> {
    try {
      const db = await getDb();
      const result = await applyHeldBalance(db, t, room.monthly_rate, { coveredDueDate });
      if (result.error) return result.error;
      const amount = result.rows.reduce((sum, r) => sum + r.amount, 0);
      pushToast(`Applied ${phpPeso(amount)} from held balance`, "success");
      // Success banner on the receipt — it IS the confirmation screen.
      receiptTarget = { tenant: t, rows: result.rows, recorded: true };
      await loadBoarders();
      refreshSelected();
      onDataChanged?.();
      return null;
    } catch (e) {
      const msg = `Failed to apply held balance: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /** Mark a deposit refunded, then refresh the boarders. */
  async function markDepositRefunded(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await refundDeposit(db, t.id);
      depositPrompt = null;
      pushToast(`Deposit refunded — ${t.name}`, "success");
      await loadBoarders();
      refreshSelected();
    } catch (e) {
      pushToast(`Failed to update deposit: ${String(e)}`, "error");
    }
  }

  /** Payment status color for a boarder. */
  function statusOf(b: Boarder): PaymentStatus {
    return getPaymentStatus(b.due_date, new Date(), b.last_paid_date);
  }

  /** Human label for the boarder's payment badge. */
  function statusLabel(b: Boarder): string {
    return paymentLabel(statusOf(b), b.due_date, new Date(), b.last_paid_date);
  }

  /** Load (and cache) one boarder's payment-history groups. */
  async function loadHistoryFor(b: Boarder) {
    try {
      const db = await getDb();
      histories[b.id] = await db.select<PaymentGroup[]>(
        `SELECT receipt_no, MIN(paid_date) AS paid_date, MIN(covers_month) AS first_month,
                MAX(covers_month) AS last_month, MAX(due_date) AS due_date, SUM(amount) AS total,
                MAX(method) AS method, COUNT(*) AS count
         FROM payments WHERE tenant_id=$1 GROUP BY receipt_no ORDER BY MAX(id) DESC`,
        [b.id]
      );
    } catch (e) {
      historyErrors[b.id] = `Failed to load payment history: ${String(e)}`;
    }
  }

  async function toggleHistory(b: Boarder) {
    const isOpen = expanded[b.id] === true;
    if (!isOpen && !histories[b.id] && !historyLoading[b.id]) {
      historyLoading[b.id] = true;
      try {
        await loadHistoryFor(b);
      } finally {
        historyLoading[b.id] = false;
      }
    }
    expanded[b.id] = !isOpen;
  }

  // ----- dismissal: X, backdrop, Esc, swipe-down -----
  function close() {
    // Never dismiss the whole sheet while a nested action modal is open.
    if (closing || actionModalOpen) return;
    closing = true;
    dragging = false;
    window.setTimeout(() => {
      previousFocus?.focus?.();
      onClose();
    }, reduceMotion ? 0 : CLOSE_MS);
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleBack();
      return;
    }
    // Keep Tab cycling within the sheet (focus trap).
    if (e.key === "Tab") {
      const focusables = sheetEl?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (closing) return;
    // Never hijack buttons (Close, history toggles) or start mid-scroll.
    if ((e.target as HTMLElement).closest("button")) return;
    if (bodyEl && bodyEl.scrollTop > 0) return;
    dragging = true;
    dragStartY = e.clientY;
    dragOffset = 0;
    dragPointerId = e.pointerId;
    sheetEl.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    const dy = e.clientY - dragStartY;
    dragOffset = Math.max(0, dy * 0.55);
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    if (dragOffset > 110) {
      close();
    } else {
      dragOffset = 0;
    }
  }
</script>

{#snippet boarderCard(b: Boarder)}
  <article class="boarder-card">
    <div class="boarder-head">
      <h3>{b.name}</h3>
      <span class="pay-badge pay-{statusOf(b)}"><span class="pay-dot"></span>{statusLabel(b)}</span>
    </div>

    {#if b.contact}
      <p class="boarder-contact">📞 {b.contact}</p>
    {/if}

    <dl class="boarder-facts">
      <div>
        <dt>Move-in</dt>
        <dd>{formatDate(b.move_in_date)}</dd>
      </div>
      <div>
        <dt>Next due</dt>
        <dd>{formatDate(b.due_date)}</dd>
      </div>
      <div>
        <dt>Monthly rate</dt>
        <dd>{phpPeso(b.monthly_rate ?? room.monthly_rate)}</dd>
      </div>
      {#if b.advance_held + b.deposit_held > 0}
        <div>
          <dt>Held</dt>
          <dd>
            {phpPesoPrecise(b.advance_held + b.deposit_held)}
            {#if b.advance_held > 0 && b.deposit_held > 0}
              · {phpPesoPrecise(b.advance_held)} adv · {phpPesoPrecise(b.deposit_held)} dep
            {:else if b.advance_held > 0}
              · advance
            {/if}
            {#if b.deposit_refunded === 1}
              · Refunded
            {/if}
          </dd>
        </div>
      {/if}
      {#if b.last_paid_date}
        <div>
          <dt>Last paid</dt>
          <dd>{formatDate(b.last_paid_date)}</dd>
        </div>
      {/if}
    </dl>

    <div class="boarder-actions">
      <button type="button" class="btn btn-small btn-paid" onclick={() => (payTarget = b)}>
        Record Payment
      </button>
      {#if b.advance_held + b.deposit_held > 0}
        <button type="button" class="btn btn-small" onclick={() => (applyTarget = b)}>
          Apply held balance ({phpPesoPrecise(b.advance_held + b.deposit_held)})
        </button>
      {/if}
      <button type="button" class="btn btn-small btn-danger" onclick={() => (moveOutTarget = b)}>
        Move Out
      </button>
    </div>

    <div class="history-block">
      <button
        type="button"
        class="history-toggle"
        aria-expanded={expanded[b.id] === true}
        onclick={() => toggleHistory(b)}
      >
        <span>Payment history</span>
        <span class="history-chevron">{expanded[b.id] === true ? "▾" : "▸"}</span>
      </button>
      {#if expanded[b.id] === true}
        {#if historyLoading[b.id]}
          <p class="muted history-note">Loading payment history…</p>
        {:else if historyErrors[b.id]}
          <p class="form-error history-note">{historyErrors[b.id]}</p>
        {:else if (histories[b.id] ?? []).length === 0}
          <p class="muted history-note">No payments recorded yet.</p>
        {:else}
          <ul class="history-list">
            {#each histories[b.id] ?? [] as g (g.receipt_no)}
              <li class="history-item">
                <div class="history-info">
                  <span class="history-date">{formatDate(g.paid_date)}</span>
                  <span class="history-due">
                    {#if g.count === 1 && g.first_month && g.due_date && monthKeyOf(g.due_date) === g.first_month}
                      Due {formatDate(g.due_date)}
                    {:else}
                      {formatMonthRange(g.first_month, g.last_month)}
                    {/if}
                  </span>
                </div>
                <div class="history-side">
                  <span class="history-amount">{phpPesoPrecise(g.total)}</span>
                  {#if g.method !== "cash" && g.method !== "—"}
                    <span class="history-method">{g.method}</span>
                  {/if}
                  <button
                    type="button"
                    class="btn btn-small history-edit"
                    onclick={() => openEditGroup(b, g.receipt_no)}
                  >
                    Edit
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </article>
{/snippet}

<div
  class="sheet-backdrop"
  class:closing
  role="presentation"
  onclick={onBackdropClick}
>
  <div
    bind:this={sheetEl}
    class="sheet"
    class:closing
    class:dragging
    role="dialog"
    aria-modal="true"
    aria-label={`${roomLabel(room.room_number)} details`}
    tabindex="-1"
    style:transform={dragging ? `translateY(${dragOffset}px)` : ""}
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKeydown}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <div class="grabber" aria-hidden="true"></div>

    <header class="sheet-header">
      {#if selected}
        <button type="button" class="btn sheet-back" onclick={() => (selected = null)} aria-label="Back to beds">‹</button>
      {/if}
      <div class="sheet-title">
        <h2>{selected ? selected.name : room.room_number}</h2>
        <p class="sheet-subtitle">
          {#if selected}
            {roomLabel(room.room_number)} · {phpPeso(room.monthly_rate)}/month
          {:else}
            {room.occupied_beds}/{room.capacity} bed{room.occupied_beds === 1 ? "" : "s"} occupied
            {#if room.held_beds > 0}
              · +{room.held_beds} held
            {/if}
            · {phpPeso(room.monthly_rate)}/month
          {/if}
        </p>
      </div>
      <span class="badge {badgeClass(room.status)}">{room.status}</span>
      <button type="button" class="btn sheet-close" onclick={close} aria-label="Close">✕</button>
    </header>

    <div class="sheet-body" bind:this={bodyEl}>
      {#if loading}
        <p class="muted sheet-note">Loading boarders…</p>
      {:else if loadError}
        <p class="form-error sheet-note">{loadError}</p>
      {:else if selected}
        {@const b = selected}
        <div class="tenant-detail">
          <div class="beds-control">
            <div class="beds-info">
              <span class="beds-label">Beds occupied</span>
              <span class="beds-free" class:full={roomFree === 0}>
                · {roomFree} bed{roomFree === 1 ? "" : "s"} free
              </span>
            </div>
            <div class="beds-stepper-row">
              <div class="beds-stepper">
                <button
                  type="button"
                  class="step-btn"
                  onclick={() => (bedsDraft = Math.max(1, bedsDraft - 1))}
                  disabled={bedsDraft <= 1}
                  aria-label="Fewer beds"
                >−</button>
                <span class="beds-value">{bedsDraft}</span>
                <button
                  type="button"
                  class="step-btn"
                  onclick={() => (bedsDraft = Math.min(maxBeds, bedsDraft + 1))}
                  disabled={bedsDraft >= maxBeds}
                  aria-label="More beds"
                >+</button>
              </div>
              <button
                type="button"
                class="btn btn-small btn-primary"
                onclick={applyBeds}
                disabled={bedsDraft === b.beds_occupied || savingBeds}
              >
                {savingBeds ? "Saving…" : "Apply"}
              </button>
            </div>
          </div>
          {@render boarderCard(b)}
        </div>
      {:else if boarders.length === 0 && reservations.length === 0}
        <div class="sheet-empty">
          <p class="empty-emoji">🛏️</p>
          <p class="empty-title">No boarders yet</p>
          <p class="empty-sub">This room has no tenants assigned. Add a tenant from the Tenants tab and their details will show up here.</p>
        </div>
      {:else}
        <div class="bed-grid" aria-label="Beds">
          {#each buildBedBoxes(boarders, room.capacity, room.held_beds) as box (box.key)}
            {#if box.kind === "tenant"}
              <button type="button" class="bed-box" onclick={() => openTenant(box.tenantId)}>
                <span class="bed-name">{box.name}</span>
                {#if box.tag}
                  <span class="bed-tag" class:bed-tag-whole={box.wholeRoom}>{box.tag}</span>
                {/if}
              </button>
            {:else if box.kind === "held"}
              <span class="bed-box bed-held">Held</span>
            {:else}
              <span class="bed-box bed-vacant">Vacant</span>
            {/if}
          {/each}
        </div>

        {#if reservations.length > 0}
          <h3 class="section-heading">Reserved guests</h3>
          {#each reservations as r (r.id)}
            <article class="boarder-card reserved-card">
              <div class="boarder-head">
                <h3>{r.name}</h3>
                <span class="reserved-badge">{r.hold_type === "whole" ? "Whole room" : r.hold_type === "bed" ? "1 bed" : `${r.bed_count ?? 0} beds`}</span>
              </div>

              {#if r.contact}
                <p class="boarder-contact">📞 {r.contact}</p>
              {/if}

              <dl class="boarder-facts">
                <div>
                  <dt>Holding deposit</dt>
                  <dd>{r.deposit != null ? phpPesoPrecise(r.deposit) : "—"}</dd>
                </div>
                <div>
                  <dt>Target move-in</dt>
                  <dd>{formatDate(r.target_move_in_date)}</dd>
                </div>
                <div>
                  <dt>Reserved on</dt>
                  <dd>{formatDate(r.reservation_date)}</dd>
                </div>
              </dl>
            </article>
          {/each}
        {/if}
      {/if}
    </div>
  </div>

  {#if payTarget}
    {@const t = toTenant(payTarget)}
    <PayModal
      tenant={t}
      rooms={payRooms}
      onConfirm={confirmPay}
      onApplyBalance={() => {
        applyTarget = payTarget;
        payTarget = null;
      }}
      onClose={closePay}
    />
  {/if}

  {#if applyTarget}
    {@const t = toTenant(applyTarget)}
    <ApplyBalanceModal tenant={t} rooms={payRooms} onApply={confirmApply} onClose={closeApply} />
  {/if}

  {#if moveOutTarget}
    {@const t = toTenant(moveOutTarget)}
    <MoveOutModal tenant={t} onConfirm={confirmMoveOut} onClose={closeMoveOut} />
  {/if}

  {#if editTarget}
    {@const t = editTarget}
    <EditPayModal
      tenant={t.tenant}
      rooms={payRooms}
      rows={t.rows}
      onSave={(opts) => confirmEdit(t.tenant, opts)}
      onClose={closeEdit}
    />
  {/if}

  {#if depositPrompt}
    <DepositRefundModal tenant={depositPrompt} onRefund={markDepositRefunded} onClose={closeDeposit} />
  {/if}

  {#if receiptTarget}
    {@const t = receiptTarget}
    <ReceiptModal
      tenant={t.tenant}
      rows={t.rows}
      recorded={t.recorded}
      onEdit={() => {
        // The editor replaces the receipt (both modals share a z-index, so
        // only one can be up at a time). Saving shows the corrected receipt.
        // Snapshot before clearing: `t` is derived from `receiptTarget`, so
        // nulling it first would make `t` null in here.
        const { tenant, rows } = t;
        receiptTarget = null;
        editTarget = { tenant, rows };
      }}
      onClose={closeReceipt}
    />
  {/if}
</div>

<style>
  /* ---- overlay ---- */
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 14px;
    background: rgba(0, 0, 0, 0.35);
    transition: background-color 0.25s ease;
  }
  .sheet-backdrop.closing {
    background: rgba(0, 0, 0, 0);
  }
  @starting-style {
    .sheet-backdrop {
      background: rgba(0, 0, 0, 0);
    }
  }
  /* Guarded by the :root data-theme override (src/lib/theme.ts) in addition
     to the OS setting. */
  :global(:root[data-theme="dark"]) .sheet-backdrop {
    background: rgba(0, 0, 0, 0.5);
  }
  :global(:root[data-theme="dark"]) .sheet-backdrop.closing {
    background: rgba(0, 0, 0, 0);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .sheet-backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
    :global(:root:not([data-theme="light"])) .sheet-backdrop.closing {
      background: rgba(0, 0, 0, 0);
    }
  }

  /* ---- sheet: near-fullscreen panel sliding up from the bottom ---- */
  .sheet {
    width: 100%;
    max-width: 760px;
    height: calc(100vh - 28px);
    max-height: 900px;
    background: var(--card);
    border-radius: 22px;
    box-shadow: var(--shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
    transform: translateY(0);
    transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
    will-change: transform;
  }
  .sheet.dragging {
    transition: none;
  }
  .sheet.closing {
    transform: translateY(110%);
  }
  @starting-style {
    .sheet {
      transform: translateY(110%);
    }
  }

  .grabber {
    flex-shrink: 0;
    width: 44px;
    height: 5px;
    border-radius: 999px;
    background: var(--separator);
    margin: 10px auto 0;
  }

  /* ---- header (sticky) ---- */
  .sheet-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 18px 14px;
    border-bottom: 1px solid var(--separator);
    flex-shrink: 0;
  }
  .sheet-title {
    flex: 1;
    min-width: 0;
  }
  .sheet-title h2 {
    margin: 0;
    font-size: 1.25rem;
    letter-spacing: -0.02em;
  }
  .sheet-subtitle {
    margin: 2px 0 0;
    color: var(--label-2);
    font-size: 0.85rem;
  }
  .sheet-close {
    border-radius: 999px;
    padding: 8px 13px;
    flex-shrink: 0;
  }

  /* ---- scrollable body ---- */
  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px;
  }
  .sheet-note {
    margin: 8px 0;
  }

  /* ---- empty state ---- */
  .sheet-empty {
    text-align: center;
    padding: 56px 16px;
  }
  .empty-emoji {
    margin: 0 0 10px;
    font-size: 2.4rem;
  }
  .empty-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
  }
  .empty-sub {
    margin: 6px 0 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  /* ---- section headings (reserved guests vs boarders) ---- */
  .section-heading {
    margin: 0 0 8px;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--label-3);
  }

  /* ---- reserved-guest cards (amber accent, mirrors the Reserved badge) ---- */
  .reserved-card {
    border-color: rgba(255, 149, 0, 0.35);
  }
  .reserved-badge {
    background: var(--amber-soft);
    color: var(--amber-deep);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* ---- boarder sections ---- */
  .boarder-card {
    border: 1px solid var(--separator);
    border-radius: 14px;
    background: var(--fill);
    padding: 14px;
    margin-bottom: 12px;
  }
  .boarder-card:last-child {
    margin-bottom: 0;
  }
  .boarder-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .boarder-head h3 {
    margin: 0;
    font-size: 1.05rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .boarder-contact {
    margin: 6px 0 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .boarder-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px 16px;
    margin: 12px 0 0;
  }
  .boarder-facts div {
    min-width: 0;
  }
  .boarder-facts dt {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--label-3);
  }
  .boarder-facts dd {
    margin: 2px 0 0;
    font-size: 0.92rem;
    font-weight: 600;
  }

  /* ---- payment status badge (color dot + label) ---- */
  .pay-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .pay-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .pay-green {
    background: var(--green-soft);
    color: var(--green-deep);
  }
  .pay-yellow {
    background: var(--amber-soft);
    color: var(--amber-deep);
  }
  .pay-red {
    background: var(--red-soft);
    color: var(--red-deep);
  }
  .pay-green .pay-dot {
    background: var(--green);
  }
  .pay-yellow .pay-dot {
    background: var(--amber);
  }
  .pay-red .pay-dot {
    background: var(--red);
  }

  /* ---- quick actions (record payment / move out) ---- */
  .boarder-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .boarder-actions .btn-paid {
    flex: 1;
    min-width: 130px;
  }

  /* ---- expandable payment history ---- */
  .history-block {
    margin-top: 12px;
    border-top: 1px solid var(--separator);
    padding-top: 10px;
  }
  .history-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    padding: 4px 0;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--label-2);
    cursor: pointer;
    transition: color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .history-toggle:hover {
    color: var(--accent);
  }
  .history-chevron {
    font-size: 0.7rem;
  }
  .history-note {
    margin: 8px 0 0;
    font-size: 0.85rem;
    font-style: italic;
  }
  .history-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--card);
    border: 1px solid var(--separator);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .history-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .history-date {
    font-weight: 700;
    font-size: 0.85rem;
  }
  .history-due {
    color: var(--label-3);
    font-size: 0.78rem;
  }
  .history-side {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .history-amount {
    color: var(--accent);
    font-weight: 700;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .history-method {
    color: var(--amber-deep);
    background: var(--amber-soft);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.7rem;
    font-weight: 700;
    white-space: nowrap;
  }

  /* ---- level-1 back button (level 2 header) ---- */
  .sheet-back {
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 1.15rem;
    line-height: 1;
    flex-shrink: 0;
  }

  /* ---- level-1 bed grid (one box per slot) ---- */
  .bed-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }

  .bed-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 7px;
    min-height: 74px;
    padding: 12px;
    border: 1px solid var(--separator);
    border-radius: 12px;
    background: var(--fill);
    text-align: left;
    font-family: inherit;
    color: var(--label);
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .bed-box:hover:not(.bed-vacant):not(.bed-held) {
    border-color: var(--accent);
  }
  .bed-box:active {
    transform: scale(0.98);
  }
  .bed-box:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .bed-name {
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  /* tag on every box of a multi-bed tenant: "Occupies N beds" / "Whole Room" */
  .bed-tag {
    background: var(--accent-soft);
    color: var(--accent-deep);
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 0.7rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .bed-tag-whole {
    background: var(--amber-soft);
    color: var(--amber-deep);
  }

  /* inert dashed boxes for held / free slots */
  .bed-held,
  .bed-vacant {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px dashed var(--separator);
    background: none;
    color: var(--label-3);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: default;
  }
  .bed-held {
    border-color: rgba(255, 149, 0, 0.45);
    color: var(--amber-deep);
  }
  .bed-vacant:hover {
    border-color: var(--separator);
  }

  /* ---- level-2 bed-count control ---- */
  .tenant-detail {
    min-width: 0;
  }

  .beds-control {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    margin-bottom: 12px;
    border: 1px solid var(--separator);
    border-radius: 12px;
    background: var(--fill);
  }

  .beds-info {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 0.85rem;
  }
  .beds-label {
    font-weight: 700;
  }
  .beds-free {
    color: var(--label-3);
  }
  .beds-free.full {
    color: var(--red-deep);
    font-weight: 700;
  }

  .beds-stepper-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .beds-stepper {
    display: flex;
    align-items: center;
    border: 1px solid var(--separator);
    border-radius: 999px;
    overflow: hidden;
    background: var(--card);
  }
  .step-btn {
    width: 38px;
    height: 38px;
    border: none;
    background: none;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--accent);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .step-btn:hover:not(:disabled) {
    background: var(--fill);
  }
  .step-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .beds-value {
    min-width: 46px;
    text-align: center;
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* ---- reduced motion: keep state changes, drop movement ---- */
  @media (prefers-reduced-motion: reduce) {
    .sheet-backdrop,
    .sheet {
      transition: none;
    }
    @starting-style {
      .sheet-backdrop {
        background: rgba(0, 0, 0, 0.35);
      }
      .sheet {
        transform: translateY(0);
      }
    }
  }
</style>
