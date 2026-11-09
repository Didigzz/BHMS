import type { RoomStatus } from "$lib/rooms/room-status";
import type { PaymentStatus } from "$lib/tenants/payment-status";

/** A compact payment-summary chip rendered inside a dashboard room card. */
export interface TenantChip {
  id: number;
  name: string;
  dueDate: string;
  lastPaidDate: string | null;
  status: PaymentStatus;
  daysUntil: number;
}

/** A room row as the dashboard loads it, enriched with chips and its active holds. */
export interface DashboardRoom {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  status: RoomStatus;
  /** Beds occupied by active tenants (SUM of tenants.beds_occupied). */
  occupied_beds: number;
  /** Name on the active whole-room hold, if any. */
  whole_hold_name: string | null;
  /** Beds held by active partial ('bed'/'custom') reservations. */
  held_beds: number;
  tenants: TenantChip[];
}
