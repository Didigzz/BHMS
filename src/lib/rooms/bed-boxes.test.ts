import { describe, expect, it } from "vitest";
import { bedTag, buildBedBoxes } from "./bed-boxes";

describe("bedTag", () => {
  it("returns null for single-bed tenants", () => {
    expect(bedTag(1, 5)).toBeNull();
  });

  it("labels partial multi-bed occupancy", () => {
    expect(bedTag(3, 5)).toBe("Occupies 3 beds");
  });

  it("labels a tenant filling the whole room", () => {
    expect(bedTag(5, 5)).toBe("Whole Room");
    expect(bedTag(4, 4)).toBe("Whole Room");
  });
});

describe("buildBedBoxes", () => {
  it("renders one box per slot with tenants first, then vacant", () => {
    const boxes = buildBedBoxes(
      [
        { id: 1, name: "Alice", beds_occupied: 1 },
        { id: 2, name: "Bob", beds_occupied: 2 },
      ],
      5
    );
    expect(boxes).toHaveLength(5);
    expect(boxes.map((b) => b.kind)).toEqual(["tenant", "tenant", "tenant", "vacant", "vacant"]);
    const tenants = boxes.filter((b) => b.kind === "tenant");
    expect(tenants).toHaveLength(3);
  });

  it("gives a multi-bed tenant one box per bed, all carrying the tag", () => {
    const boxes = buildBedBoxes([{ id: 7, name: "Cara", beds_occupied: 3 }], 5);
    const occupied = boxes.filter((b) => b.kind === "tenant");
    expect(occupied).toHaveLength(3);
    for (const b of occupied) {
      expect(b).toMatchObject({ tenantId: 7, name: "Cara", tag: "Occupies 3 beds" });
    }
    expect(boxes.filter((b) => b.kind === "vacant")).toHaveLength(2);
  });

  it("tags every box 'Whole Room' when the tenant fills the capacity", () => {
    const boxes = buildBedBoxes([{ id: 3, name: "Dan", beds_occupied: 4 }], 4);
    expect(boxes).toHaveLength(4);
    expect(boxes.every((b) => b.kind === "tenant")).toBe(true);
    for (const b of boxes) {
      expect(b).toMatchObject({ tag: "Whole Room", wholeRoom: true });
    }
  });

  it("renders all-vacant boxes for an empty room", () => {
    const boxes = buildBedBoxes([], 3);
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.kind === "vacant")).toBe(true);
  });

  it("shows held beds as their own boxes, keeping the total at capacity", () => {
    const boxes = buildBedBoxes([{ id: 1, name: "A", beds_occupied: 2 }], 5, 1);
    expect(boxes).toHaveLength(5);
    expect(boxes.map((b) => b.kind)).toEqual(["tenant", "tenant", "held", "vacant", "vacant"]);
  });

  it("clamps held boxes so they never overflow capacity", () => {
    const boxes = buildBedBoxes([{ id: 1, name: "A", beds_occupied: 4 }], 5, 3);
    expect(boxes).toHaveLength(5);
    expect(boxes.filter((b) => b.kind === "held")).toHaveLength(1);
    expect(boxes.filter((b) => b.kind === "vacant")).toHaveLength(0);
  });

  it("keeps box keys unique", () => {
    const boxes = buildBedBoxes(
      [
        { id: 1, name: "Alice", beds_occupied: 2 },
        { id: 2, name: "Bob", beds_occupied: 1 },
      ],
      5
    );
    const keys = new Set(boxes.map((b) => b.key));
    expect(keys.size).toBe(boxes.length);
  });

  it("is defensive: no vacant boxes when occupancy exceeds capacity", () => {
    const boxes = buildBedBoxes([{ id: 1, name: "Eve", beds_occupied: 6 }], 4);
    expect(boxes).toHaveLength(6);
    expect(boxes.every((b) => b.kind === "tenant")).toBe(true);
  });

  it("treats a zero bed count as one bed", () => {
    const boxes = buildBedBoxes([{ id: 1, name: "Zero", beds_occupied: 0 }], 2);
    expect(boxes.filter((b) => b.kind === "tenant")).toHaveLength(1);
    expect(boxes.filter((b) => b.kind === "vacant")).toHaveLength(1);
  });
});
