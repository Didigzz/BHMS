import { describe, expect, it, vi } from "vitest";
import {
  capacityHint,
  holdOptionDisabled,
  insertReservation,
  remainingBeds,
  roomFitsHold,
  saveDisabledForCapacity,
  type CapacityRoom,
  type ReservationFormState,
} from "./reservations";

/** A 4-bed room, 1 occupied — the spec's 1/4 example (3 beds free). */
const partial: CapacityRoom = {
  capacity: 4,
  occupied_beds: 1,
  held_beds: 0,
  has_whole_hold: 0,
  maintenance: 0,
};

/** A fully vacant 4-bed room. */
const vacant: CapacityRoom = {
  capacity: 4,
  occupied_beds: 0,
  held_beds: 0,
  has_whole_hold: 0,
  maintenance: 0,
};

/** A full 4-bed room (4 occupied). */
const full: CapacityRoom = {
  capacity: 4,
  occupied_beds: 4,
  held_beds: 0,
  has_whole_hold: 0,
  maintenance: 0,
};

/** A vacant room under a whole-room hold. */
const wholeHeld: CapacityRoom = {
  capacity: 4,
  occupied_beds: 0,
  held_beds: 0,
  has_whole_hold: 1,
  maintenance: 0,
};

/** A vacant room with 2 of 4 beds held by partial holds. */
const partiallyHeld: CapacityRoom = {
  capacity: 4,
  occupied_beds: 0,
  held_beds: 2,
  has_whole_hold: 0,
  maintenance: 0,
};

const maintenance: CapacityRoom = { ...vacant, maintenance: 1 };

describe("remainingBeds", () => {
  it("subtracts occupied beds and partial holds from capacity", () => {
    expect(remainingBeds(partial)).toBe(3);
    expect(remainingBeds(partiallyHeld)).toBe(2);
  });

  it("never goes below zero for an over-full room", () => {
    expect(remainingBeds({ ...vacant, capacity: 4, occupied_beds: 5 })).toBe(-1);
  });
});

describe("roomFitsHold", () => {
  it("allows a whole-room hold only on a fully vacant room", () => {
    expect(roomFitsHold(vacant, "whole", null)).toBe(true);
    expect(roomFitsHold(partial, "whole", null)).toBe(false);
    expect(roomFitsHold(partiallyHeld, "whole", null)).toBe(false);
    expect(roomFitsHold(wholeHeld, "whole", null)).toBe(false);
  });

  it("allows partial holds up to the remaining beds", () => {
    expect(roomFitsHold(partial, "bed", 1)).toBe(true);
    expect(roomFitsHold(partial, "custom", 3)).toBe(true);
    expect(roomFitsHold(partial, "custom", 4)).toBe(false); // exceeds 3 free
    expect(roomFitsHold(full, "bed", 1)).toBe(false);
  });

  it("rejects partial holds on a whole-held or maintenance room", () => {
    expect(roomFitsHold(wholeHeld, "bed", 1)).toBe(false);
    expect(roomFitsHold(maintenance, "bed", 1)).toBe(false);
    expect(roomFitsHold(maintenance, "whole", null)).toBe(false);
  });

  it("rejects non-integer or sub-1 custom counts", () => {
    expect(roomFitsHold(partial, "custom", 0)).toBe(false);
    expect(roomFitsHold(partial, "custom", 2.5)).toBe(false);
    expect(roomFitsHold(partial, "custom", null)).toBe(false);
  });
});

describe("holdOptionDisabled", () => {
  it("disables Whole room on a partially occupied / partially held room", () => {
    expect(holdOptionDisabled(partial, "whole")).toBe(true);
    expect(holdOptionDisabled(partiallyHeld, "whole")).toBe(true);
    expect(holdOptionDisabled(vacant, "whole")).toBe(false);
  });

  it("disables One bed only when no bed is free", () => {
    expect(holdOptionDisabled(full, "bed")).toBe(true);
    expect(holdOptionDisabled(partial, "bed")).toBe(false);
  });

  it("never disables Custom in the dropdown (the count is gated via Save)", () => {
    expect(holdOptionDisabled(full, "custom")).toBe(false);
    expect(holdOptionDisabled(partial, "custom")).toBe(false);
  });

  it("disables every option on a whole-held or maintenance room", () => {
    expect(holdOptionDisabled(wholeHeld, "whole")).toBe(true);
    expect(holdOptionDisabled(wholeHeld, "bed")).toBe(true);
    expect(holdOptionDisabled(maintenance, "whole")).toBe(true);
    expect(holdOptionDisabled(maintenance, "bed")).toBe(true);
  });

  it("keeps options enabled when there is no room to judge against", () => {
    expect(holdOptionDisabled(undefined, "whole")).toBe(false);
    expect(holdOptionDisabled(null, "bed")).toBe(false);
  });
});

