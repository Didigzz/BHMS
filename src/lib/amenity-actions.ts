import type Database from "@tauri-apps/plugin-sql";

export interface CreateAmenityBillInput {
  amenity_name: string;
  amenity_type: string;
  billing_method: string;
  total_amount: number;
  billing_date: string;
  billing_period?: string | null;
  notes?: string | null;
  division_mode: string;
  tenantShares: Map<number, number>;
  excluded: Map<number, string>;
  roomIds: number[];
  meter_start?: number | null;
  meter_end?: number | null;
  price_per_unit?: number | null;
}

export interface AmenityBillRow {
  id: number;
  amenity_name: string;
  amenity_type: string;
  billing_method: string;
  total_amount: number;
  billing_date: string;
  billing_period: string | null;
  notes: string | null;
  division_mode: string;
  status: string;
  meter_start: number | null;
  meter_end: number | null;
  price_per_unit: number | null;
  created_at: string;
  updated_at: string;
}

export interface AmenityBillTenantRow {
  id: number;
  bill_id: number;
  tenant_id: number;
  amount: number;
  is_excluded: number;
  exclusion_reason: string | null;
  payment_status: string;
  tenant_name_snapshot: string;
  room_number_snapshot: string;
}

export interface AmenityBillRoomRow {
  id: number;
  bill_id: number;
  room_id: number;
  room_number_snapshot: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function createAmenityBill(
  db: Database,
  input: CreateAmenityBillInput,
): Promise<{ error: string | null; billId: number | null }> {
  if (!input.amenity_name || input.amenity_name.trim() === "") {
    return { error: "Amenity name is required.", billId: null };
  }
  if (!input.total_amount || isNaN(input.total_amount) || input.total_amount <= 0) {
    return { error: "Bill amount cannot be empty or negative.", billId: null };
  }
  if (!input.billing_date) {
    return { error: "Billing date is required.", billId: null };
  }

  const tenantIds = [...input.tenantShares.keys(), ...input.excluded.keys()];
  const uniqueTenantIds = [...new Set(tenantIds)];

  if (input.billing_method === "shared" && uniqueTenantIds.length === 0) {
    return { error: "At least one tenant or room must be selected.", billId: null };
  }
  if (
    (input.billing_method === "per_room" || input.billing_method === "connected") &&
    input.roomIds.length === 0
  ) {
    return { error: "At least one tenant or room must be selected.", billId: null };
  }
  if (input.billing_method === "connected" && input.roomIds.length < 2) {
    return { error: "Connected-room groups must contain at least two rooms.", billId: null };
  }

  for (const [tid, reason] of input.excluded) {
    if (!reason || reason.trim() === "") {
      return { error: "An exclusion reason is required when excluding a tenant.", billId: null };
    }
  }

  let sum = 0;
  for (const v of input.tenantShares.values()) sum += v;
  sum = Math.round(sum * 100) / 100;
  if (input.division_mode === "manual" && Math.abs(sum - input.total_amount) > 0.01) {
    return {
      error: `Manual tenant amounts must equal the total bill (currently ${sum} vs ${input.total_amount}).`,
      billId: null,
    };
  }

  const now = nowIso();

  try {
    await db.execute("BEGIN");

    const res = await db.execute(
      "INSERT INTO amenity_bills (amenity_name, amenity_type, billing_method, total_amount, billing_date, billing_period, notes, division_mode, status, meter_start, meter_end, price_per_unit, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        input.amenity_name.trim(),
        input.amenity_type,
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
    const billId = (res as unknown as { lastInsertId: number }).lastInsertId ?? 0;
    const fetched = await db.select<{ id: number }[]>("SELECT last_insert_rowid() as id");
    const actualId = fetched[0]?.id ?? billId;

    for (const [tenantId, amount] of input.tenantShares) {
      const t = await db.select<{ name: string; room_number: string }[]>(
        "SELECT t.name, r.room_number FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.id=$1",
        [tenantId],
      );
      const snap = t[0] ?? { name: `Tenant ${tenantId}`, room_number: "—" };
      await db.execute(
        "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [actualId, tenantId, amount, 0, null, "Unpaid", snap.name, snap.room_number],
      );
      if (amount > 0) {
        await db.execute("UPDATE tenants SET amenity_balance = amenity_balance + $1 WHERE id=$2", [
          amount,
          tenantId,
        ]);
      }
    }

    for (const [tenantId, reason] of input.excluded) {
      const t = await db.select<{ name: string; room_number: string }[]>(
        "SELECT t.name, r.room_number FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.id=$1",
        [tenantId],
      );
      const snap = t[0] ?? { name: `Tenant ${tenantId}`, room_number: "—" };
      await db.execute(
        "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [actualId, tenantId, 0, 1, reason, "Unpaid", snap.name, snap.room_number],
      );
    }

    for (const roomId of input.roomIds) {
      const r = await db.select<{ room_number: string }[]>("SELECT room_number FROM rooms WHERE id=$1", [
        roomId,
      ]);
      const snap = r[0]?.room_number ?? `Room ${roomId}`;
      await db.execute(
        "INSERT INTO amenity_bill_rooms (bill_id, room_id, room_number_snapshot) VALUES ($1,$2,$3)",
        [actualId, roomId, snap],
      );
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

export async function updateAmenityBill(
  db: Database,
  billId: number,
  input: CreateAmenityBillInput,
): Promise<{ error: string | null }> {
  if (!input.amenity_name || input.amenity_name.trim() === "") {
    return { error: "Amenity name is required." };
  }
  if (!input.total_amount || isNaN(input.total_amount) || input.total_amount <= 0) {
    return { error: "Bill amount cannot be empty or negative." };
  }

  const existing = await db.select<{ status: string }[]>("SELECT status FROM amenity_bills WHERE id=$1", [
    billId,
  ]);
  if (existing.length === 0) return { error: "Bill not found." };
  if (existing[0].status === "cancelled") return { error: "Cancelled bills cannot be edited." };

  for (const [, reason] of input.excluded) {
    if (!reason || reason.trim() === "") {
      return { error: "An exclusion reason is required when excluding a tenant." };
    }
  }

  let sum = 0;
  for (const v of input.tenantShares.values()) sum = Math.round((sum + v) * 100) / 100;
  if (input.division_mode === "manual" && Math.abs(sum - input.total_amount) > 0.01) {
    return {
      error: `Manual tenant amounts must equal the total bill (currently ${sum} vs ${input.total_amount}).`,
    };
  }

  const previous = await db.select<AmenityBillTenantRow[]>(
    "SELECT id, tenant_id, amount, is_excluded FROM amenity_bill_tenants WHERE bill_id=$1",
    [billId],
  );

  const prevMap = new Map<number, number>();
  for (const row of previous) prevMap.set(row.tenant_id, row.is_excluded ? 0 : row.amount);

  const allTenantIds = new Set<number>([...prevMap.keys(), ...input.tenantShares.keys(), ...input.excluded.keys()]);

  const deltas = new Map<number, number>();
  for (const tid of allTenantIds) {
    const oldAmt = prevMap.get(tid) ?? 0;
    let newAmt = 0;
    if (input.excluded.has(tid)) newAmt = 0;
    else if (input.tenantShares.has(tid)) newAmt = input.tenantShares.get(tid) ?? 0;
    deltas.set(tid, Math.round((newAmt - oldAmt) * 100) / 100);
  }

  const now = nowIso();

  try {
    await db.execute("BEGIN");

    await db.execute(
      "UPDATE amenity_bills SET amenity_name=$1, amenity_type=$2, billing_method=$3, total_amount=$4, billing_date=$5, billing_period=$6, notes=$7, division_mode=$8, meter_start=$9, meter_end=$10, price_per_unit=$11, updated_at=$12 WHERE id=$13",
      [
        input.amenity_name.trim(),
        input.amenity_type,
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

    for (const [tenantId, amount] of input.tenantShares) {
      const t = await db.select<{ name: string; room_number: string }[]>(
        "SELECT t.name, r.room_number FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.id=$1",
        [tenantId],
      );
      const snap = t[0] ?? { name: `Tenant ${tenantId}`, room_number: "—" };
      await db.execute(
        "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [billId, tenantId, amount, 0, null, "Unpaid", snap.name, snap.room_number],
      );
    }
    for (const [tenantId, reason] of input.excluded) {
      const t = await db.select<{ name: string; room_number: string }[]>(
        "SELECT t.name, r.room_number FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.id=$1",
        [tenantId],
      );
      const snap = t[0] ?? { name: `Tenant ${tenantId}`, room_number: "—" };
      await db.execute(
        "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [billId, tenantId, 0, 1, reason, "Unpaid", snap.name, snap.room_number],
      );
    }

    for (const roomId of input.roomIds) {
      const r = await db.select<{ room_number: string }[]>("SELECT room_number FROM rooms WHERE id=$1", [
        roomId,
      ]);
      const snap = r[0]?.room_number ?? `Room ${roomId}`;
      await db.execute(
        "INSERT INTO amenity_bill_rooms (bill_id, room_id, room_number_snapshot) VALUES ($1,$2,$3)",
        [billId, roomId, snap],
      );
    }

    for (const [tid, delta] of deltas) {
      if (delta !== 0) {
        await db.execute("UPDATE tenants SET amenity_balance = amenity_balance + $1 WHERE id=$2", [
          delta,
          tid,
        ]);
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

export async function cancelAmenityBill(
  db: Database,
  billId: number,
): Promise<{ error: string | null }> {
  const rows = await db.select<{ status: string }[]>("SELECT status FROM amenity_bills WHERE id=$1", [
    billId,
  ]);
  if (rows.length === 0) return { error: "Bill not found." };
  if (rows[0].status === "cancelled") return { error: "Already cancelled." };

  const tenants = await db.select<AmenityBillTenantRow[]>(
    "SELECT tenant_id, amount, is_excluded FROM amenity_bill_tenants WHERE bill_id=$1",
    [billId],
  );

  try {
    await db.execute("BEGIN");
    await db.execute("UPDATE amenity_bills SET status='cancelled', updated_at=$1 WHERE id=$2", [
      nowIso(),
      billId,
    ]);
    for (const t of tenants) {
      if (t.is_excluded) continue;
      if (t.amount > 0) {
        await db.execute("UPDATE tenants SET amenity_balance = amenity_balance - $1 WHERE id=$2", [
          t.amount,
          t.tenant_id,
        ]);
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

export async function setAmenityPaymentStatus(
  db: Database,
  billTenantId: number,
  status: string,
): Promise<{ error: string | null }> {
  if (status !== "Paid" && status !== "Unpaid") return { error: "Invalid status." };
  try {
    await db.execute("UPDATE amenity_bill_tenants SET payment_status=$1 WHERE id=$2", [
      status,
      billTenantId,
    ]);
    return { error: null };
  } catch (e) {
    return { error: String(e) };
  }
}

export async function getAmenityBills(
  db: Database,
  filter: string | null,
): Promise<AmenityBillRow[]> {
  if (filter === "active" || filter === "cancelled") {
    return db.select<AmenityBillRow[]>("SELECT * FROM amenity_bills WHERE status=$1 ORDER BY billing_date DESC, id DESC", [
      filter,
    ]);
  }
  return db.select<AmenityBillRow[]>("SELECT * FROM amenity_bills ORDER BY billing_date DESC, id DESC");
}

export async function getBillWithDetails(db: Database, billId: number) {
  const bills = await db.select<AmenityBillRow[]>("SELECT * FROM amenity_bills WHERE id=$1", [billId]);
  if (bills.length === 0) return null;
  const tenants = await db.select<AmenityBillTenantRow[]>(
    "SELECT * FROM amenity_bill_tenants WHERE bill_id=$1 ORDER BY tenant_name_snapshot",
    [billId],
  );
  const rooms = await db.select<AmenityBillRoomRow[]>(
    "SELECT * FROM amenity_bill_rooms WHERE bill_id=$1 ORDER BY room_number_snapshot",
    [billId],
  );
  return { bill: bills[0], tenants, rooms };
}

export async function checkDuplicateAmenity(
  db: Database,
  amenity_name: string,
  billing_period: string | null,
  excludeId?: number,
): Promise<boolean> {
  if (!billing_period) return false;
  const rows = await db.select<{ id: number }[]>(
    "SELECT id FROM amenity_bills WHERE amenity_name=$1 AND billing_period=$2 AND status='active' AND id != COALESCE($3, -1) LIMIT 1",
    [amenity_name, billing_period, excludeId ?? -1],
  );
  return rows.length > 0;
}
