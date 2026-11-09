<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db/db";
  import { pushToast } from "$lib/ui/toast.svelte";
  import { pushOverlay } from "$lib/ui/back-stack";
  import Icon from "$lib/ui/Icon.svelte";
  import BedDouble from "@lucide/svelte/icons/bed-double";
  import type { BoarderSheetRoom } from "$lib/rooms/rooms";
  import type { PaymentRecord, Tenant } from "$lib/tenants/types";
  import {
    loadRoomBoarders,
    payRoomsFor,
    type Boarder,
    type ReservedGuest,
  } from "./boarders";
  import { createSheetDismiss } from "./sheet-dismiss.svelte";
  import { createHistoryCache } from "./history-cache.svelte";
  import { createPaymentFlows, type EditTarget, type ReceiptTarget } from "./room-sheet-payment-flows";
  import { setBoarderBeds } from "./room-sheet-actions";
  import RoomSheetShell from "./RoomSheetShell.svelte";
  import BoarderCard from "./BoarderCard.svelte";
  import BedGrid from "./BedGrid.svelte";
  import TenantBedsControl from "./TenantBedsControl.svelte";
  import ReservedGuestList from "./ReservedGuestList.svelte";
  import SheetActionModals from "./SheetActionModals.svelte";

  let {
    room,
    onClose,
    onDataChanged,
  }: {
    room: BoarderSheetRoom;
    onClose: () => void;
    /**
     * Called after any successful mutation (payment, edit, apply, bed count,
     * move-out, deposit refund) so the page can refresh in place without a tab
     * switch (dashboard-mobile-polish-spec §3).
     */
    onDataChanged?: () => void;
  } = $props();

  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  let editTarget: EditTarget | null = $state(null);
  let receiptTarget: ReceiptTarget | null = $state(null);

  const history = createHistoryCache();

  let previousFocus: HTMLElement | null = null;
  let sheetEl = $state<HTMLElement | undefined>();
  let bodyEl = $state<HTMLElement | undefined>();

  /** True while one of the nested action modals (Pay / Apply / Edit / Move Out / etc.) is up. */
  const actionModalOpen = $derived(!!(payTarget || applyTarget || moveOutTarget || depositPrompt || editTarget || receiptTarget));

  const payRooms = $derived(payRoomsFor(room));

  const flows = createPaymentFlows({
    room,
    setReceipt: (target) => (receiptTarget = target),
    getEdit: () => editTarget,
    clearEdit: () => (editTarget = null),
    setDeposit: (tenant) => (depositPrompt = tenant),
    setEditTarget: (target) => (editTarget = target),
    afterChange,
    findBoarder: (id) => boarders.find((x) => x.id === id),
    reloadHistory: async (b) => {
      const db = await getDb();
      await history.reload(db, b);
    },
    toast: (message, kind) => pushToast(message, kind),
  });

  const dismiss = createSheetDismiss({
    reduceMotion,
    isBlocked: () => actionModalOpen,
    onBack: handleBack,
    onDismissed: () => {
      previousFocus?.focus?.();
      onClose();
    },
    sheet: () => sheetEl,
    body: () => bodyEl,
  });

  // Nested modals hand focus back to the sheet when they close.
  function closeModal(which: "pay" | "apply" | "moveOut" | "edit" | "deposit" | "receipt") {
    if (which === "pay") payTarget = null;
    else if (which === "apply") applyTarget = null;
    else if (which === "moveOut") moveOutTarget = null;
    else if (which === "edit") editTarget = null;
    else if (which === "deposit") depositPrompt = null;
    else receiptTarget = null;
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
      const loaded = await loadRoomBoarders(db, room.id);
      boarders = loaded.boarders;
      reservations = loaded.reservations;
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

  /** Every mutation ends the same way: reload, re-point level 2, tell the page. */
  async function afterChange() {
    await loadBoarders();
    refreshSelected();
    onDataChanged?.();
  }

  /** Persist the bed count; the DB trigger (v057) backs up the same guard. */
  async function applyBeds() {
    const b = selected;
    if (!b || bedsDraft === b.beds_occupied) return;
    try {
      savingBeds = true;
      const db = await getDb();
      await setBoarderBeds(db, b.id, bedsDraft);
      pushToast(`${b.name} now occupies ${bedsDraft} bed${bedsDraft === 1 ? "" : "s"}`, "success");
      await afterChange();
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
    if (dismiss.closing || actionModalOpen) return;
    if (selected) {
      selected = null;
      return;
    }
    dismiss.close();
  }

  async function toggleSelectedHistory() {
    if (!selected) return;
    const db = await getDb();
    await history.toggle(db, selected);
  }

  /** Pay → Apply hand-off for the nested modal stack. */
  function applyFromPay() {
    applyTarget = payTarget;
    payTarget = null;
  }

  function onEditReceipt() {
    // The editor replaces the receipt (both modals share a z-index, so only one
    // can be up at a time). Saving shows the corrected receipt. Snapshot before
    // clearing: `receiptTarget` is read by the child.
    const target = receiptTarget;
    if (!target) return;
    receiptTarget = null;
    editTarget = { tenant: target.tenant, rows: target.rows };
  }
</script>

<RoomSheetShell
  {room}
  selectedName={selected ? selected.name : null}
  closing={dismiss.closing}
  dragging={dismiss.dragging}
  dragOffset={dismiss.dragOffset}
  onBack={() => (selected = null)}
  onClose={dismiss.close}
  onBackdropClick={dismiss.onBackdropClick}
  onKeydown={dismiss.onKeydown}
  onPointerDown={dismiss.onPointerDown}
  onPointerMove={dismiss.onPointerMove}
  onPointerUp={dismiss.onPointerUp}
  bind:sheetEl
  bind:bodyEl
>
  {#if loading}
    <p class="muted sheet-note">Loading boarders…</p>
  {:else if loadError}
    <p class="form-error sheet-note">{loadError}</p>
  {:else if selected}
    <div class="tenant-detail">
      <TenantBedsControl
        bedsOccupied={selected.beds_occupied}
        bind:bedsDraft
        {maxBeds}
        {roomFree}
        {savingBeds}
        onApply={applyBeds}
      />
      <BoarderCard
        boarder={selected}
        roomMonthlyRate={room.monthly_rate}
        expanded={history.expanded[selected.id] === true}
        historyLoading={history.loading[selected.id] === true}
        historyError={history.errors[selected.id]}
        historyGroups={history.groups[selected.id]}
        onToggleHistory={toggleSelectedHistory}
        onPay={() => (payTarget = selected)}
        onApply={() => (applyTarget = selected)}
        onMoveOut={() => (moveOutTarget = selected)}
        onEditPayment={(receiptNo) => {
          if (selected) void flows.openEditGroup(selected, receiptNo);
        }}
      />
    </div>
  {:else if boarders.length === 0 && reservations.length === 0}
    <div class="sheet-empty">
      <p class="empty-icon"><Icon icon={BedDouble} size={24} /></p>
      <p class="empty-title">No boarders yet</p>
      <p class="empty-sub">This room has no tenants assigned. Add a tenant from the Tenants tab and their details will show up here.</p>
    </div>
  {:else}
    <BedGrid {boarders} capacity={room.capacity} heldBeds={room.held_beds} onOpenTenant={openTenant} />
    <ReservedGuestList {reservations} />
  {/if}
</RoomSheetShell>

<SheetActionModals
  {room}
  {payRooms}
  {payTarget}
  {applyTarget}
  {moveOutTarget}
  {depositPrompt}
  {editTarget}
  {receiptTarget}
  onConfirmPay={flows.confirmPay}
  onConfirmApply={flows.confirmApply}
  onConfirmMoveOut={flows.confirmMoveOut}
  onConfirmEdit={flows.confirmEdit}
  onRefundDeposit={flows.markDepositRefunded}
  onClosePay={() => closeModal("pay")}
  onCloseApply={() => closeModal("apply")}
  onCloseMoveOut={() => closeModal("moveOut")}
  onCloseEdit={() => closeModal("edit")}
  onCloseDeposit={() => closeModal("deposit")}
  onCloseReceipt={() => closeModal("receipt")}
  onEditReceipt={onEditReceipt}
  onApplyFromPay={applyFromPay}
/>

<style>
  .sheet-note {
    margin: 8px 0;
  }

  /* ---- empty state ---- */
  .sheet-empty {
    text-align: center;
    padding: 56px 16px;
  }
  .empty-icon {
    display: flex;
    justify-content: center;
    margin: 0 0 10px;
    color: var(--label-3);
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

  .tenant-detail {
    min-width: 0;
  }
</style>
