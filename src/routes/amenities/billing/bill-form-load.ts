import { getDb } from "$lib/db/db";
import type { PickTenant } from "./bill-form-types";

/** A room row for the per-room picker. */
export interface RoomOption {
  id: number;
  room_number: string;
}

export const ALL_TENANTS_SQL =
  "SELECT t.id, t.name, r.room_number, t.room_id, t.moved_out_date FROM tenants t JOIN rooms r ON r.id=t.room_id ORDER BY t.name";

/** Every room (picker order) and every tenant (active + moved out; the form filters). */
export async function loadRoomsAndTenants(): Promise<{
  rooms: RoomOption[];
  allTenants: PickTenant[];
}> {
  const db = await getDb();
  const [rooms, allTenants] = await Promise.all([
    db.select<RoomOption[]>("SELECT id, room_number FROM rooms ORDER BY room_number"),
    db.select<PickTenant[]>(ALL_TENANTS_SQL),
  ]);
  return { rooms, allTenants };
}

/** One room's tenants, for the per-room billing method. */
export async function loadRoomTenants(roomId: number): Promise<PickTenant[]> {
  const db = await getDb();
  return db.select<PickTenant[]>(
    "SELECT t.id, t.name, r.room_number, t.room_id, t.moved_out_date FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.room_id=$1 ORDER BY t.name",
    [roomId],
  );
}

/** The two row sets an edit needs to hydrate the form from. */
export async function loadBillRows(billId: number): Promise<{
  tenantRows: {
    tenant_id: number;
    amount: number;
    is_excluded: number;
    is_manual: number;
    exclusion_reason: string | null;
  }[];
  roomRows: { room_id: number }[];
}> {
  const db = await getDb();
  const [tenantRows, roomRows] = await Promise.all([
    db.select<{
      tenant_id: number;
      amount: number;
      is_excluded: number;
      is_manual: number;
      exclusion_reason: string | null;
    }[]>("SELECT tenant_id, amount, is_excluded, is_manual, exclusion_reason FROM amenity_bill_tenants WHERE bill_id=$1", [
      billId,
    ]),
    db.select<{ room_id: number }[]>(
      "SELECT room_id FROM amenity_bill_rooms WHERE bill_id=$1",
      [billId],
    ),
  ]);
  return { tenantRows, roomRows };
}
