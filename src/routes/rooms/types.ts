import type { RoomStatus } from "$lib/room-status";
import type { PaymentStatus } from "$lib/payment-status";

/** A room row as the rooms page loads it, with aggregated tenant/hold counts. */
export interface Room {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  status: RoomStatus;
  /** Beds occupied by active tenants (SUM of tenants.beds_occupied). */
  occupied_beds: number;
  /** Any active reservation (whole or partial) — used for the delete guard. */
  reservation_count: number;
  /** Beds held by active partial ('bed'/'custom') reservations. */
  held_beds: number;
  /** 1 when an active whole-room hold exists, else 0. */
  has_whole_hold: number;
  /** Name on the active whole-room hold, if any. */
  whole_hold_name: string | null;
  maintenance: number;
}

/** Active tenants per room, used for the Overdue filter and the boarder chips. */
export interface RoomTenant {
  id: number;
  name: string;
  room_id: number;
  due_date: string;
  last_paid_date: string | null;
}

/** A boarder chip shown on a room card (name + payment status), like the dashboard. */
export interface RoomTenantChip {
  id: number;
  name: string;
  dueDate: string;
  lastPaidDate: string | null;
  status: PaymentStatus;
}

export type RoomFilter = "all" | "Vacant" | "Reserved" | "Occupied" | "Overdue";

/** Add/Edit room form state (capacity/rate kept as strings for input binding). */
export interface RoomFormState {
  id: number | null;
  room_number: string;
  capacity: string;
  monthly_rate: string;
  maintenance: boolean;
}
