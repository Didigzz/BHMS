import type { RoomStatus } from "$lib/room-status";
import type { PaymentStatus } from "$lib/payment-status";

/** A compact payment-summary chip rendered inside a dashboard room card. */
export interface TenantChip {
  id: number;
  name: string;
  dueDate: string;
  lastPaidDate: string | null;
  status: PaymentStatus;
  daysUntil: number;
}

/** A room row as the dashboard loads it, enriched with chips and its active hold. */
export interface DashboardRoom {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  status: RoomStatus;
  tenant_count: number;
  reservation: { name: string; scope: string } | null;
  tenants: TenantChip[];
}