describe("saveDisabledForCapacity", () => {
  it("blocks Whole room on a partially occupied room (1/4 example)", () => {
    expect(saveDisabledForCapacity(partial, "whole", NaN)).toBe(true);
    expect(saveDisabledForCapacity(vacant, "whole", NaN)).toBe(false);
  });

  it("blocks Whole room when any hold exists", () => {
    expect(saveDisabledForCapacity(partiallyHeld, "whole", NaN)).toBe(true);
    expect(saveDisabledForCapacity(wholeHeld, "whole", NaN)).toBe(true);
  });

  it("blocks One bed only when the room is full", () => {
    expect(saveDisabledForCapacity(full, "bed", NaN)).toBe(true);
    expect(saveDisabledForCapacity(partial, "bed", NaN)).toBe(false);
  });

  it("blocks Custom above the remaining beds and for invalid counts", () => {
    expect(saveDisabledForCapacity(partial, "custom", 3)).toBe(false); // exactly the free beds
    expect(saveDisabledForCapacity(partial, "custom", 4)).toBe(true); // exceeds
    expect(saveDisabledForCapacity(partial, "custom", 0)).toBe(true);
    expect(saveDisabledForCapacity(partial, "custom", 2.5)).toBe(true);
    expect(saveDisabledForCapacity(partial, "custom", NaN)).toBe(true); // untyped
  });

  it("blocks Custom on a full room (cap of 0)", () => {
    expect(saveDisabledForCapacity(full, "custom", 1)).toBe(true);
  });

  it("blocks every selection on a whole-held or maintenance room", () => {
    expect(saveDisabledForCapacity(wholeHeld, "bed", NaN)).toBe(true);
    expect(saveDisabledForCapacity(wholeHeld, "custom", 1)).toBe(true);
    expect(saveDisabledForCapacity(maintenance, "bed", NaN)).toBe(true);
    expect(saveDisabledForCapacity(maintenance, "custom", 1)).toBe(true);
  });

  it("never blocks Save for capacity when there is no room (submit-time validation)", () => {
    expect(saveDisabledForCapacity(undefined, "whole", NaN)).toBe(false);
    expect(saveDisabledForCapacity(null, "custom", 99)).toBe(false);
  });
});

describe("capacityHint", () => {
  it("explains why Whole room is unavailable on a partial room — even while another option is selected", () => {
    expect(capacityHint(partial, "whole", NaN)).toBe(
      "Whole room unavailable — 1 of 4 beds occupied"
    );
    expect(capacityHint(partial, "bed", NaN)).toBe(
      "Whole room unavailable — 1 of 4 beds occupied"
    );
  });

  it("explains the hold case and the full-room case", () => {
    expect(capacityHint(partiallyHeld, "whole", NaN)).toContain("already has an active hold");
    expect(capacityHint(full, "bed", NaN)).toBe("Room is full — no beds left to hold");
    expect(capacityHint(wholeHeld, "bed", NaN)).toBe("Room is fully reserved for the whole room.");
    expect(capacityHint(maintenance, "bed", NaN)).toBe("Room is under maintenance.");
  });

  it("caps the custom count hint at the free beds (takes priority over the whole-room note)", () => {
    expect(capacityHint(partial, "custom", 4)).toBe("You can hold at most 3 beds.");
    // A valid custom count falls through to the whole-room explanation.
    expect(capacityHint(partial, "custom", 3)).toBe(
      "Whole room unavailable — 1 of 4 beds occupied"
    );
    expect(capacityHint(vacant, "custom", 4)).toBeNull(); // whole is valid here
  });

  it("is null when the selection is fine or there is no room", () => {
    expect(capacityHint(vacant, "whole", NaN)).toBeNull();
    expect(capacityHint(vacant, "bed", NaN)).toBeNull();
    expect(capacityHint(undefined, "whole", NaN)).toBeNull();
  });
});

describe("insertReservation", () => {
  function form(overrides: Partial<ReservationFormState> = {}): ReservationFormState {
    return {
      name: "Maria Santos",
      contact: "0917 123 4567",
      room_id: "3",
      reservation_date: "2026-09-01",
      target_move_in_date: "2026-09-15",
      hold_type: "whole",
      bed_count: "1",
      deposit: "",
      ...overrides,
    };
  }

  function mockDb(impl?: (sql: string, params: unknown[]) => Promise<void>) {
    const execute = vi.fn(impl ?? (async () => {}));
    return { execute } as unknown as Parameters<typeof insertReservation>[0];
  }

  it("maps whole-room holds to bed_count NULL", async () => {
    const db = mockDb();
    const err = await insertReservation(db, form());
    expect(err).toBeNull();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO reservations"),
      [3, "Maria Santos", "0917 123 4567", "2026-09-01", "2026-09-15", "whole", null, null]
    );
  });

  it("maps one-bed holds to bed_count 1 and custom to the typed count", async () => {
    const db = mockDb();
    await insertReservation(db, form({ hold_type: "bed" }));
    expect(db.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["bed", 1]));
    const db2 = mockDb();
    await insertReservation(db2, form({ hold_type: "custom", bed_count: "3" }));
    expect(db2.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["custom", 3]));
  });

  it("normalizes the optional deposit (empty string → null, typed → number)", async () => {
    const db = mockDb();
    await insertReservation(db, form());
    expect(db.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([null]));
    const db2 = mockDb();
    await insertReservation(db2, form({ deposit: 500 }));
    expect(db2.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([500]));
  });

  it("trims name and contact", async () => {
    const db = mockDb();
    await insertReservation(db, form({ name: "  Juan D.  ", contact: " 0918 " }));
    expect(db.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["Juan D.", "0918"]));
  });

  it("maps DB-trigger errors to friendly messages", async () => {
    const cases: [string, string][] = [
      ["Room is under maintenance", "That room is under maintenance."],
      ["Room already has tenants", "That room already has tenants — choose a bed hold instead."],
      ["Room is already reserved", "That room already has a conflicting hold."],
      ["Room is at full capacity", "That room has no beds left."],
    ];
    for (const [thrown, expected] of cases) {
      const db = mockDb(async () => {
        throw new Error(thrown);
      });
      expect(await insertReservation(db, form())).toBe(expected);
    }
  });

  it("passes through unknown errors with the raw message", async () => {
    // The sql plugin rejects with a plain string (not an Error object).
    const db = mockDb(async () => {
      throw "disk I/O error";
    });
    expect(await insertReservation(db, form())).toBe("Failed to save reservation: disk I/O error");
  });
});