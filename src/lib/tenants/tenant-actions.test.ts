import { describe, expect, it } from "vitest";
import { buildPaymentEditRows, buildSinglePaymentEditRows, type PaymentRow } from "./tenant-actions";

function row(partial: Partial<PaymentRow> & { due_date: string; covers_month: string | null }): PaymentRow {
  return {
    id: 1,
    amount: 2400,
    paid_date: "2026-08-12",
    method: "Cash",
    receipt_no: "RCPT-000001",
    ...partial,
  };
}

describe("buildSinglePaymentEditRows (payment due-date spec §6.4)", () => {
  it("rewrites a single-due-date payment with the new paid date and covered due date", () => {
    const current = [row({ due_date: "2026-09-15", covers_month: "2026-09" })];
    const { error, rows } = buildSinglePaymentEditRows(current, 2400, "RCPT-000001", {
      paidDate: "2026-08-30",
      coveredDueDate: "2026-09-20",
      method: "GCash",
    });

    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0].paid_date).toBe("2026-08-30");
    expect(rows[0].due_date).toBe("2026-09-20");
    // covers_month is recomputed from the covered due date.
    expect(rows[0].covers_month).toBe("2026-09");
    expect(rows[0].method).toBe("GCash");
    expect(rows[0].amount).toBe(2400);
    expect(rows[0].receipt_no).toBe("RCPT-000001");
  });

  it("recomputes covers_month when the covered due date moves months", () => {
    const current = [row({ due_date: "2026-09-15", covers_month: "2026-09" })];
    const { rows } = buildSinglePaymentEditRows(current, 2400, "RCPT-000001", {
      paidDate: "2026-08-30",
      coveredDueDate: "2026-10-15",
      method: "Cash",
    });
    expect(rows[0].covers_month).toBe("2026-10");
  });

  it("rejects empty transactions", () => {
    const { error } = buildSinglePaymentEditRows([], 2400, "RCPT-000999", {
      paidDate: "2026-08-30",
      coveredDueDate: "2026-09-15",
      method: "Cash",
    });
    expect(error).toBe("Payment not found.");
  });

  it("refuses to treat a multi-row legacy receipt as single-due-date", () => {
    const current = [
      row({ id: 1, due_date: "2026-09-05", covers_month: "2026-08" }),
      row({ id: 2, due_date: "2026-10-05", covers_month: "2026-09" }),
    ];
    const { error } = buildSinglePaymentEditRows(current, 2400, "RCPT-000007", {
      paidDate: "2026-08-01",
      coveredDueDate: "2026-08-05",
      method: "Cash",
    });
    expect(error).toMatch(/legacy transaction/);
  });
});

describe("buildPaymentEditRows (legacy multi-month edit, payment edit spec §5)", () => {
  it("extends a 1-month payment to 2 months: covers next month, due shifts +1", () => {
    const current = [row({ due_date: "2026-09-05", covers_month: "2026-08" })];
    const { error, rows } = buildPaymentEditRows(current, 2400, "RCPT-000001", {
      months: 2,
      method: "GCash",
      paidDate: "2026-08-10",
    });

    expect(error).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.covers_month)).toEqual(["2026-08", "2026-09"]);
    // Original last due 2026-09-05 + (2-1) months → new last due 2026-10-05.
    expect(rows[0].due_date).toBe("2026-09-05");
    expect(rows[1].due_date).toBe("2026-10-05");
    expect(rows.every((r) => r.amount === 2400 && r.method === "GCash" && r.paid_date === "2026-08-10")).toBe(true);
    expect(rows.every((r) => r.receipt_no === "RCPT-000001")).toBe(true);
  });

  it("shrinks a 3-month advance to 1 month: covers only the anchor month, due shifts back", () => {
    const current = [
      row({ id: 1, due_date: "2026-09-05", covers_month: "2026-08" }),
      row({ id: 2, due_date: "2026-10-05", covers_month: "2026-09" }),
      row({ id: 3, due_date: "2026-11-05", covers_month: "2026-10" }),
    ];
    const { error, rows } = buildPaymentEditRows(current, 2400, "RCPT-000007", {
      months: 1,
      method: "—",
      paidDate: "2026-08-01",
    });

    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0].covers_month).toBe("2026-08");
    // Original last due 2026-11-05 + (1-3) months → 2026-09-05.
    expect(rows[0].due_date).toBe("2026-09-05");
  });

  it("keeps the anchor month when the payment already covers several months", () => {
    const current = [
      row({ id: 1, due_date: "2026-10-05", covers_month: "2026-08" }),
      row({ id: 2, due_date: "2026-11-05", covers_month: "2026-09" }),
    ];
    const { rows } = buildPaymentEditRows(current, 2000, "RCPT-000002", {
      months: 2,
      method: "Cash",
      paidDate: "2026-08-05",
    });
    expect(rows.map((r) => r.covers_month)).toEqual(["2026-08", "2026-09"]);
  });

  it("falls back to the paid date's month when covers_month is missing (legacy row)", () => {
    const current = [row({ due_date: "2026-08-05", covers_month: null, paid_date: "2026-07-20" })];
    const { rows } = buildPaymentEditRows(current, 2400, "RCPT-000003", {
      months: 1,
      method: "Cash",
      paidDate: "2026-07-20",
    });
    expect(rows[0].covers_month).toBe("2026-07");
  });

  it("rejects zero months and empty transactions", () => {
    const current = [row({ due_date: "2026-09-05", covers_month: "2026-08" })];
    expect(buildPaymentEditRows(current, 2400, "RCPT-000001", { months: 0, method: "Cash", paidDate: "2026-08-12" }).error).toBe(
      "At least one month must be covered."
    );
    expect(buildPaymentEditRows([], 2400, "RCPT-000999", { months: 1, method: "Cash", paidDate: "2026-08-12" }).error).toBe(
      "Payment not found."
    );
  });
});
