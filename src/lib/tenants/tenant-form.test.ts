import { describe, expect, it } from "vitest";
import { validateTenantForm, type TenantFormRoom, type TenantFormValidationContext } from "./tenant-form";

/** A normal, available room (2 beds, 1 occupied). */
const room: TenantFormRoom = {
  room_number: "101",
  capacity: 2,
  occupied_beds: 1,
  held_beds: 0,
  maintenance: 0,
  whole_reservations: 0,
};

/** A valid form (all fields filled); tests override only what they vary. */
function form(overrides: Partial<Parameters<typeof validateTenantForm>[0]> = {}) {
  return {
    name: "Juan Dela Cruz",
    contact: "0917 123 4567",
    room_id: "1",
    monthly_rate: "2500",
    move_in_date: "2026-09-01",
    due_date: "2026-10-01",
    deposit_amount: "",
    advance_amount: "",
    beds_occupied: "1",
    ...overrides,
  };
}

/** Normal-mode context (toggle OFF). */
function ctx(overrides: Partial<TenantFormValidationContext> = {}): TenantFormValidationContext {
  return {
    boarding: false,
    today: "2026-09-09",
    room,
    isAdding: true,
    currentRoomIsSame: false,
    moverBeds: 1,
    ...overrides,
  };
}

describe("validateTenantForm — normal Add Tenant flow (toggle OFF)", () => {
  it("accepts a fully-filled valid form", () => {
    expect(validateTenantForm(form(), ctx())).toBeNull();
  });

  it("requires name, contact, and a selected room", () => {
    expect(validateTenantForm(form({ name: "  " }), ctx())).toBe("Tenant name is required.");
    expect(validateTenantForm(form({ contact: "" }), ctx())).toBe("Contact number is required.");
    expect(validateTenantForm(form({ room_id: "" }), ctx())).toBe("Please select an assigned room.");
  });

  it("rejects an unknown room", () => {
    expect(validateTenantForm(form(), ctx({ room: null }))).toBe("Selected room no longer exists.");
  });

  it("validates the monthly rate (required, non-negative number)", () => {
    expect(validateTenantForm(form({ monthly_rate: "" }), ctx())).toBe("Monthly rate must be 0 or more.");
    expect(validateTenantForm(form({ monthly_rate: "-5" }), ctx())).toBe("Monthly rate must be 0 or more.");
    expect(validateTenantForm(form({ monthly_rate: "0" }), ctx())).toBeNull();
  });

  it("requires move-in and due dates, and due date ≥ move-in date", () => {
    expect(validateTenantForm(form({ move_in_date: "" }), ctx())).toBe("Move-in date is required.");
    expect(validateTenantForm(form({ due_date: "" }), ctx())).toBe("Due date is required.");
    expect(validateTenantForm(form({ move_in_date: "2026-09-10", due_date: "2026-09-01" }), ctx())).toBe(
      "Due date should not be before the move-in date."
    );
  });

  it("ignores the beds field in normal mode (hidden in the UI)", () => {
    expect(validateTenantForm(form({ beds_occupied: "" }), ctx())).toBeNull();
    expect(validateTenantForm(form({ beds_occupied: "0" }), ctx())).toBeNull();
  });

  it("blocks full rooms", () => {
    expect(
      validateTenantForm(
        form(),
        ctx({ room: { ...room, capacity: 2, occupied_beds: 2 } })
      )
    ).toBe("101 is full (2/2). Choose another room.");
  });

  it("blocks maintenance and whole-reserved rooms", () => {
    expect(validateTenantForm(form(), ctx({ room: { ...room, maintenance: 1 } }))).toBe(
      "101 is under maintenance. Choose another room."
    );
    expect(validateTenantForm(form(), ctx({ room: { ...room, whole_reservations: 1 } }))).toBe(
      "101 is held — cancel or convert the reservation first."
    );
  });

  it("allows a same-room edit in a full room (mover stays put)", () => {
    // Editing tenant staying in their current room → always allowed.
    expect(
      validateTenantForm(
        form({ room_id: "1" }),
        ctx({ isAdding: false, currentRoomIsSame: true, moverBeds: 1, room: { ...room, occupied_beds: 2 } })
      )
    ).toBeNull();
  });

  it("validates deposit and advance money when present (non-negative numbers)", () => {
    expect(validateTenantForm(form({ deposit_amount: "-1" }), ctx())).toBe("Deposit must be 0 or more.");
    expect(validateTenantForm(form({ advance_amount: "abc" }), ctx())).toBe("Advance payment must be 0 or more.");
    expect(validateTenantForm(form({ deposit_amount: "0", advance_amount: "0" }), ctx())).toBeNull();
  });
});

