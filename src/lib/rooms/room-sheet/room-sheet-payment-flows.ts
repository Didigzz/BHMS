import { getDb } from "$lib/db/db";
import { phpPeso } from "$lib/ui/format";
import type { BoarderSheetRoom } from "$lib/rooms/rooms";
import type { PaymentRecord, Tenant } from "$lib/tenants/types";
import type { PaymentEditOptions } from "$lib/tenants/tenant-actions";
import { loadGroupRows, toTenant, type Boarder } from "./boarders";
import {
  applyHeldToMonth,
  markBoarderMovedOut,
  payBoarder,
  refundBoarderDeposit,
  updateBoarderPayment,
} from "./room-sheet-actions";

/**
 * Payment / edit / move-out / apply / refund flows for the room sheet. The
 * sheet supplies its targets and refresh, so these keep the money rules and the
 * receipt hand-off together instead of spreading them through the component.
 */

export interface ReceiptTarget {
  tenant: Tenant;
  rows: PaymentRecord[];
  recorded: boolean;
}

export interface EditTarget {
  tenant: Tenant;
  rows: PaymentRecord[];
}

export interface PaymentFlowDeps {
  room: BoarderSheetRoom;
  setReceipt: (target: ReceiptTarget) => void;
  getEdit: () => EditTarget | null;
  setEditTarget: (target: EditTarget) => void;
  clearEdit: () => void;
  setDeposit: (tenant: Tenant | null) => void;
  afterChange: () => Promise<void>;
  findBoarder: (id: number) => Boarder | undefined;
  reloadHistory: (b: Boarder) => Promise<void>;
  toast: (message: string, kind: "success" | "error" | "info") => void;
}

export function createPaymentFlows(deps: PaymentFlowDeps) {
  /** Record a payment, then show the receipt and refresh the boarders. */
  async function confirmPay(
    tenant: Tenant,
    amount: number,
    method: string,
    paidDate: string,
    coveredDueDate: string,
    nextDueDate: string,
  ): Promise<string | null> {
    try {
      const db = await getDb();
      const result = await payBoarder(
        db,
        deps.room,
        tenant,
        amount,
        method,
        paidDate,
        coveredDueDate,
        nextDueDate,
      );
      if ("error" in result) return result.error;
      deps.toast(`Payment recorded — ${phpPeso(amount)}`, "success");
      // Success banner on the receipt — it IS the confirmation screen.
      deps.setReceipt({ tenant, rows: result.rows, recorded: true });
      await deps.afterChange();
      return null;
    } catch (e) {
      const message = `Failed to record payment: ${String(e)}`;
      deps.toast(message, "error");
      return message;
    }
  }

  /** Open the edit flow for one payment transaction (inline history row). */
  async function openEditGroup(boarder: Boarder, receiptNo: string) {
    try {
      const db = await getDb();
      const rows = await loadGroupRows(db, boarder.id, receiptNo);
      if (rows.length === 0) {
        deps.toast("Payment not found — it may have been deleted.", "error");
        return;
      }
      deps.setEditTarget({ tenant: toTenant(boarder, deps.room), rows });
    } catch (e) {
      deps.toast(`Failed to load payment: ${String(e)}`, "error");
    }
  }

  /** Apply an edit; error message or null. On success the corrected receipt shows. */
  async function confirmEdit(tenant: Tenant, options: PaymentEditOptions): Promise<string | null> {
    try {
      const target = deps.getEdit();
      if (!target) return "No payment selected.";
      const db = await getDb();
      const receiptNo = target.rows[0]?.receipt_no ?? "";
      const result = await updateBoarderPayment(db, deps.room, tenant, receiptNo, options);
      if ("error" in result) return result.error;
      const amount = result.rows.reduce((sum, r) => sum + r.amount, 0);
      deps.clearEdit();
      deps.toast(`Payment updated — ${phpPeso(amount)}`, "success");
      // Show the corrected receipt right after saving, then refresh the boarder.
      deps.setReceipt({ tenant, rows: result.rows, recorded: false });
      await deps.afterChange();
      const boarder = deps.findBoarder(tenant.id);
      if (boarder) await deps.reloadHistory(boarder);
      return null;
    } catch (e) {
      const message = `Failed to update payment: ${String(e)}`;
      deps.toast(message, "error");
      return message;
    }
  }

  /** Mark a boarder as moved out; offer the deposit refund if outstanding. */
  async function confirmMoveOut(tenant: Tenant): Promise<void> {
    try {
      const db = await getDb();
      const outcome = await markBoarderMovedOut(db, tenant);
      deps.toast(`${tenant.name} marked as moved out`, "success");
      if (outcome.refundAllowed && tenant.deposit_held > 0 && tenant.deposit_refunded === 0) {
        deps.setDeposit(tenant);
      } else if (!outcome.refundAllowed && outcome.held > 0) {
        deps.toast(
          `${tenant.name} moved out — ${phpPeso(outcome.held)} held. Apply it to cover unpaid months.`,
          "info",
        );
      }
      await deps.afterChange();
    } catch (e) {
      deps.toast(`Failed to mark as moved out: ${String(e)}`, "error");
    }
  }

  /** Apply held balance to cover one due date; error message or null. */
  async function confirmApply(tenant: Tenant, coveredDueDate: string): Promise<string | null> {
    try {
      const db = await getDb();
      const result = await applyHeldToMonth(db, deps.room, tenant, coveredDueDate);
      if ("error" in result) return result.error;
      const amount = result.rows.reduce((sum, r) => sum + r.amount, 0);
      deps.toast(`Applied ${phpPeso(amount)} from held balance`, "success");
      // Success banner on the receipt — it IS the confirmation screen.
      deps.setReceipt({ tenant, rows: result.rows, recorded: true });
      await deps.afterChange();
      return null;
    } catch (e) {
      const message = `Failed to apply held balance: ${String(e)}`;
      deps.toast(message, "error");
      return message;
    }
  }

  /** Mark a deposit refunded, then refresh the boarders. */
  async function markDepositRefunded(tenant: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await refundBoarderDeposit(db, tenant.id);
      deps.setDeposit(null);
      deps.toast(`Deposit refunded — ${tenant.name}`, "success");
      await deps.afterChange();
    } catch (e) {
      deps.toast(`Failed to update deposit: ${String(e)}`, "error");
    }
  }

  return { confirmPay, openEditGroup, confirmEdit, confirmMoveOut, confirmApply, markDepositRefunded };
}
