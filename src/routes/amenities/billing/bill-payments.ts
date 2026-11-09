import { getDb } from "$lib/db/db";
import {
  recordAmenityPayment,
  recordBillPayments,
  updateAmenityPaymentDate,
  voidAmenityPayment,
} from "$lib/amenities/amenity-payment-actions";
import { AMENITY_PAYMENT_MESSAGES } from "$lib/amenities/amenity-payments";
import type { AmenityBillTenantRow } from "$lib/amenities/amenity-actions";
import type { BillSheetState } from "./bill-summaries";

/**
 * The payment sheet's four confirmations (record / bulk / void / re-date).
 * Pulled out of the page so the route keeps the list and the cache, while the
 * mutation + optimistic-row bookkeeping lives in one place.
 */

export interface PaymentSheetDeps {
  get: () => BillSheetState | null;
  clear: () => void;
  setError: (message: string) => void;
  /** Optimistic patch for one cached share row. */
  setRow: (billId: number, shareId: number, patch: Partial<AmenityBillTenantRow>) => void;
  refresh: (billId: number) => Promise<void>;
  toast: (message: string) => void;
}

export function createPaymentSheet(deps: PaymentSheetDeps) {
  function confirm(value: { paidDate?: string; note?: string }) {
    const sheet = deps.get();
    if (!sheet) return Promise.resolve();
    if (sheet.mode === "record") return confirmRecord(value.paidDate ?? "");
    if (sheet.mode === "bulk") return confirmBulk(value.paidDate ?? "");
    if (sheet.mode === "void") return confirmVoid(value.note ?? "");
    return confirmDate(value.paidDate ?? "");
  }

  async function confirmRecord(paidDate: string) {
    const sheet = deps.get();
    if (!sheet || sheet.mode !== "record") return;
    const { bill, row } = sheet;
    const db = await getDb();
    deps.setRow(bill.id, row.id, {
      payment_status: "Paid",
      paid_date: paidDate,
      payment_id: -1,
    });
    const res = await recordAmenityPayment(db, row.id, paidDate);
    if (res.error) {
      deps.setRow(bill.id, row.id, {
        payment_status: "Unpaid",
        paid_date: null,
        payment_id: null,
      });
      deps.setError(res.error);
      return;
    }
    deps.clear();
    deps.toast("Payment recorded");
    await deps.refresh(bill.id);
  }

  async function confirmBulk(paidDate: string) {
    const sheet = deps.get();
    if (!sheet || sheet.mode !== "bulk") return;
    const bill = sheet.bill;
    const db = await getDb();
    const res = await recordBillPayments(db, bill.id, paidDate);
    if (res.error) {
      deps.setError(res.error);
      return;
    }
    deps.clear();
    deps.toast(`Marked ${res.count} share${res.count === 1 ? "" : "s"} paid`);
    await deps.refresh(bill.id);
  }

  async function confirmVoid(note: string) {
    const sheet = deps.get();
    if (!sheet || sheet.mode !== "void") return;
    const { bill, row } = sheet;
    if (row.payment_id == null) {
      deps.setError(AMENITY_PAYMENT_MESSAGES.paymentNotFound);
      return;
    }
    const db = await getDb();
    const res = await voidAmenityPayment(db, row.payment_id, note);
    if (res.error) {
      deps.setError(res.error);
      return;
    }
    deps.clear();
    deps.toast("Payment voided");
    await deps.refresh(bill.id);
  }

  async function confirmDate(paidDate: string) {
    const sheet = deps.get();
    if (!sheet || sheet.mode !== "date") return;
    const { bill, row } = sheet;
    if (row.payment_id == null) {
      deps.setError(AMENITY_PAYMENT_MESSAGES.paymentNotFound);
      return;
    }
    const db = await getDb();
    const res = await updateAmenityPaymentDate(db, row.payment_id, paidDate);
    if (res.error) {
      deps.setError(res.error);
      return;
    }
    deps.clear();
    deps.toast("Paid date updated");
    await deps.refresh(bill.id);
  }

  return { confirm };
}
