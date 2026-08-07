export type Scope = "whole" | "slot";
export type ResStatus = "active" | "converted" | "cancelled";

export interface Reservation {
  id: number;
  room_id: number;
  room_number: string;
  name: string;
  contact: string;
  reservation_date: string;
  target_move_in_date: string;
  scope: Scope;
  deposit: number | null;
  status: ResStatus;
}

export interface RoomOption {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  tenant_count: number;
  has_active_reservation: number;
  maintenance: number;
}

/** Raw add-reservation form values (strings) before conversion at save time. */
export interface ReservationFormState {
  name: string;
  contact: string;
  room_id: string;
  reservation_date: string;
  target_move_in_date: string;
  scope: Scope;
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
}
