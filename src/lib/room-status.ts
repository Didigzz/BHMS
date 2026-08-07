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
 * 2. An active whole-room reservation → Reserved.
 * 3. Any active tenant → Occupied.
 * 4. An active one-slot reservation (with no tenants yet) → Reserved.
 * 5. Otherwise → Vacant.
 */
export const ROOM_STATUS_SQL = `
CASE
  WHEN r.maintenance = 1 THEN 'Maintenance'
  WHEN EXISTS(SELECT 1 FROM reservations x WHERE x.room_id = r.id
              AND x.status = 'active' AND x.scope = 'whole') THEN 'Reserved'
  WHEN (SELECT COUNT(*) FROM tenants t WHERE t.room_id = r.id
        AND t.moved_out_date IS NULL) > 0 THEN 'Occupied'
  WHEN EXISTS(SELECT 1 FROM reservations x WHERE x.room_id = r.id
              AND x.status = 'active') THEN 'Reserved'
  ELSE 'Vacant'
END`;

/**
 * Effective occupancy = active tenants + active one-slot reservations.
 * A whole-room reservation is treated as full by the capacity trigger, so it
 * is intentionally not counted here (the room shows a "Reserved" badge instead).
 */
export const EFFECTIVE_OCCUPANCY_SQL = `
  (SELECT COUNT(*) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL)
  + (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id
     AND x.status = 'active' AND x.scope = 'slot')`;

/** CSS badge class for a status string, e.g. "Maintenance" → "badge-maintenance". */
export function badgeClass(status: string): string {
  return `badge-${status.toLowerCase()}`;
}
