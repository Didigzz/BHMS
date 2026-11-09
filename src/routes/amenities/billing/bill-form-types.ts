/** A tenant the landlord can put on a bill, moved out or not. */
export interface PickTenant {
  id: number;
  name: string;
  room_number: string;
  room_id: number;
  moved_out_date: string | null;
}

/** How a bill's total is divided (spec §7). */
export type BillingMethod = "shared" | "per_room" | "connected";
export type DivisionMode = "auto" | "manual";
