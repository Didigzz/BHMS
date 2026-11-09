import { describe, expect, it } from "vitest";
import { heldBalanceOf, splitConsumption, validateApply } from "./held-balance";

describe("heldBalanceOf", () => {
  it("sums the advance and deposit pots", () => {
    expect(heldBalanceOf({ advance_held: 600, deposit_held: 1200 })).toBe(1800);
  });

  it("treats missing pots as zero", () => {
    // @ts-expect-error — missing pots on purpose (legacy rows default to 0 in SQL)
    expect(heldBalanceOf({})).toBe(0);
  });
});

describe("splitConsumption — advance first, deposit last", () => {
  it("draws entirely from the advance pot when it can cover the amount", () => {
    expect(splitConsumption(600, 1200, 600)).toEqual({ advanceUsed: 600, depositUsed: 0 });
  });

  it("uses the advance pot first, then the deposit for the remainder", () => {
    expect(splitConsumption(300, 900, 600)).toEqual({ advanceUsed: 300, depositUsed: 300 });
  });

  it("draws from the deposit only when the advance pot is empty", () => {
    expect(splitConsumption(0, 1200, 600)).toEqual({ advanceUsed: 0, depositUsed: 600 });
  });

  it("clamps a negative advance pot to zero", () => {
    expect(splitConsumption(-50, 1200, 600)).toEqual({ advanceUsed: 0, depositUsed: 600 });
  });
});

describe("validateApply — one specific due date, whole month only (payment due-date spec §6.3)", () => {
  const base = {
    rate: 600,
    coveredDueDate: "2026-09-05",
    dueDate: "2026-09-05",
    advanceHeld: 600,
    depositHeld: 1200,
  };

  it("accepts a one-month application that fits the balance", () => {
    const v = validateApply(base);
    expect(v.error).toBeNull();
    expect(v.amount).toBe(600);
    expect(v.balance).toBe(1800);
  });

  it("rejects an amount larger than the balance (whole months only)", () => {
    const v = validateApply({ ...base, rate: 2400 }); // ₱2,400 needed vs ₱1,800 held
    expect(v.error).toMatch(/insufficient held balance/i);
    expect(v.amount).toBe(2400);
  });

  it("advances the due date when the covered due date is at the current due date", () => {
    const v = validateApply(base); // covered == current due
    expect(v.newDue).toBe("2026-10-05");
  });

  it("advances the due date when the covered due date is past the current due date", () => {
    const v = validateApply({ ...base, coveredDueDate: "2026-10-05" });
    expect(v.newDue).toBe("2026-11-05");
  });

  it("leaves the due date unchanged when covering a past due date", () => {
    const v = validateApply({ ...base, coveredDueDate: "2026-08-05" });
    expect(v.newDue).toBeNull();
  });

  it("clamps the advanced due date to the month length", () => {
    const v = validateApply({ ...base, dueDate: "2026-01-31", coveredDueDate: "2026-01-31" });
    expect(v.newDue).toBe("2026-02-28");
  });
});