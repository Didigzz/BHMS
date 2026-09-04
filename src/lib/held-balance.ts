/**
 * Held Balance math (held-balance-spec.md §5, payment-due-date-spec.md §6.3) —
 * pure functions over plain data, so the pot-consumption and due-date rules
 * can be unit-tested without a database. `tenant-actions.applyHeldBalance` is
 * the DB wrapper.
 *
 * Model:
 * - A tenant has two pots: `advance_held` (advance money) and `deposit_held`
 *   (the deposit). The landlord applies the balance manually.
 * - Consumption order: **advance first, deposit last**.
 * - Whole months only: an application always covers exactly one month
 *   (`rate × 1`), and the full amount must fit in the balance.
 * - Like cash payments, an application covers one **specific due date**. The
 *   tenant's stored due date only advances when the covered due date is at or
 *   past the current due date (\"paid through\" state preserved).
 */

import { addMonths } from "./payment-status";
import { phpPesoPrecise } from "./format";

/** The two balance pots as stored on a tenant row. */
export interface HeldPots {
  advance_held: number;
  deposit_held: number;
}

/** Total held money (advance + deposit). Missing pots count as 0. */
export function heldBalanceOf(t: HeldPots): number {
  return (t.advance_held ?? 0) + (t.deposit_held ?? 0);
}

/**
 * How an applied amount is drawn from the pots: advance money is consumed
 * first; only what it can't cover comes out of the deposit.
 */
export function splitConsumption(
  advanceHeld: number,
  depositHeld: number,
  amount: number
): { advanceUsed: number; depositUsed: number } {
  const advanceUsed = Math.min(Math.max(0, advanceHeld), amount);
  return { advanceUsed, depositUsed: amount - advanceUsed };
}

export interface ApplyValidation {
  error: string | null;
  /** Total amount that would be applied (one month's rate). */
  amount: number;
  /** Held balance available (advance + deposit). */
  balance: number;
  /**
   * The tenant's new due date when the covered due date is at/after the
   * current due date (covered due date + 1 month), else null.
   */
  newDue: string | null;
}

/**
 * Validate an application before touching the DB: one full month only, the
 * amount must fit in the balance. Returns the derived amount/balance/new-due
 * (or an error message).
 */
export function validateApply(opts: {
  rate: number;
  /** \"YYYY-MM-DD\" — the specific due date this application settles. */
  coveredDueDate: string;
  /** \"YYYY-MM-DD\" — the tenant's current stored due date. */
  dueDate: string;
  advanceHeld: number;
  depositHeld: number;
}): ApplyValidation {
  const balance = heldBalanceOf({ advance_held: opts.advanceHeld, deposit_held: opts.depositHeld });
  const amount = opts.rate;
  if (amount > balance) {
    return {
      error: `Insufficient held balance — ${phpPesoPrecise(amount)} needed, ${phpPesoPrecise(balance)} held.`,
      amount,
      balance,
      newDue: null,
    };
  }
  // Advance the stored due date only when the coverage reaches/passes the
  // current due date (settling an overdue or current period means the tenant
  // is \"paid through\" it). Backdated applications leave the due date alone.
  const newDue = opts.coveredDueDate >= opts.dueDate ? addMonths(opts.coveredDueDate, 1) : null;
  return { error: null, amount, balance, newDue };
}