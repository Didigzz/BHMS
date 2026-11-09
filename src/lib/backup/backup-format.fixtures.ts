import { expect } from "vitest";
import {
  buildBackupEnvelope,
  parseBackupFile,
  sealBackupEnvelope,
  serializeBackup,
  toBackupTable,
  type BackupEnvelope,
  type BackupTablePayload,
} from "./backup-format.ts";

export const FILE_NAME = "BHMS-Backup-2026-09-14.digal";

export function payload(columns: string[], rows: Record<string, unknown>[]): BackupTablePayload {
  return toBackupTable(columns, rows);
}

/** A realistic populated backup with unicode, NULL, empty string, REAL, and dates. */
export function populatedTables(): Record<string, BackupTablePayload> {
  return {
    rooms: payload(["id", "room_number", "capacity", "monthly_rate", "status", "maintenance"], [
      { id: 1, room_number: "Room A", capacity: 2, monthly_rate: 2500, status: "Occupied", maintenance: 0 },
      { id: 2, room_number: "Kuwarto ñ—2", capacity: 1, monthly_rate: 1500.5, status: "Vacant", maintenance: 1 },
    ]),
    tenants: payload(
      ["id", "name", "contact", "room_id", "due_date", "deposit_amount", "beds_occupied", "backfilled"],
      [
        { id: 7, name: "Maria Peña ₱", contact: "0917-000-0000", room_id: 1, due_date: "2026-09-14", deposit_amount: null, beds_occupied: 1, backfilled: 0 },
        { id: 9, name: "🧑‍🌾 Boarder “Anon”", contact: "", room_id: 1, due_date: "2026-10-01", deposit_amount: 2500.5, beds_occupied: 2, backfilled: 1 },
      ]
    ),
    payments: payload(["id", "tenant_id", "amount", "paid_date", "due_date", "covers_month", "method", "receipt_no"], [
      { id: 3, tenant_id: 7, amount: 2500, paid_date: "2026-08-05", due_date: "2026-09-05", covers_month: "2026-08", method: "GCash", receipt_no: "RCPT-000003" },
    ]),
    reservations: payload(["id", "room_id", "name", "hold_type", "bed_count", "status"], [
      { id: 1, room_id: 2, name: "Walk-in", hold_type: "whole", bed_count: null, status: "active" },
    ]),
    settings: payload(["key", "value"], [
      { key: "house_name", value: "DIGAL Boarding House" },
      { key: "reminder_days", value: "3" },
    ]),
    notifications_log: payload(["id", "tenant_id", "kind", "due_date", "notified_at"], [
      { id: 1, tenant_id: 7, kind: "reminder", due_date: "2026-09-14", notified_at: "2026-09-11T08:00:00.000Z" },
    ]),
    amenity_bills: payload(
      ["id", "amenity_name", "billing_method", "total_amount", "billing_date", "billing_period", "notes", "division_mode", "status", "meter_start", "meter_end", "price_per_unit", "created_at", "updated_at"],
      [
        { id: 1, amenity_name: "Kuryente — Main Meter", billing_method: "shared", total_amount: 1000, billing_date: "2026-09-01", billing_period: "2026-09", notes: null, division_mode: "auto", status: "active", meter_start: null, meter_end: null, price_per_unit: null, created_at: "2026-09-01T08:00:00.000Z", updated_at: "2026-09-01T08:00:00.000Z" },
        { id: 2, amenity_name: "Tubig — Rooms 1+2", billing_method: "connected", total_amount: 8000, billing_date: "2026-09-02", billing_period: "2026-09", notes: "Joint submeter", division_mode: "manual", status: "cancelled", meter_start: 100, meter_end: 150, price_per_unit: 5, created_at: "2026-09-02T08:00:00.000Z", updated_at: "2026-09-03T08:00:00.000Z" },
      ]
    ),
    amenity_bill_tenants: payload(
      ["id", "bill_id", "tenant_id", "amount", "is_excluded", "exclusion_reason", "payment_status", "tenant_name_snapshot", "room_number_snapshot"],
      [
        { id: 1, bill_id: 1, tenant_id: 7, amount: 500, is_excluded: 0, exclusion_reason: null, payment_status: "Paid", tenant_name_snapshot: "Maria Peña ₱", room_number_snapshot: "Room A" },
        { id: 2, bill_id: 1, tenant_id: 9, amount: 0, is_excluded: 1, exclusion_reason: "Moved out mid-cycle", payment_status: "Unpaid", tenant_name_snapshot: "🧑‍🌾 Boarder “Anon”", room_number_snapshot: "Room A" },
      ]
    ),
    amenity_bill_rooms: payload(["id", "bill_id", "room_id", "room_number_snapshot"], [
      { id: 1, bill_id: 2, room_id: 2, room_number_snapshot: "Kuwarto ñ—2" },
    ]),
    amenity_payments: payload(
      ["id", "bill_tenant_id", "bill_id", "tenant_id", "amount", "paid_date", "status", "reversal_reason", "reversed_at", "created_at", "updated_at"],
      [
        { id: 1, bill_tenant_id: 1, bill_id: 1, tenant_id: 7, amount: 500, paid_date: "2026-09-05", status: "active", reversal_reason: null, reversed_at: null, created_at: "2026-09-05T00:00:00.000Z", updated_at: "2026-09-05T00:00:00.000Z" },
        { id: 2, bill_tenant_id: 1, bill_id: 1, tenant_id: 9, amount: 250, paid_date: "2026-09-04", status: "reversed", reversal_reason: "Wrong tenant", reversed_at: "2026-09-06T00:00:00.000Z", created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-06T00:00:00.000Z" },
      ]
    ),
  };
}

export function emptyTables(): Record<string, BackupTablePayload> {
  return {
    rooms: payload(["id", "room_number"], []),
    tenants: payload(["id", "name"], []),
    payments: payload(["id"], []),
    reservations: payload(["id"], []),
    // A fresh install still has seeded settings — an "empty" backup is never 0 rows total.
    settings: payload(["key", "value"], [{ key: "house_name", value: "DIGAL" }]),
    notifications_log: payload(["id"], []),
    amenity_bills: payload(["id", "amenity_name"], []),
    amenity_bill_tenants: payload(["id"], []),
    amenity_bill_rooms: payload(["id"], []),
    amenity_payments: payload(["id"], []),
  };
}

export function makeFile(tables = populatedTables()): { envelope: BackupEnvelope; text: string } {
  const envelope = sealBackupEnvelope(
    buildBackupEnvelope(tables, { houseName: "DIGAL Boarding House", exportedAt: "2026-09-14T06:00:00.000Z" })
  );
  return { envelope, text: serializeBackup(envelope) };
}

/** Parse → mutate the JSON → re-stringify (for negative cases). */
export function mutate(text: string, fn: (parsed: Record<string, unknown>) => void): string {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  fn(parsed);
  return JSON.stringify(parsed, null, 2);
}

export function expectFailure(result: ReturnType<typeof parseBackupFile>, reason: string, message?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe(reason);
  if (message) expect(result.message).toBe(message);
}

/** A file written before the amenity tables existed — re-sealed so only the absent payload is under test. */
export function agedFile(): string {
  const { text } = makeFile();
  const parsed = JSON.parse(text) as Record<string, any>;
  delete parsed.tables.amenity_bills;
  delete parsed.tables.amenity_bill_tenants;
  delete parsed.tables.amenity_bill_rooms;
  delete parsed.tables.amenity_payments;
  return serializeBackup(sealBackupEnvelope(parsed as unknown as BackupEnvelope));
}

/** Repack a mutated file with a fresh checksum, so only the edit under test matters. */
export function resealed(fn: (parsed: Record<string, any>) => void): string {
  const { text } = makeFile();
  const parsed = JSON.parse(text) as Record<string, any>;
  fn(parsed);
  return serializeBackup(sealBackupEnvelope(parsed as unknown as BackupEnvelope));
}
