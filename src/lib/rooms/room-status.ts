/**
 * Room status is system-owned: it is derived from the maintenance flag,
 * active reservations, and active tenants — never stored or hand-edited.
 *
 * Both SQL fragments below must be used in queries where the rooms table is
 * aliased as `r` (e.g. `FROM rooms r`).
 */

export type RoomStatus = "Vacant" | "Reserved" | "Occupied" | "Maintenance";

/**
 * Derived status expression. Precedence:
 * 1. Maintenance flag overrides everything.
 * 2. An active whole-room hold → Reserved.
 * 3. Any active tenant → Occupied.
 * 4. An active partial hold (bed/custom, with no tenants yet) → Reserved.
 * 5. Otherwise → Vacant.
 */
export const ROOM_STATUS_SQL = `
CASE
  WHEN r.maintenance = 1 THEN 'Maintenance'
  WHEN EXISTS(SELECT 1 FROM reservations x WHERE x.room_id = r.id
              AND x.status = 'active' AND x.hold_type = 'whole') THEN 'Reserved'
  WHEN (SELECT COUNT(*) FROM tenants t WHERE t.room_id = r.id
        AND t.moved_out_date IS NULL) > 0 THEN 'Occupied'
  WHEN EXISTS(SELECT 1 FROM reservations x WHERE x.room_id = r.id
              AND x.status = 'active') THEN 'Reserved'
  ELSE 'Vacant'
END`;

/**
 * Effective occupancy = beds occupied by active tenants (SUM of
 * beds_occupied — a tenant may hold several beds, room-bed-view-spec) + beds
 * held by active partial holds ('bed'/'custom'). A whole-room hold is treated
 * as full by the capacity trigger, so it is intentionally not counted here
 * (the room shows a "Reserved" badge instead).
 */
export const EFFECTIVE_OCCUPANCY_SQL = `
  (SELECT COALESCE(SUM(t.beds_occupied), 0) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL)
  + (SELECT COALESCE(SUM(x.bed_count), 0) FROM reservations x WHERE x.room_id = r.id
     AND x.status = 'active' AND x.hold_type IN ('bed','custom'))`;

/** CSS badge class for a status string, e.g. "Maintenance" → "badge-maintenance". */
export function badgeClass(status: string): string {
  return `badge-${status.toLowerCase()}`;
}
