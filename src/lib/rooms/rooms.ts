import type { RoomStatus } from "./room-status";

/**
 * Shared room-occupancy helpers used by the rooms, tenants, and dashboard
 * pages.
 *
 * Functions take primitives rather than a room object so each page can pass
 * its own query shape (the SQL field names differ per page:
 * `held_beds` vs a raw reservation row). The one room shape
 * here is the minimal cross-page interface the boarder detail sheet reads,
 * satisfied structurally by each page's own room type.
 *
 * Effective occupancy mirrors the DB rules: beds occupied by active tenants
 * (SUM of `beds_occupied`) + beds held by active partial holds count toward
 * capacity; a whole-room hold is treated as full.
 */

/**
 * The room fields the boarder detail sheet reads. Both the rooms page's `Room`
 * and the dashboard's `DashboardRoom` satisfy this shape structurally, so the
 * shared sheet component can be fed from either page.
 */
export interface BoarderSheetRoom {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  status: RoomStatus;
  /** Beds occupied by active tenants (SUM of tenants.beds_occupied). */
  occupied_beds: number;
  held_beds: number;
}

/** Beds occupied by tenants + beds held by active partial holds. */
export function effectiveOccupancy(occupiedBeds: number, heldBeds: number): number {
  return occupiedBeds + heldBeds;
}

/** Occupancy as a 0–100 percentage, clamped to 100. */
export function pct(occupied: number, capacity: number): number {
  return capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
}

/** Rooms the DB would reject a new/moved tenant for (maintenance or whole-room hold). */
export function roomUnavailable(maintenance: number, wholeReservations: number): boolean {
  return maintenance === 1 || wholeReservations > 0;
}

/** Whether effective occupancy has reached capacity. */
export function isRoomFull(occupiedBeds: number, heldBeds: number, capacity: number): boolean {
  return effectiveOccupancy(occupiedBeds, heldBeds) >= capacity;
}
