import type Database from "@tauri-apps/plugin-sql";

import type { CreateAmenityBillInput } from "./types";
import { ERROR_MESSAGES } from "./validation";

// ---------------------------------------------------------------------------
// Browser-preview fallback (the shim is a single connection, so BEGIN/COMMIT
// here really is one transaction). The Tauri path above never runs this.
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

async function previousShares(
  db: Database,
  billId: number,
): Promise<Map<number, number>> {
  const rows = await db.select<{ tenant_id: number; amount: number; is_excluded: number }[]>(
    "SELECT tenant_id, amount, is_excluded FROM amenity_bill_tenants WHERE bill_id=$1",
    [billId],
  );
  const shares = new Map<number, number>();
  for (const row of rows) shares.set(row.tenant_id, row.is_excluded ? 0 : row.amount);
  return shares;
}

async function snapshotOf(db: Database, tenantId: number): Promise<{ name: string; room: string }> {
  const rows = await db.select<{ name: string; room_number: string }[]>(
    "SELECT t.name, r.room_number FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.id=$1",
    [tenantId],
  );
  const row = rows[0];
  return { name: row?.name ?? `Tenant ${tenantId}`, room: row?.room_number ?? "—" };
}

export async function saveAmenityBillLocally(
  db: Database,
  input: CreateAmenityBillInput,
  billId: number | null,
): Promise<{ error: string | null; billId: number | null }> {
  const now = nowIso();
  // Same edit lock as the Rust command: recorded money freezes the bill.
  if (billId != null) {
    const active = await db.select<{ total: number }[]>(
      "SELECT COUNT(*) AS total FROM amenity_payments WHERE bill_id=$1 AND status='active'",
      [billId],
    );
    if ((active[0]?.total ?? 0) > 0) {
      return { error: ERROR_MESSAGES["amenity:paid-locked"], billId: null };
    }
  }
  const previous = billId != null ? await previousShares(db, billId) : new Map<number, number>();
  const excludedIds = new Set(input.excluded.keys());
  const manualIds = new Set(input.manualIds ?? []);

  try {
    await db.execute("BEGIN");

    let actualId = billId ?? 0;
    if (billId != null) {
      await db.execute(
        "UPDATE amenity_bills SET amenity_name=$1, billing_method=$2, total_amount=$3, billing_date=$4, billing_period=$5, notes=$6, division_mode=$7, meter_start=$8, meter_end=$9, price_per_unit=$10, updated_at=$11 WHERE id=$12",
        [
          input.amenity_name.trim(),
          input.billing_method,
          input.total_amount,
          input.billing_date,
          input.billing_period ?? null,
          input.notes ?? null,
          input.division_mode,
          input.meter_start ?? null,
          input.meter_end ?? null,
          input.price_per_unit ?? null,
          now,
          billId,
        ],
      );
      await db.execute("DELETE FROM amenity_bill_tenants WHERE bill_id=$1", [billId]);
      await db.execute("DELETE FROM amenity_bill_rooms WHERE bill_id=$1", [billId]);
    } else {
      await db.execute(
        "INSERT INTO amenity_bills (amenity_name, billing_method, total_amount, billing_date, billing_period, notes, division_mode, status, meter_start, meter_end, price_per_unit, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [
          input.amenity_name.trim(),
          input.billing_method,
          input.total_amount,
          input.billing_date,
          input.billing_period ?? null,
          input.notes ?? null,
          input.division_mode,
          "active",
          input.meter_start ?? null,
          input.meter_end ?? null,
          input.price_per_unit ?? null,
          now,
          now,
        ],
      );
      const inserted = await db.select<{ id: number }[]>(
        "SELECT last_insert_rowid() as id",
      );
      actualId = inserted[0]?.id ?? 0;
    }

    // One row per tenant: included tenants carry their share, excluded ones ₱0.
    for (const [tenantId, amount] of input.tenantShares) {
      if (excludedIds.has(tenantId)) continue;
      const snapshot = await snapshotOf(db, tenantId);
      await db.execute(
        "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot, is_manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          actualId,
          tenantId,
          amount,
          0,
          null,
          "Unpaid",
          snapshot.name,
          snapshot.room,
          manualIds.has(tenantId) ? 1 : 0,
        ],
      );
    }
    for (const [tenantId, reason] of input.excluded) {
      const snapshot = await snapshotOf(db, tenantId);
      await db.execute(
        "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot, is_manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [actualId, tenantId, 0, 1, reason.trim(), "Unpaid", snapshot.name, snapshot.room, 0],
      );
    }

    const roomIds: number[] = [];
    for (const roomId of input.roomIds) {
      if (roomIds.includes(roomId)) continue;
      roomIds.push(roomId);
      const rows = await db.select<{ room_number: string }[]>(
        "SELECT room_number FROM rooms WHERE id=$1",
        [roomId],
      );
      await db.execute(
        "INSERT INTO amenity_bill_rooms (bill_id, room_id, room_number_snapshot) VALUES ($1,$2,$3)",
        [actualId, roomId, rows[0]?.room_number ?? `Room ${roomId}`],
      );
    }

    const next = new Map<number, number>();
    for (const [tenantId, amount] of input.tenantShares) {
      if (!excludedIds.has(tenantId)) next.set(tenantId, amount);
    }
    for (const tenantId of input.excluded.keys()) next.set(tenantId, 0);

    for (const tenantId of new Set([...previous.keys(), ...next.keys()])) {
      const delta =
        Math.round((((next.get(tenantId) ?? 0) - (previous.get(tenantId) ?? 0)) * 100)) / 100;
      if (delta !== 0) {
        await db.execute("UPDATE tenants SET amenity_balance = amenity_balance + $1 WHERE id=$2", [
          delta,
          tenantId,
        ]);
      }
    }

    await db.execute("COMMIT");
    return { error: null, billId: actualId };
  } catch (e) {
    try {
      await db.execute("ROLLBACK");
    } catch {}
    return { error: String(e), billId: null };
  }
}

