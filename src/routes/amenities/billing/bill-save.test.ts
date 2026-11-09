import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveAmenityBill, type BillSaveInput } from "./bill-save";

const mocks = vi.hoisted(() => ({
  validateBill: vi.fn(() => null as string | null),
  validateExclusionReason: vi.fn(() => null as string | null),
  checkDuplicateAmenity: vi.fn(async () => false),
  findConnectedRoomOverlap: vi.fn(async () => [] as { room_number: string; amenity_name: string }[]),
  createAmenityBill: vi.fn(async () => ({ error: null as string | null })),
  updateAmenityBill: vi.fn(async () => ({ error: null as string | null })),
}));

vi.mock("$lib/amenities/amenity-actions", () => ({
  checkDuplicateAmenity: mocks.checkDuplicateAmenity,
  findConnectedRoomOverlap: mocks.findConnectedRoomOverlap,
  createAmenityBill: mocks.createAmenityBill,
  updateAmenityBill: mocks.updateAmenityBill,
}));
vi.mock("$lib/amenities/amenity-billing", () => ({
  validateBill: mocks.validateBill,
  validateExclusionReason: mocks.validateExclusionReason,
}));

const DB = {} as never;

function input(over: Partial<BillSaveInput> = {}): BillSaveInput {
  return {
    amenityName: "Electricity",
    method: "shared",
    total: 1000,
    billingDate: "2026-09-05",
    billingPeriod: "2026-09",
    notes: "",
    divisionMode: "auto",
    shares: new Map([
      [1, 500],
      [2, 500],
    ]),
    manualIds: [],
    excluded: new Map(),
    roomIds: [],
    meterStart: null,
    meterEnd: null,
    pricePerUnit: null,
    editingId: null,
    allowDuplicate: false,
    allowOverlap: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validateBill.mockReturnValue(null);
  mocks.validateExclusionReason.mockReturnValue(null);
  mocks.checkDuplicateAmenity.mockResolvedValue(false);
  mocks.findConnectedRoomOverlap.mockResolvedValue([]);
  mocks.createAmenityBill.mockResolvedValue({ error: null });
  mocks.updateAmenityBill.mockResolvedValue({ error: null });
});

describe("saveAmenityBill", () => {
  it("creates the bill with the computed shares", async () => {
    const onWrite = vi.fn();
    const outcome = await saveAmenityBill(DB, input({ onWrite }));

    expect(outcome).toEqual({ status: "saved" });
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(mocks.createAmenityBill).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ amenity_name: "Electricity", total_amount: 1000, billing_period: "2026-09" }),
    );
    expect(mocks.updateAmenityBill).not.toHaveBeenCalled();
  });

  it("stops at a missing exclusion reason before anything else runs", async () => {
    mocks.validateExclusionReason.mockReturnValue("Give a reason for excluding this tenant.");
    const outcome = await saveAmenityBill(DB, input({ excluded: new Map([[3, "  "]]) }));

    expect(outcome).toEqual({ status: "error", message: "Give a reason for excluding this tenant." });
    expect(mocks.validateBill).not.toHaveBeenCalled();
    expect(mocks.createAmenityBill).not.toHaveBeenCalled();
  });

  it("surfaces validation errors", async () => {
    mocks.validateBill.mockReturnValue("Pick at least one tenant.");
    const outcome = await saveAmenityBill(DB, input());

    expect(outcome).toEqual({ status: "error", message: "Pick at least one tenant." });
    expect(mocks.checkDuplicateAmenity).not.toHaveBeenCalled();
  });

  it("asks before creating a duplicate, then writes once confirmed", async () => {
    mocks.checkDuplicateAmenity.mockResolvedValue(true);

    const first = await saveAmenityBill(DB, input());
    expect(first).toEqual({
      status: "duplicate",
      message: "A Electricity bill for 2026-09 already exists — create another anyway?",
    });
    expect(mocks.createAmenityBill).not.toHaveBeenCalled();

    const second = await saveAmenityBill(DB, input({ allowDuplicate: true }));
    expect(second).toEqual({ status: "saved" });
    expect(mocks.checkDuplicateAmenity).toHaveBeenCalledTimes(1);
    expect(mocks.createAmenityBill).toHaveBeenCalledTimes(1);
  });

  it("asks before overlapping connected rooms", async () => {
    mocks.findConnectedRoomOverlap.mockResolvedValue([{ room_number: "Room B", amenity_name: "Water" }]);

    const base = input({ method: "connected" });
    const first = await saveAmenityBill(DB, { ...base, roomIds: [1, 2] });
    expect(first).toEqual({ status: "overlap", messages: ['Room B is already on "Water" for this period'] });
    expect(mocks.createAmenityBill).not.toHaveBeenCalled();

    const second = await saveAmenityBill(DB, { ...base, roomIds: [1, 2], allowOverlap: true });
    expect(second).toEqual({ status: "saved" });
  });

  it("updates an existing bill instead of creating one", async () => {
    const outcome = await saveAmenityBill(DB, input({ editingId: 42 }));

    expect(outcome).toEqual({ status: "saved" });
    expect(mocks.updateAmenityBill).toHaveBeenCalledWith(DB, 42, expect.objectContaining({ amenity_name: "Electricity" }));
    expect(mocks.createAmenityBill).not.toHaveBeenCalled();
  });

  it("reports a write error without claiming success", async () => {
    mocks.createAmenityBill.mockResolvedValue({ error: "Bill total must be greater than zero." });

    const outcome = await saveAmenityBill(DB, input());

    expect(outcome).toEqual({ status: "error", message: "Bill total must be greater than zero." });
  });
});
