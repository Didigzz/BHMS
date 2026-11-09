<script lang="ts">
  import PayModal from "$lib/tenants/PayModal.svelte";
  import ApplyBalanceModal from "$lib/tenants/ApplyBalanceModal.svelte";
  import EditPayModal from "$lib/tenants/EditPayModal.svelte";
  import MoveOutModal from "$lib/tenants/MoveOutModal.svelte";
  import DepositRefundModal from "$lib/tenants/DepositRefundModal.svelte";
  import ReceiptModal from "$lib/tenants/ReceiptModal.svelte";
  import type { PaymentEditOptions } from "$lib/tenants/tenant-actions";
  import type { PaymentRecord, Room as TenantRoom, Tenant } from "$lib/tenants/types";
  import type { BoarderSheetRoom } from "$lib/rooms/rooms";
  import { toTenant, type Boarder } from "./boarders";

  /**
   * The stack of action modals the sheet can raise (Pay / Apply / Move Out /
   * Edit / Deposit / Receipt). Each is mounted only while its target is set.
   */
  let {
    room,
    payRooms,
    payTarget,
    applyTarget,
    moveOutTarget,
    depositPrompt,
    editTarget,
    receiptTarget,
    onConfirmPay,
    onConfirmApply,
    onConfirmMoveOut,
    onConfirmEdit,
    onRefundDeposit,
    onClosePay,
    onCloseApply,
    onCloseMoveOut,
    onCloseEdit,
    onCloseDeposit,
    onCloseReceipt,
    onEditReceipt,
    onApplyFromPay,
  }: {
    room: BoarderSheetRoom;
    payRooms: TenantRoom[];
    payTarget: Boarder | null;
    applyTarget: Boarder | null;
    moveOutTarget: Boarder | null;
    depositPrompt: Tenant | null;
    editTarget: { tenant: Tenant; rows: PaymentRecord[] } | null;
    receiptTarget: { tenant: Tenant; rows: PaymentRecord[]; recorded: boolean } | null;
    onConfirmPay: (
      tenant: Tenant,
      amount: number,
      method: string,
      paidDate: string,
      coveredDueDate: string,
      nextDueDate: string,
    ) => Promise<string | null>;
    onConfirmApply: (tenant: Tenant, coveredDueDate: string) => Promise<string | null>;
    onConfirmMoveOut: (tenant: Tenant) => Promise<void>;
    onConfirmEdit: (tenant: Tenant, options: PaymentEditOptions) => Promise<string | null>;
    onRefundDeposit: (tenant: Tenant) => Promise<void>;
    onClosePay: () => void;
    onCloseApply: () => void;
    onCloseMoveOut: () => void;
    onCloseEdit: () => void;
    onCloseDeposit: () => void;
    onCloseReceipt: () => void;
    onEditReceipt: () => void;
    /** Pay → Apply: hand the same boarder to the held-balance modal. */
    onApplyFromPay: () => void;
  } = $props();
</script>

{#if payTarget}
  {@const t = toTenant(payTarget, room)}
  <PayModal
    tenant={t}
    rooms={payRooms}
    onConfirm={onConfirmPay}
    onApplyBalance={onApplyFromPay}
    onClose={onClosePay}
  />
{/if}

{#if applyTarget}
  {@const t = toTenant(applyTarget, room)}
  <ApplyBalanceModal tenant={t} rooms={payRooms} onApply={onConfirmApply} onClose={onCloseApply} />
{/if}

{#if moveOutTarget}
  {@const t = toTenant(moveOutTarget, room)}
  <MoveOutModal tenant={t} onConfirm={onConfirmMoveOut} onClose={onCloseMoveOut} />
{/if}

{#if editTarget}
  {@const t = editTarget}
  <EditPayModal
    tenant={t.tenant}
    rooms={payRooms}
    rows={t.rows}
    onSave={(options) => onConfirmEdit(t.tenant, options)}
    onClose={onCloseEdit}
  />
{/if}

{#if depositPrompt}
  <DepositRefundModal tenant={depositPrompt} onRefund={onRefundDeposit} onClose={onCloseDeposit} />
{/if}

{#if receiptTarget}
  {@const t = receiptTarget}
  <ReceiptModal
    tenant={t.tenant}
    rows={t.rows}
    recorded={t.recorded}
    onEdit={onEditReceipt}
    onClose={onCloseReceipt}
  />
{/if}
