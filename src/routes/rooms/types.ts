import type { RoomStatus } from "$lib/room-status";

/** A room row as the rooms page loads it, with aggregated tenant/hold counts. */
export interface Room {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  status: RoomStatus;
  tenant_count: number;
  reservation_count: number;
  slot_holds: number;
  reservation_name: string | null;
  reservation_scope: "whole" | "slot" | null;
  maintenance: number;
}

/** Payment-relevant columns for active tenants, used for the Overdue filter. */
export interface RoomTenant {
  room_id: number;
  due_date: string;
  last_paid_date: string | null;
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
