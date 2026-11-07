import type Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./db";
import {
  AMENITY_MESSAGES,
  manualMismatchMessage,
  round2,
  validateBill,
  validateExclusionReason,
  type BillingMethod,
  type DivisionMode,
} from "./amenity-billing";

export interface CreateAmenityBillInput {
  amenity_name: string;
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

/** One room that already belongs to an active connected bill (spec §7.4). */
export interface ConnectedRoomOverlap {
  room_id: number;
  room_number: string;
  bill_id: number;
  amenity_name: string;
}

/** Payload of the Rust `save_amenity_bill` command (snake_case field names). */
interface AmenityBillPayload {
  bill_id: number | null;
  amenity_name: string;
  billing_method: string;
  total_amount: number;
  billing_date: string;
  billing_period: string | null;
  notes: string | null;
  division_mode: string;
  meter_start: number | null;
  meter_end: number | null;
  price_per_unit: number | null;
  tenants: { tenant_id: number; amount: number }[];
  excluded: { tenant_id: number; reason: string }[];
  room_ids: number[];
}

/**
 * Codes the Rust command returns. The user-facing text lives in
 * AMENITY_MESSAGES (spec §12) so no message is written twice (todo T10).
 */
const ERROR_MESSAGES: Record<string, string> = {
  "amenity:name": AMENITY_MESSAGES.name,
  "amenity:amount": AMENITY_MESSAGES.amount,
  "amenity:selection": AMENITY_MESSAGES.selection,
  "amenity:exclusion-reason": AMENITY_MESSAGES.exclusionReason,
  "amenity:connected-rooms": AMENITY_MESSAGES.connectedRooms,
  "amenity:negative-amount": AMENITY_MESSAGES.negativeAmount,
  "amenity:not-found": "Bill not found.",
  "amenity:cancelled": "Cancelled bills cannot be edited.",
  "amenity:already-cancelled": "Already cancelled.",
};

function translateError(error: unknown, input?: CreateAmenityBillInput): string {
  const text = error instanceof Error ? error.message : String(error);
  // The money message needs the offending numbers, so it is built here from
  // the same locked builder the validators use (spec §12, todo T10).
  if (text.includes("amenity:manual-sum") && input) {
    let sum = 0;
    for (const value of input.tenantShares.values()) sum = round2(sum + value);
    return manualMismatchMessage(sum, input.total_amount);
  }
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (text.includes(code)) return message;
  }
  return text;
}

/** The single validation gate both the Tauri and browser paths go through. */
function validateInput(input: CreateAmenityBillInput): string | null {
  for (const [, reason] of input.excluded) {
    const reasonError = validateExclusionReason(true, reason);
    if (reasonError) return reasonError;
  }
  return validateBill({
    amenityName: input.amenity_name,
    amount: input.total_amount,
    tenantIds: [...input.tenantShares.keys()],
    roomIds: input.roomIds,
    method: input.billing_method as BillingMethod,
    divisionMode: input.division_mode as DivisionMode,
    shares: input.tenantShares,
    billingPeriod: input.billing_period ?? null,
  });
}

function toPayload(input: CreateAmenityBillInput, billId: number | null): AmenityBillPayload {
  return {
    bill_id: billId,
    amenity_name: input.amenity_name.trim(),
    billing_method: input.billing_method,
    total_amount: input.total_amount,
    billing_date: input.billing_date,
    billing_period: input.billing_period ?? null,
    notes: input.notes ?? null,
    division_mode: input.division_mode,
    meter_start: input.meter_start ?? null,
    meter_end: input.meter_end ?? null,
    price_per_unit: input.price_per_unit ?? null,
    tenants: [...input.tenantShares.entries()].map(([tenant_id, amount]) => ({
      tenant_id,
      amount,
    })),
    excluded: [...input.excluded.entries()].map(([tenant_id, reason]) => ({
      tenant_id,
      reason,
    })),
    room_ids: input.roomIds,
  };
}

/**
 * Create a bill. In the app the whole write happens inside one Rust
 * transaction (spec §10); in the browser preview the shim owns a single
 * connection, so a plain BEGIN/COMMIT is genuinely atomic there.
 */
export async function createAmenityBill(
  db: Database,
  input: CreateAmenityBillInput,
): Promise<{ error: string | null; billId: number | null }> {
  const invalid = validateInput(input);
  if (invalid) return { error: invalid, billId: null };

  if (isTauri()) {
    try {
      const billId = await invoke<number>("save_amenity_bill", { input: toPayload(input, null) });
      return { error: null, billId };
    } catch (error) {
      return { error: translateError(error, input), billId: null };
    }
  }
  return saveAmenityBillLocally(db, input, null);
}

export async function updateAmenityBill(
  db: Database,
  billId: number,
  input: CreateAmenityBillInput,
): Promise<{ error: string | null }> {
  const invalid = validateInput(input);
  if (invalid) return { error: invalid };

  if (isTauri()) {
    try {
      await invoke<number>("save_amenity_bill", { input: toPayload(input, billId) });
      return { error: null };
    } catch (error) {
      return { error: translateError(error, input) };
    }
  }
  const result = await saveAmenityBillLocally(db, input, billId);
  return { error: result.error };
}