describe("validateTenantForm — Already boarding (toggle ON)", () => {
  const boardingCtx = (overrides: Partial<TenantFormValidationContext> = {}) =>
    ctx({ boarding: true, ...overrides });

  it("accepts a valid backfill form (past move-in, future due date)", () => {
    expect(
      validateTenantForm(form({ move_in_date: "2026-05-01", due_date: "2026-10-01" }), boardingCtx())
    ).toBeNull();
  });

  it("rejects a future move-in date", () => {
    expect(
      validateTenantForm(form({ move_in_date: "2026-09-15", due_date: "2026-10-01" }), boardingCtx())
    ).toBe("Move-in date cannot be in the future for an already-boarding tenant.");
  });

  it("accepts today and past move-in dates", () => {
    expect(
      validateTenantForm(form({ move_in_date: "2026-09-09", due_date: "2026-10-01" }), boardingCtx())
    ).toBeNull();
    expect(
      validateTenantForm(form({ move_in_date: "2026-01-01", due_date: "2026-02-01" }), boardingCtx())
    ).toBeNull();
  });

  it("still requires a due date, but allows past due dates (arrears)", () => {
    expect(validateTenantForm(form({ due_date: "" }), boardingCtx())).toBe("Due date is required.");
    // Past due date ≥ move-in → accepted (landlord may record arrears).
    expect(
      validateTenantForm(form({ move_in_date: "2026-01-01", due_date: "2026-06-01" }), boardingCtx())
    ).toBeNull();
    // Due before move-in still rejected.
    expect(
      validateTenantForm(form({ move_in_date: "2026-06-01", due_date: "2026-05-01" }), boardingCtx())
    ).toBe("Due date should not be before the move-in date.");
  });

  it("validates beds occupied as a whole number ≥ 1", () => {
    expect(validateTenantForm(form({ beds_occupied: "" }), boardingCtx())).toBe(
      "Beds occupied must be a whole number of at least 1."
    );
    expect(validateTenantForm(form({ beds_occupied: "0" }), boardingCtx())).toBe(
      "Beds occupied must be a whole number of at least 1."
    );
    expect(validateTenantForm(form({ beds_occupied: "1.5" }), boardingCtx())).toBe(
      "Beds occupied must be a whole number of at least 1."
    );
    expect(validateTenantForm(form({ beds_occupied: "3" }), boardingCtx())).toBeNull();
  });

  it("skips ALL room checks (full, maintenance, whole-reserved)", () => {
    expect(
      validateTenantForm(form(), boardingCtx({ room: { ...room, capacity: 2, occupied_beds: 2 } }))
    ).toBeNull();
    expect(
      validateTenantForm(form(), boardingCtx({ room: { ...room, maintenance: 1 } }))
    ).toBeNull();
    expect(
      validateTenantForm(form(), boardingCtx({ room: { ...room, whole_reservations: 1 } }))
    ).toBeNull();
    // Even a multi-bed backfill into an over-full room is fine — they're there.
    expect(
      validateTenantForm(
        form({ beds_occupied: "2" }),
        boardingCtx({ room: { ...room, capacity: 2, occupied_beds: 2 } })
      )
    ).toBeNull();
  });

  it("keeps the shared rules (name, contact, rate, deposit, advance)", () => {
    expect(validateTenantForm(form({ name: "" }), boardingCtx())).toBe("Tenant name is required.");
    expect(validateTenantForm(form({ contact: "" }), boardingCtx())).toBe("Contact number is required.");
    expect(validateTenantForm(form({ monthly_rate: "-1" }), boardingCtx())).toBe(
      "Monthly rate must be 0 or more."
    );
    expect(validateTenantForm(form({ deposit_amount: "-1" }), boardingCtx())).toBe(
      "Deposit must be 0 or more."
    );
    expect(validateTenantForm(form({ advance_amount: "-1" }), boardingCtx())).toBe(
      "Advance payment must be 0 or more."
    );
  });
});