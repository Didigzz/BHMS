import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTenantPageFlows } from "./tenant-page-flows";
import type { Room, Tenant } from "$lib/tenants/types";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(async () => ({})),
  pushToast: vi.fn(),
  recordPayment: vi.fn(),
  markMovedOut: vi.fn(async () => {}),
  refundDeposit: vi.fn(async () => {}),
  applyHeldBalance: vi.fn(),
  updatePayment: vi.fn(),
  countBills: vi.fn(async () => 0),
}));

vi.mock("$lib/db/db", () => ({ getDb: async () => ({ execute: mocks.execute }) }));
vi.mock("$lib/ui/toast.svelte", () => ({ pushToast: mocks.pushToast }));
vi.mock("$lib/tenants/tenant-actions", () => ({
  recordPayment: mocks.recordPayment,
  markMovedOut: mocks.markMovedOut,
  refundDeposit: mocks.refundDeposit,
  applyHeldBalance: mocks.applyHeldBalance,
  updatePayment: mocks.updatePayment,
}));
vi.mock("$lib/amenities/amenity-actions", () => ({
  countAmenityBillsForTenant: mocks.countBills,
}));
vi.mock("$lib/db/settings", () => ({ getSetting: async () => "1" }));

const ROOM: Room = {
  id: 1,
  room_number: "Room A",
  capacity: 2,
  monthly_rate: 2500,
  maintenance: 0,
  occupied_beds: 1,
  whole_reservations: 0,
  held_beds: 1,
};

function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: 7,
    name: "Maria",
    contact: "0917",
    room_id: 1,
    room_number: "Room A",
    move_in_date: "2026-01-01",
    due_date: "2026-10-01",
    last_paid_date: null,
    monthly_rate: 2500,
    beds_occupied: 1,
    moved_out_date: null,
    deposit_held: 0,
    deposit_refunded: 0,
    advance_held: 0,
    advance_months: 0,
    deposit_amount: null,
    amenity_balance: 0,
    backfilled: 0,
    ...over,
  } as Tenant;
}

function makeFlows(over: Partial<Parameters<typeof createTenantPageFlows>[0]> = {}) {
  const ctx = {
    getRooms: () => [ROOM],
    getAll: () => [] as Tenant[],
    reload: vi.fn(async () => {}),
    historyChanged: vi.fn(),
    showReceipt: vi.fn(),
    promptDepositRefund: vi.fn(),
    clearMoveOut: vi.fn(),
    clearEdit: vi.fn(),
    askDelete: vi.fn(),
    reportError: vi.fn(),
    ...over,
  };
  return { ctx, flows: createTenantPageFlows(ctx) };
}

const blankForm = {
  id: null,
  name: " Ana ",
  contact: " 0917 ",
  room_id: "1",
  move_in_date: "2026-09-01",
  due_date: "2026-10-01",
  deposit_amount: "1000",
  advance_amount: "500",
  monthly_rate: "",
  beds_occupied: "1",
  boarding: false,
};

beforeEach(() => {
  mocks.execute.mockClear();
  mocks.pushToast.mockClear();
  mocks.countBills.mockClear();
});

describe("saveTenant", () => {
  it("writes held money as entered and falls back to the room rate", async () => {
    const { flows, ctx } = makeFlows();
    const error = await flows.saveTenant(blankForm as never);

    expect(error).toBeNull();
    const [sql, params] = mocks.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO tenants");
    // name, contact, room_id, move_in, due, rate (room fallback), deposit,
    // advance_months, advance_held, deposit_held, last_paid, beds, backfilled
    expect(params).toEqual([
      "Ana", "0917", 1, "2026-09-01", "2026-10-01", 2500, 1000, 0, 500, 1000, null, 1, 0,
    ]);
    expect(ctx.reload).toHaveBeenCalled();
    expect(mocks.pushToast).toHaveBeenCalledWith("Tenant added — Ana", "success");
  });

  it("marks an already-boarding insert with its bed count and backfilled flag", async () => {
    const { flows } = makeFlows();
    await flows.saveTenant({ ...blankForm, boarding: true, beds_occupied: "3" } as never);

    const [, params] = mocks.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(params.slice(-2)).toEqual([3, 1]);
    expect(mocks.pushToast).toHaveBeenCalledWith("Existing tenant added — Ana", "success");
  });

  it("translates trigger errors into landlord-facing copy", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("Room is at full capacity"));
    const { flows } = makeFlows();

    const error = await flows.saveTenant(blankForm as never);

    expect(error).toBe("That room is already at full capacity.");
    expect(mocks.pushToast).toHaveBeenCalledWith("That room is already at full capacity.", "error");
  });
});

describe("deletion", () => {
  it("asks for confirmation when the tenant has no amenity bills", async () => {
    const { flows, ctx } = makeFlows();
    const t = tenant();

    await flows.requestDelete(t);

    expect(ctx.askDelete).toHaveBeenCalledWith(t);
  });

  it("blocks deletion while amenity bills reference the tenant", async () => {
    mocks.countBills.mockResolvedValueOnce(2);
    const { flows, ctx } = makeFlows();

    await flows.requestDelete(tenant());

    expect(ctx.askDelete).not.toHaveBeenCalled();
    expect(mocks.pushToast).toHaveBeenCalledWith(
      "Maria has 2 amenity bills — cancel them or keep the tenant.",
      "error",
    );
  });

  it("deletes and reloads after the confirm", async () => {
    const { flows, ctx } = makeFlows();

    await flows.deleteTenant(tenant());

    expect(mocks.execute).toHaveBeenCalledWith("DELETE FROM tenants WHERE id=$1", [7]);
    expect(ctx.askDelete).toHaveBeenCalledWith(null);
    expect(ctx.reload).toHaveBeenCalled();
  });
});
