/**
 * Amenity bill commands.
 *
 * In the app each write is one Rust transaction; the browser preview uses the
 * local BEGIN/COMMIT shim in preview-fallback.ts. Input validation lives in
 * validation.ts. Types are re-exported here so callers keep one import path.
 */
import type Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/db";
import {
  AMENITY_MESSAGES,
  manualMismatchMessage,
  round2,
  validateBill,
  validateExclusionReason,
  type BillingMethod,
  type DivisionMode,
} from "./amenity-billing";

import { cancelAmenityBillLocally, saveAmenityBillLocally } from "./preview-fallback";
import { toPayload, translateError, validateInput } from "./validation";
import type {
  AmenityBillRoomRow,
  AmenityBillRow,
  AmenityBillTenantRow,
  ConnectedRoomOverlap,
  CreateAmenityBillInput,
} from "./types";

export type {
  AmenityBillRoomRow,
  AmenityBillRow,
  AmenityBillTenantRow,
  ConnectedRoomOverlap,
  CreateAmenityBillInput,
} from "./types";

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
    `SELECT abt.*, p.id AS payment_id, p.paid_date
     FROM amenity_bill_tenants abt
     LEFT JOIN amenity_payments p
       ON p.bill_tenant_id = abt.id AND p.status = 'active'
     WHERE abt.bill_id = $1
     ORDER BY abt.tenant_name_snapshot`,
    [billId],
  );
  const rooms = await db.select<AmenityBillRoomRow[]>(
    "SELECT * FROM amenity_bill_rooms WHERE bill_id=$1 ORDER BY room_number_snapshot",
    [billId],
  );
  return { bill: bills[0], tenants, rooms };
}

/** Names of tenants with recorded money on a bill — the cancel warning (§11). */
export async function getPaidTenantNames(db: Database, billId: number): Promise<string[]> {
  const rows = await db.select<{ tenant_name_snapshot: string }[]>(
    `SELECT DISTINCT abt.tenant_name_snapshot
     FROM amenity_payments p
     JOIN amenity_bill_tenants abt ON abt.id = p.bill_tenant_id
     WHERE p.bill_id = $1 AND p.status = 'active'
     ORDER BY abt.tenant_name_snapshot`,
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
