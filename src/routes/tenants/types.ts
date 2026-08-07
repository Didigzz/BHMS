/** Room shape as queried by the tenants page (rooms + occupancy aggregates). */
export interface Room {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  tenant_count: number;
  maintenance: number;
  whole_reservations: number;
  slot_reservations: number;
}

export interface Tenant {
  id: number;
  name: string;
  contact: string;
  room_id: number;
  room_number: string;
  /** Per-tenant monthly rate (snapshot at move-in); null on legacy rows. */
  monthly_rate: number | null;
  move_in_date: string;
  due_date: string;
  last_paid_date: string | null;
  deposit_amount: number | null;
  deposit_refunded: number;
  advance_months: number;
  moved_out_date: string | null;
}

export interface PaymentRecord {
  id: number;
  amount: number;
  paid_date: string;
  due_date: string;
  /** "YYYY-MM" — the month this payment covers (advance payments span several rows). */
  covers_month: string | null;
  method: string;
  /** "RCPT-######" — shared by all rows of one payment transaction. */
  receipt_no: string | null;
}

/** Raw tenant form values (strings) before conversion to numbers at save time. */
export interface TenantFormState {
  id: number | null;
  name: string;
  contact: string;
  room_id: string;
  monthly_rate: string;
  move_in_date: string;
  due_date: string;
  deposit_amount: string;
  advance_months: string;
  dueAuto: boolean;
}
