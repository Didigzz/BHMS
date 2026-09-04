export type HoldType = "whole" | "bed" | "custom";
export type ResStatus = "active" | "converted" | "cancelled";

export interface Reservation {
  id: number;
  room_id: number;
  room_number: string;
  name: string;
  contact: string;
  reservation_date: string;
  target_move_in_date: string;
  hold_type: HoldType;
  /** Beds held by a partial hold; null for a whole-room hold. */
  bed_count: number | null;
  deposit: number | null;
  status: ResStatus;
}

export interface RoomOption {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  /** Beds occupied by active tenants (SUM of tenants.beds_occupied). */
  occupied_beds: number;
  /** Beds already held by active partial ('bed'/'custom') reservations. */
  held_beds: number;
  /** 1 when an active whole-room hold exists, else 0. */
  has_whole_hold: number;
  maintenance: number;
}

/** Raw add-reservation form values (strings) before conversion at save time. */
export interface ReservationFormState {
  name: string;
  contact: string;
  room_id: string;
  reservation_date: string;
  target_move_in_date: string;
  hold_type: HoldType;
  /** Raw custom-bed input — only meaningful when hold_type is "custom". */
  bed_count: string | number | null | undefined;
  /** Raw holding-deposit input — string when untouched, number once typed
   * (Svelte 5 binds <input type="number"> as a number), undefined when empty. */
  deposit: string | number | null | undefined;
}

/** Tenant fields collected by the convert modal before the page persists. */
export interface ConvertPayload {
  name: string;
  contact: string;
  move_in_date: string;
  due_date: string;
  /** Beds the converted tenant occupies (prefilled from the hold, editable). */
  beds_occupied: number;
}
