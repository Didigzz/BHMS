/**
 * Data and shape helpers for the room detail sheet (room-bed-view-spec).
 *
 * The sheet used to own these inline; pulling them out keeps the component to
 * layout and wiring, and lets the receipt grouping be shared with the tenant
 * Payment History modal (see `payment-groups.ts`).
 */

import { getPaymentStatus, paymentLabel, type PaymentStatus } from "$lib/tenants/payment-status";
import { groupReceipts, type PaymentGroup } from "$lib/tenants/payment-groups";
import type { PaymentRecord, Room as TenantRoom, Tenant } from "$lib/tenants/types";
import type { BoarderSheetRoom } from "$lib/rooms/rooms";

export type { PaymentGroup };

/** An active boarder in the room (tenants row, moved_out_date IS NULL). */
export interface Boarder {
  id: number;
  name: string;
  contact: string;
  /** Beds this tenant occupies in this room (multi-bed, v050+). */
  beds_occupied: number;
  monthly_rate: number | null;
  move_in_date: string;
  due_date: string;
  last_paid_date: string | null;
  deposit_amount: number | null;
  deposit_refunded: number;
  advance_months: number;
  advance_held: number;
  deposit_held: number;
  /** Amenity Balance — sum of this tenant's active (non-cancelled) amenity shares. */
  amenity_balance: number;
}

/** An active reservation held on this room (a guest, not yet a tenant). */
export interface ReservedGuest {
  id: number;
  name: string;
  contact: string;
  reservation_date: string;
  target_move_in_date: string;
  hold_type: "whole" | "bed" | "custom";
  bed_count: number | null;
  deposit: number | null;
}

/** The slice of the tauri-plugin-sql handle these helpers need. */
export interface RoomDb {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

/** Load the room's active boarders and any active reservations on open. */
export async function loadRoomBoarders(
  db: RoomDb,
  roomId: number,
): Promise<{ boarders: Boarder[]; reservations: ReservedGuest[] }> {
  const [boarders, reservations] = await Promise.all([
    db.select<Boarder[]>(
      `SELECT id, name, contact, beds_occupied, monthly_rate, move_in_date, due_date, last_paid_date,
              deposit_amount, deposit_refunded, advance_months, advance_held, deposit_held, amenity_balance
       FROM tenants WHERE room_id=$1 AND moved_out_date IS NULL ORDER BY id`,
      [roomId],
    ),
    db.select<ReservedGuest[]>(
      `SELECT id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count, deposit
       FROM reservations WHERE room_id=$1 AND status='active' ORDER BY id`,
      [roomId],
    ),
  ]);
  return { boarders, reservations };
}

/** One boarder's payment-history groups, newest first. */
export async function loadHistoryGroups(db: RoomDb, tenantId: number): Promise<PaymentGroup[]> {
  return groupReceipts(db, tenantId);
}

export function boarderStatus(b: Boarder): PaymentStatus {
  return getPaymentStatus(b.due_date, new Date(), b.last_paid_date);
}

/** Payment status for a bed-grid box's tenant (missing boarder → green). */
export function boxStatus(boarders: Boarder[], box: { tenantId: number }): PaymentStatus {
  const b = boarders.find((x) => x.id === box.tenantId);
  return b ? boarderStatus(b) : "green";
}

/**
 * Payment label for a bed-grid box. The box is colored by status, so the same
 * words go on its aria-label — color alone must never be the only cue
 * (dashboard-mobile-polish-spec §6.4).
 */
export function boxStatusLabel(boarders: Boarder[], box: { tenantId: number }): string {
  const b = boarders.find((x) => x.id === box.tenantId);
  return b ? paymentLabel(boarderStatus(b), b.due_date, new Date(), b.last_paid_date) : "Current";
}

/** Lift a boarder into the full Tenant shape the action modals expect. */
export function toTenant(b: Boarder, room: BoarderSheetRoom): Tenant {
  return {
    id: b.id,
    name: b.name,
    contact: b.contact,
    room_id: room.id,
    room_number: room.room_number,
    beds_occupied: b.beds_occupied,
    monthly_rate: b.monthly_rate,
    move_in_date: b.move_in_date,
    due_date: b.due_date,
    last_paid_date: b.last_paid_date,
    deposit_amount: b.deposit_amount,
    deposit_refunded: b.deposit_refunded,
    advance_months: b.advance_months,
    advance_held: b.advance_held,
    deposit_held: b.deposit_held,
    moved_out_date: null,
    amenity_balance: b.amenity_balance,
  };
}

/** Room list the Pay modal uses for the per-tenant rate fallback. */
export function payRoomsFor(room: BoarderSheetRoom): TenantRoom[] {
  return [
    {
      id: room.id,
      room_number: room.room_number,
      capacity: room.capacity,
      monthly_rate: room.monthly_rate,
      occupied_beds: room.occupied_beds,
      maintenance: 0,
      // Only the rate fallback is read by Pay/EditPay — hold counts are
      // irrelevant to a payment modal, so this can stay 0.
      whole_reservations: 0,
      held_beds: room.held_beds,
    },
  ];
}

/** Receipt rows for one transaction (edit / receipt flows). */
export async function loadGroupRows(
  db: RoomDb,
  tenantId: number,
  receiptNo: string,
): Promise<PaymentRecord[]> {
  return db.select<PaymentRecord[]>(
    "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
    [tenantId, receiptNo],
  );
}
