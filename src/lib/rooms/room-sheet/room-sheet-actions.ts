import {
  applyHeldBalance,
  markMovedOut,
  recordPayment,
  refundDeposit,
  updatePayment,
  type PaymentEditOptions,
} from "$lib/tenants/tenant-actions";
import { getSetting } from "$lib/db/settings";
import { heldBalanceOf } from "$lib/tenants/held-balance";
import type { BoarderSheetRoom } from "$lib/rooms/rooms";
import type { PaymentRecord, Tenant } from "$lib/tenants/types";

/**
 * The room sheet's mutations. They only touch the database and return what the
 * component needs to update its targets and toasts — no UI state, no toasts —
 * so the orchestrator stays wiring and the money rules stay in tenant-actions.
 */

type Db = Parameters<typeof recordPayment>[0];

export type PaymentOutcome = { error: string } | { rows: PaymentRecord[] };

export async function payBoarder(
  db: Db,
  room: BoarderSheetRoom,
  tenant: Tenant,
  amount: number,
  method: string,
  paidDate: string,
  coveredDueDate: string,
  nextDueDate: string,
): Promise<PaymentOutcome> {
  const result = await recordPayment(
    db,
    tenant,
    room.monthly_rate,
    amount,
    method,
    paidDate,
    coveredDueDate,
    nextDueDate,
  );
  return result.error ? { error: result.error } : { rows: result.rows };
}

export async function updateBoarderPayment(
  db: Db,
  room: BoarderSheetRoom,
  tenant: Tenant,
  receiptNo: string,
  options: PaymentEditOptions,
): Promise<PaymentOutcome> {
  const result = await updatePayment(db, tenant, room.monthly_rate, receiptNo, options);
  return result.error ? { error: result.error } : { rows: result.rows };
}

export async function applyHeldToMonth(
  db: Db,
  room: BoarderSheetRoom,
  tenant: Tenant,
  coveredDueDate: string,
): Promise<PaymentOutcome> {
  const result = await applyHeldBalance(db, tenant, room.monthly_rate, { coveredDueDate });
  return result.error ? { error: result.error } : { rows: result.rows };
}

/** Mark moved out and report what the refund prompt should do about the deposit. */
export async function markBoarderMovedOut(
  db: Db,
  tenant: Tenant,
): Promise<{ refundAllowed: boolean; held: number }> {
  await markMovedOut(db, tenant.id);
  // Refund behavior is configurable (held-balance-spec.md §5.4): when refunds
  // are allowed, prompt for the remaining deposit pot. When they aren't, the
  // balance is meant to be consumed covering months instead.
  const refundAllowed = (await getSetting("deposit_refund_allowed", "1")) === "1";
  return { refundAllowed, held: heldBalanceOf(tenant) };
}

export async function refundBoarderDeposit(db: Db, tenantId: number): Promise<void> {
  await refundDeposit(db, tenantId);
}

export async function setBoarderBeds(db: Db, tenantId: number, beds: number): Promise<void> {
  await db.execute("UPDATE tenants SET beds_occupied=$1 WHERE id=$2", [beds, tenantId]);
}