export async function cancelAmenityBillLocally(
  db: Database,
  billId: number,
): Promise<{ error: string | null }> {
  const rows = await db.select<{ status: string }[]>(
    "SELECT status FROM amenity_bills WHERE id=$1",
    [billId],
  );
  if (rows.length === 0) return { error: ERROR_MESSAGES["amenity:not-found"] };
  if (rows[0].status === "cancelled") return { error: ERROR_MESSAGES["amenity:already-cancelled"] };

  const tenants = await db.select<{ tenant_id: number; amount: number }[]>(
    "SELECT tenant_id, amount FROM amenity_bill_tenants WHERE bill_id=$1",
    [billId],
  );
  const payments = await db.select<{ id: number; bill_tenant_id: number; tenant_id: number; amount: number }[]>(
    "SELECT id, bill_tenant_id, tenant_id, amount FROM amenity_payments WHERE bill_id=$1 AND status='active'",
    [billId],
  );

  try {
    await db.execute("BEGIN");
    const now = nowIso();
    await db.execute("UPDATE amenity_bills SET status='cancelled', updated_at=$1 WHERE id=$2", [
      now,
      billId,
    ]);
    // Reverse recorded money first, exactly like the Rust cancel path, so a
    // fully paid tenant nets +paid - share = 0.
    for (const payment of payments) {
      await db.execute(
        "UPDATE amenity_payments SET status='reversed', reversal_reason='Bill cancelled', reversed_at=$1, updated_at=$1 WHERE id=$2 AND status='active'",
        [now, payment.id],
      );
      await db.execute("UPDATE amenity_bill_tenants SET payment_status='Unpaid' WHERE id=$1", [
        payment.bill_tenant_id,
      ]);
      await db.execute("UPDATE tenants SET amenity_balance = ROUND(amenity_balance + $1, 2) WHERE id=$2", [
        payment.amount,
        payment.tenant_id,
      ]);
    }
    for (const tenant of tenants) {
      if (tenant.amount > 0) {
        await db.execute(
          "UPDATE tenants SET amenity_balance = CASE WHEN ROUND(amenity_balance - $1, 2) = 0 THEN 0 ELSE ROUND(amenity_balance - $1, 2) END WHERE id=$2",
          [tenant.amount, tenant.tenant_id],
        );
      }
    }
    await db.execute("COMMIT");
    return { error: null };
  } catch (e) {
    try {
      await db.execute("ROLLBACK");
    } catch {}
    return { error: String(e) };
  }
}
