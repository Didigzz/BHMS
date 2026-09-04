/**
 * Bed-grid builder for the room sheet's two-level view (room-bed-view-spec).
 *
 * Level 1 of the room sheet shows exactly `capacity` boxes — one per slot:
 * a multi-bed tenant fills one box per bed (all carrying the same tag, e.g.
 * "Occupies 3 beds" / "Whole Room"), and unused slots become dashed vacant
 * boxes. Keeping the box count equal to capacity is what lets the landlord
 * see at a glance how many slots are actually taken.
 *
 * Pure function — no Svelte, no I/O — so it is unit-testable.
 */

/** Minimal tenant shape the grid builder needs. */
export interface BedBoxTenant {
  id: number;
  name: string;
  beds_occupied: number;
}

export type BedBox =
  | {
      kind: "tenant";
      key: string;
      tenantId: number;
      name: string;
      /** The tenant's total bed count (tag text reads from this). */
      beds: number;
      /** "Occupies N beds" / "Whole Room" — null for single-bed tenants. */
      tag: string | null;
      /** True when the tenant fills the whole room (beds == capacity). */
      wholeRoom: boolean;
    }
  | { kind: "held"; key: string }
  | { kind: "vacant"; key: string };

/**
 * The tag shown on every box of a multi-bed tenant:
 * - beds == capacity → "Whole Room" (tenant fills the entire room)
 * - beds > 1        → "Occupies N beds"
 * - otherwise       → null (single-bed tenants need no tag)
 */
export function bedTag(beds: number, capacity: number): string | null {
  if (beds <= 1) return null;
  if (beds >= capacity) return "Whole Room";
  return `Occupies ${beds} beds`;
}

/**
 * Build the capacity-sized box list: tenant boxes first (tenant id order,
 * one per occupied bed), then boxes for beds held by partial reservations,
 * then vacant boxes to fill the room. Multi-bed tenants get `beds_occupied`
 * boxes each — any positions within their block (no adjacency requirement).
 *
 * Held slots get their own dashed "Held" box so a reserved bed never looks
 * free, while the total box count still equals capacity. Defensive: a
 * beds_occupied < 1 is treated as 1, and a room that somehow exceeds
 * capacity simply has no vacant boxes.
 */
export function buildBedBoxes(tenants: BedBoxTenant[], capacity: number, heldBeds = 0): BedBox[] {
  const boxes: BedBox[] = [];
  let occupied = 0;
  for (const t of tenants) {
    const n = Math.max(1, t.beds_occupied);
    const tag = bedTag(n, capacity);
    const wholeRoom = n >= capacity;
    for (let i = 0; i < n; i++) {
      boxes.push({ kind: "tenant", key: `t${t.id}-${i}`, tenantId: t.id, name: t.name, beds: n, tag, wholeRoom });
    }
    occupied += n;
  }
  const held = Math.min(Math.max(0, heldBeds), Math.max(0, capacity - occupied));
  for (let i = 0; i < held; i++) {
    boxes.push({ kind: "held", key: `h${i}` });
  }
  const vacant = Math.max(0, capacity - occupied - held);
  for (let i = 0; i < vacant; i++) {
    boxes.push({ kind: "vacant", key: `v${i}` });
  }
  return boxes;
}
