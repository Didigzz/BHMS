import { describe, expect, it } from "vitest";
import {
  AMENITY_PAYMENT_MESSAGES,
  activeOnly,
  buildHistoryRows,
  reversedOnly,
  sumActive,
  sumReversed,
  summarizeBillPayments,
  summaryLabel,
  validatePaidDate,
  type AmenityPaymentRow,
  type BillSharePayment,
} from "./amenity-payments";

const peso = (amount: number) => `₱${amount.toFixed(2)}`;

function payment(overrides: Partial<AmenityPaymentRow> = {}): AmenityPaymentRow {
  return {
    id: 1,
    bill_tenant_id: 1,
    bill_id: 1,
    tenant_id: 1,
    amount: 100,
    paid_date: "2026-11-09",
    status: "active",
    reversal_reason: null,
    reversed_at: null,
    amenity_name: "Electricity",
    billing_period: "2026-11",
    billing_date: "2026-11-01",
    bill_status: "active",
    tenant_name_snapshot: "Maria",
    room_number_snapshot: "1",
    ...overrides,
  };
}

const TODAY = "2026-11-09";

describe("validatePaidDate", () => {
  it("accepts today and earlier real dates", () => {
    expect(validatePaidDate(TODAY, TODAY)).toBeNull();
    expect(validatePaidDate("2026-11-08", TODAY)).toBeNull();
    expect(validatePaidDate("2024-02-29", "2026-11-09")).toBeNull();
  });

  it("rejects a future date with the locked message", () => {
    expect(validatePaidDate("2026-11-10", TODAY)).toBe(AMENITY_PAYMENT_MESSAGES.future);
  });

  it("rejects blank, malformed and impossible dates", () => {
    for (const value of ["", "2026-1-01", "2026/11/09", "2026-13-01", "2026-02-30", "2025-02-29"]) {
      expect(validatePaidDate(value, TODAY)).toBe(AMENITY_PAYMENT_MESSAGES.date);
    }
  });
});

describe("summarizeBillPayments", () => {
  const shares: BillSharePayment[] = [
    { id: 1, amount: 500, is_excluded: 0, payment_status: "Paid" },
    { id: 2, amount: 500, is_excluded: 0, payment_status: "Unpaid" },
    { id: 3, amount: 0, is_excluded: 0, payment_status: "Unpaid" },
    { id: 4, amount: 0, is_excluded: 1, payment_status: "Paid" },
  ];
  const payments = [
    { bill_tenant_id: 1, amount: 500, status: "active" },
    { bill_tenant_id: 2, amount: 500, status: "reversed" },
  ];

  it("counts only payable shares and only active money", () => {
    expect(summarizeBillPayments(shares, payments)).toEqual({
      payableCount: 2,
      paidCount: 1,
      collected: 500,
      payableTotal: 1000,
      allPaid: false,
    });
  });

  it("ignores a reversed payment for the paid count and totals", () => {
    const summary = summarizeBillPayments(shares, [
      ...payments,
      { bill_tenant_id: 2, amount: 500, status: "reversed" },
    ]);
    expect(summary.paidCount).toBe(1);
    expect(summary.collected).toBe(500);
    expect(summary.allPaid).toBe(false);
  });

  it("reports allPaid only when every payable share has an active payment", () => {
    const summary = summarizeBillPayments(shares, [
      { bill_tenant_id: 1, amount: 500, status: "active" },
      { bill_tenant_id: 2, amount: 500, status: "active" },
    ]);
    expect(summary.allPaid).toBe(true);
    expect(summary.collected).toBe(1000);
  });

  it("is not 'all paid' when there is nothing payable at all", () => {
    const summary = summarizeBillPayments(
      [{ id: 9, amount: 0, is_excluded: 1, payment_status: "Unpaid" }],
      [],
    );
    expect(summary.payableCount).toBe(0);
    expect(summary.allPaid).toBe(false);
  });

  it("rounds floating-point drift to centavos", () => {
    const summary = summarizeBillPayments(
      [
        { id: 1, amount: 0.1, is_excluded: 0, payment_status: "Paid" },
        { id: 2, amount: 0.2, is_excluded: 0, payment_status: "Paid" },
      ],
      [
        { bill_tenant_id: 1, amount: 0.1, status: "active" },
        { bill_tenant_id: 2, amount: 0.2, status: "active" },
      ],
    );
    expect(summary.collected).toBe(0.3);
    expect(summary.payableTotal).toBe(0.3);
  });
});

describe("summaryLabel", () => {
  it("uses the three locked shapes", () => {
    expect(
      summaryLabel(
        { payableCount: 0, paidCount: 0, collected: 0, payableTotal: 0, allPaid: false },
        peso,
      ),
    ).toBe("No payable shares");
    expect(
      summaryLabel(
        { payableCount: 2, paidCount: 2, collected: 1000, payableTotal: 1000, allPaid: true },
        peso,
      ),
    ).toBe("All 2 paid · ₱1000.00");
    expect(
      summaryLabel(
        { payableCount: 5, paidCount: 1, collected: 428.57, payableTotal: 2142.85, allPaid: false },
        peso,
      ),
    ).toBe("1 of 5 paid · ₱428.57 of ₱2142.85");
  });
});

describe("payment selectors and totals", () => {
  const rows = [
    payment({ id: 1, amount: 0.1, status: "active" }),
    payment({ id: 2, amount: 0.2, status: "active" }),
    payment({ id: 3, amount: 5, status: "reversed" }),
  ];

  it("separates active from reversed rows", () => {
    expect(activeOnly(rows).map((row) => row.id)).toEqual([1, 2]);
    expect(reversedOnly(rows).map((row) => row.id)).toEqual([3]);
  });

  it("sums each status without float drift", () => {
    expect(sumActive(rows)).toBe(0.3);
    expect(sumReversed(rows)).toBe(5);
  });
});

describe("buildHistoryRows", () => {
  const rent = [
    {
      receipt_no: "RCPT-2",
      paid_date: "2026-11-05",
      first_month: "2026-11",
      last_month: "2026-11",
      due_date: "2026-11-05",
      total: 2500,
      method: "cash",
      count: 1,
    },
    {
      receipt_no: "RCPT-1",
      paid_date: "2026-10-05",
      first_month: "2026-10",
      last_month: "2026-10",
      due_date: "2026-10-05",
      total: 2500,
      method: "cash",
      count: 1,
    },
  ];

  it("merges both kinds newest first, keeping reversed rows", () => {
    const rows = buildHistoryRows(rent, [
      payment({ id: 7, paid_date: "2026-11-09", amount: 428.57 }),
      payment({ id: 8, paid_date: "2026-10-20", status: "reversed", reversal_reason: "Wrong tenant" }),
    ]);

    expect(rows.map((row) => row.paidDate)).toEqual([
      "2026-11-09",
      "2026-11-05",
      "2026-10-20",
      "2026-10-05",
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["amenity", "rent", "amenity", "rent"]);
    const reversed = rows.find((row) => row.kind === "amenity" && row.payment.id === 8);
    expect(reversed?.kind === "amenity" && reversed.payment.status).toBe("reversed");
  });

  it("returns the rent list untouched when there are no amenity rows", () => {
    const rows = buildHistoryRows(rent, []);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "rent")).toBe(true);
    expect(rows[0].kind === "rent" && rows[0].group.receipt_no).toBe("RCPT-2");
  });
});
