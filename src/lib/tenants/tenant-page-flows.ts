import { getDb } from "$lib/db/db";
import { getSetting } from "$lib/db/settings";
import { phpPeso } from "$lib/ui/format";
import { pushToast } from "$lib/ui/toast.svelte";
import { heldBalanceOf } from "$lib/tenants/held-balance";
import { countAmenityBillsForTenant } from "$lib/amenities/amenity-actions";
import {
  applyHeldBalance,
  markMovedOut,
  recordPayment,
  refundDeposit,
  updatePayment,
  type PaymentEditOptions,
} from "$lib/tenants/tenant-actions";
import type { PaymentRecord, Room, Tenant, TenantFormState } from "$lib/tenants/types";

/** The rows a receipt modal shows: one transaction, or the rows just written. */
export interface ReceiptTarget {
  tenant: Tenant;
  rows: PaymentRecord[];
  recorded: boolean;
}

/**
 * The tenants page's write flows (save, pay, edit, apply balance, move out,
 * refund, delete). Every handler returns `null` on success or an error message
 * for the caller's modal, and owns its own toast — the page only supplies the
 * data and shows what the flow asks for.
 */
export function createTenantPageFlows(ctx: {
  getRooms: () => Room[];
  getAll: () => Tenant[];
  reload: () => Promise<void>;
  /** An open Payment History modal holds its own snapshot — tell it to reload. */
  historyChanged: () => void;
  showReceipt: (receipt: ReceiptTarget) => void;
  promptDepositRefund: (tenant: Tenant | null) => void;
  clearMoveOut: () => void;
  /** The edit modal is closing after a successful save. */
  clearEdit: () => void;
  /** Confirmed permanent deletion is ready to show its warning dialog. */
  askDelete: (tenant: Tenant | null) => void;
  reportError: (message: string) => void;
}) {
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
      const room = ctx.getRooms().find((r) => r.id === Number(form.room_id));
      const rateStr = String(form.monthly_rate ?? "").trim();
      const monthlyRate = rateStr === "" ? (room?.monthly_rate ?? 0) : Number(rateStr);
      if (form.id === null) {
        // Upfront money is HELD, not auto-applied (held-balance-spec.md §5.2):
        // the advance amount funds the advance pot (consumed first), the
        // deposit funds the deposit pot (consumed last), and nothing is
        // recorded as a payment until the landlord manually applies the
        // balance. advance_held = the entered ₱ (no months × rate math);
        // advance_months stays 0 for new tenants (legacy column).
        //
        // "Already boarding?" backfill (already-boarding-spec.md §3.3): the
        // toggle sets `beds_occupied` (multi-bed tenants entered correctly at
        // creation) and the invisible `backfilled` flag (default 0), which is
        // what lets the v067 trigger skip the room checks for these inserts.
        const backfilled = form.boarding ? 1 : 0;
        const beds = form.boarding ? Math.max(1, Math.trunc(Number(form.beds_occupied) || 1)) : 1;
        await db.execute(
          "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, monthly_rate, deposit_amount, advance_months, advance_held, deposit_held, last_paid_date, beds_occupied, backfilled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
          [form.name.trim(), form.contact.trim(), Number(form.room_id), form.move_in_date, form.due_date, monthlyRate, deposit, 0, advance, deposit ?? 0, null, beds, backfilled]
        );
      } else {
        // Editing overwrites the REMAINING advance pot (the correction path
        // for a wrongly-large balance); legacy advance_months is left as-is.
        await db.execute(
          "UPDATE tenants SET name=$1, contact=$2, room_id=$3, move_in_date=$4, due_date=$5, monthly_rate=$6, deposit_amount=$7, advance_held=$8 WHERE id=$9",
          [form.name.trim(), form.contact.trim(), Number(form.room_id), form.move_in_date, form.due_date, monthlyRate, deposit, advance, form.id]
        );
      }
      await ctx.reload();
      const addMessage = form.boarding
        ? `Existing tenant added — ${form.name.trim()}`
        : `Tenant added — ${form.name.trim()}`;
      pushToast(form.id === null ? addMessage : `Tenant updated — ${form.name.trim()}`, "success");
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
  async function applyBalance(t: Tenant, coveredDueDate: string): Promise<string | null> {
    try {
      const db = await getDb();
      const rate = t.monthly_rate ?? ctx.getRooms().find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
      const result = await applyHeldBalance(db, t, rate, { coveredDueDate });
      if (result.error) return result.error;
      const amount = result.rows.reduce((sum, r) => sum + r.amount, 0);
      await ctx.reload();
      // An open Payment History modal holds its own snapshot — tell it to
      // reload so the balance + list reflect the application.
      ctx.historyChanged();
      pushToast(`Applied ${phpPeso(amount)} from held balance`, "success");
      // The receipt doubles as the confirmation screen, like a cash payment.
      ctx.showReceipt({ tenant: t, rows: result.rows, recorded: true });
      return null;
    } catch (e) {
      const msg = `Failed to apply held balance: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /** Record a payment and set the landlord-chosen next due date; error message or null. */
  async function pay(
    t: Tenant,
    amount: number,
    method: string,
    paidDate: string,
    coveredDueDate: string,
    nextDueDate: string
  ): Promise<string | null> {
    try {
      const db = await getDb();
      const rate = t.monthly_rate ?? ctx.getRooms().find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
      const result = await recordPayment(db, t, rate, amount, method, paidDate, coveredDueDate, nextDueDate);
      if (result.error) return result.error;
      await ctx.reload();
      pushToast(`Payment recorded — ${phpPeso(amount)}`, "success");
      // Show the receipt for this transaction right after confirming (with the
      // success banner — it IS the confirmation screen, per payment-edit-spec).
      ctx.showReceipt({ tenant: t, rows: result.rows, recorded: true });
      return null;
    } catch (e) {
      const msg = `Failed to record payment: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /** Apply an edit to one payment transaction; error message or null. */
  async function edit(t: Tenant, rows: PaymentRecord[], opts: PaymentEditOptions): Promise<string | null> {
    try {
      const db = await getDb();
      const receiptNo = rows[0]?.receipt_no ?? "";
      const rate = t.monthly_rate ?? ctx.getRooms().find((r) => r.id === t.room_id)?.monthly_rate ?? 0;
      const result = await updatePayment(db, t, rate, receiptNo, opts);
      if (result.error) return result.error;
      const amount = result.rows.reduce((sum, r) => sum + r.amount, 0);
      ctx.clearEdit();
      await ctx.reload();
      // The history modal (if open) holds its own snapshot — tell it to reload.
      ctx.historyChanged();
      pushToast(`Payment updated — ${phpPeso(amount)}`, "success");
      // Show the corrected receipt for this transaction right after saving.
      ctx.showReceipt({ tenant: t, rows: result.rows, recorded: false });
      return null;
    } catch (e) {
      const msg = `Failed to update payment: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /** Move the tenant out (archive). */
  async function moveOut(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await markMovedOut(db, t.id);
      ctx.clearMoveOut();
      await ctx.reload();
      const fresh = ctx.getAll().find((x) => x.id === t.id) ?? t;
      pushToast(`${fresh.name} marked as moved out`, "success");
      // Refund behavior is configurable (held-balance-spec.md §5.4): when
      // refunds are allowed, prompt for the remaining deposit pot. When they
      // aren't, the balance is meant to be consumed covering months instead.
      const refundAllowed = (await getSetting("deposit_refund_allowed", "1")) === "1";
      if (refundAllowed && fresh.deposit_held > 0 && fresh.deposit_refunded === 0) {
        ctx.promptDepositRefund(fresh);
      } else if (!refundAllowed && heldBalanceOf(fresh) > 0) {
        pushToast(`${fresh.name} moved out — ${phpPeso(heldBalanceOf(fresh))} held. Apply it to cover unpaid months.`, "info");
      }
    } catch (e) {
      ctx.reportError(`Failed to mark as moved out: ${String(e)}`);
    }
  }

  /** Record that the deposit was handed back. */
  async function depositRefunded(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await refundDeposit(db, t.id);
      ctx.promptDepositRefund(null);
      await ctx.reload();
      pushToast(`Deposit refunded — ${t.name}`, "success");
    } catch (e) {
      ctx.reportError(`Failed to update deposit: ${String(e)}`);
    }
  }

  /**
   * Open the in-app confirm for permanent deletion. A tenant who appears on any
   * amenity bill is blocked here with an explanation (amenity-billing-spec.md
   * §9.4) — history keeps its subject, and the landlord is told why instead of
   * meeting a raw foreign-key error.
   */
  async function requestDelete(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      const bills = await countAmenityBillsForTenant(db, t.id);
      if (bills > 0) {
        pushToast(
          `${t.name} has ${bills} amenity bill${bills === 1 ? "" : "s"} — cancel them or keep the tenant.`,
          "error",
        );
        return;
      }
    } catch (e) {
      ctx.reportError(`Failed to check amenity bills: ${String(e)}`);
      return;
    }
    ctx.askDelete(t);
  }

  /** Actually wipe the tenant and their payment history after confirmation. */
  async function deleteTenant(t: Tenant): Promise<void> {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM tenants WHERE id=$1", [t.id]);
      ctx.askDelete(null);
      await ctx.reload();
      pushToast(`Tenant deleted — ${t.name}`, "success");
    } catch (e) {
      // Keep the modal open so the landlord can retry or cancel.
      ctx.reportError(`Failed to delete tenant: ${String(e)}`);
    }
  }

  return { saveTenant, applyBalance, pay, edit, moveOut, depositRefunded, requestDelete, deleteTenant };
}
