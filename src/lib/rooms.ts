/**
 * Shared room-occupancy helpers used by the rooms, tenants, and dashboard
 * pages.
 *
 * Every function takes primitives rather than a room object so each page can
 * pass its own query shape (the SQL field names differ per page:
 * `slot_reservations` vs `slot_holds` vs `reservation.scope`).
 *
 * Effective occupancy mirrors the DB rules: active tenants + active one-slot
 * reservations count toward capacity; a whole-room hold is treated as full.
 */

/** Active tenants + active one-slot holds. */
export function effectiveOccupancy(tenantCount: number, slotHolds: number): number {
  return tenantCount + slotHolds;
}

/** Occupancy as a 0–100 percentage, clamped to 100. */
export function pct(occupied: number, capacity: number): number {
  return capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
}

/** Whether a reservation scope is a one-slot hold (1) or not (0). */
export function heldCount(scope: string | null | undefined): number {
  return scope === "slot" ? 1 : 0;
}

/** Rooms the DB would reject a new/moved tenant for (maintenance or whole-room hold). */
export function roomUnavailable(maintenance: number, wholeReservations: number): boolean {
  return maintenance === 1 || wholeReservations > 0;
}

/** Whether effective occupancy has reached capacity. */
export function isRoomFull(tenantCount: number, slotHolds: number, capacity: number): boolean {
  return effectiveOccupancy(tenantCount, slotHolds) >= capacity;
}