/** Soft cancel + balance reversal, atomically (spec §11). */
export async function cancelAmenityBill(
  db: Database,
  billId: number,
): Promise<{ error: string | null }> {
  if (isTauri()) {
    try {
      await invoke("cancel_amenity_bill", { billId });
      return { error: null };
    } catch (error) {
      return { error: translateError(error) };
    }
  }
  return cancelAmenityBillLocally(db, billId);
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
    return db.select<AmenityBillRow[]>(
      "SELECT * FROM amenity_bills WHERE status=$1 ORDER BY billing_date DESC, id DESC",
      [filter],
    );
  }
  return db.select<AmenityBillRow[]>(
    "SELECT * FROM amenity_bills ORDER BY billing_date DESC, id DESC",
  );
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

/** Names of tenants already marked Paid on a bill — the cancel warning (§11). */
export async function getPaidTenantNames(db: Database, billId: number): Promise<string[]> {
  const rows = await db.select<{ tenant_name_snapshot: string }[]>(
    "SELECT tenant_name_snapshot FROM amenity_bill_tenants WHERE bill_id=$1 AND payment_status='Paid' ORDER BY tenant_name_snapshot",
    [billId],
  );
  return rows.map((row) => row.tenant_name_snapshot);
}

/**
 * How many amenity bills this tenant appears on. Permanent tenant deletion is
 * blocked when this is > 0 (spec §9.4) so billing history keeps its subject.
 */
export async function countAmenityBillsForTenant(db: Database, tenantId: number): Promise<number> {
  const rows = await db.select<{ total: number }[]>(
    "SELECT COUNT(DISTINCT bill_id) AS total FROM amenity_bill_tenants WHERE tenant_id=$1",
    [tenantId],
  );
  return rows[0]?.total ?? 0;
}

/** Rooms already on another active connected bill for this amenity + period. */
export async function findConnectedRoomOverlap(
  db: Database,
  amenityName: string,
  billingPeriod: string | null,
  roomIds: number[],
  excludeBillId?: number,
): Promise<ConnectedRoomOverlap[]> {
  if (roomIds.length === 0) return [];
  const placeholders = roomIds.map((_, index) => `$${index + 4}`).join(", ");
  return db.select<ConnectedRoomOverlap[]>(
    `SELECT abr.room_id, abr.room_number_snapshot AS room_number, ab.id AS bill_id, ab.amenity_name
     FROM amenity_bill_rooms abr
     JOIN amenity_bills ab ON ab.id = abr.bill_id
     WHERE ab.status = 'active'
       AND ab.billing_method = 'connected'
       AND lower(ab.amenity_name) = lower($1)
       AND ab.billing_period IS $2
       AND ($3 IS NULL OR ab.id != $3)
       AND abr.room_id IN (${placeholders})
     ORDER BY abr.room_id`,
    [amenityName.trim(), billingPeriod, excludeBillId ?? null, ...roomIds],
  );
}

/** One active bill per amenity name + period (spec §12), with an override. */
export async function checkDuplicateAmenity(
  db: Database,
  amenity_name: string,
  billing_period: string | null,
  excludeId?: number,
): Promise<boolean> {
  if (!billing_period) return false;
  const rows = await db.select<{ id: number }[]>(
    "SELECT id FROM amenity_bills WHERE lower(amenity_name)=lower($1) AND billing_period=$2 AND status='active' AND id != COALESCE($3, -1) LIMIT 1",
    [amenity_name.trim(), billing_period, excludeId ?? -1],
  );
  return rows.length > 0;
}

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

async function saveAmenityBillLocally(
  db: Database,
  input: CreateAmenityBillInput,
  billId: number | null,
): Promise<{ error: string | null; billId: number | null }> {
  const now = nowIso();
  const previous = billId != null ? await previousShares(db, billId) : new Map<number, number>();
  const excludedIds = new Set(input.excluded.keys());

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
        "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [actualId, tenantId, amount, 0, null, "Unpaid", snapshot.name, snapshot.room],
      );
    }
    for (const [tenantId, reason] of input.excluded) {
      const snapshot = await snapshotOf(db, tenantId);
      await db.execute(
        "INSERT INTO amenity_bill_tenants (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status, tenant_name_snapshot, room_number_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [actualId, tenantId, 0, 1, reason.trim(), "Unpaid", snapshot.name, snapshot.room],
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

async function cancelAmenityBillLocally(
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

  try {
    await db.execute("BEGIN");
    await db.execute("UPDATE amenity_bills SET status='cancelled', updated_at=$1 WHERE id=$2", [
      nowIso(),
      billId,
    ]);
    for (const tenant of tenants) {
      if (tenant.amount > 0) {
        await db.execute("UPDATE tenants SET amenity_balance = amenity_balance - $1 WHERE id=$2", [
          tenant.amount,
          tenant.tenant_id,
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
