/** Room shape as queried by the tenants page (rooms + occupancy aggregates). */
export interface Room {
  id: number;
  room_number: string;
  capacity: number;
  monthly_rate: number;
  /** Beds occupied by active tenants (SUM of tenants.beds_occupied). */
  occupied_beds: number;
  maintenance: number;
  /** Active whole-room holds (0 or 1). */
  whole_reservations: number;
  /** Beds held by active partial ('bed'/'custom') reservations. */
  held_beds: number;
}

export interface Tenant {
  id: number;
  name: string;
  contact: string;
  room_id: number;
  room_number: string;
  /** Beds this tenant occupies in their room (multi-bed, v050+). */
  beds_occupied: number;
  /** Per-tenant monthly rate (snapshot at move-in); null on legacy rows. */
  monthly_rate: number | null;
  move_in_date: string;
  /** Next upcoming due date — landlord-managed (set at creation, updated from the pay modal, editable). */
  due_date: string;
  last_paid_date: string | null;
  deposit_amount: number | null;
  deposit_refunded: number;
  advance_months: number;
  /** Remaining advance money (consumed first when the held balance is applied). */
  advance_held: number;
  /** Remaining deposit money (consumed last; refundable per settings). */
  deposit_held: number;
  moved_out_date: string | null;
}

export interface PaymentRecord {
  id: number;
  amount: number;
  /** Actual date money was received (landlord-entered at record time). */
  paid_date: string;
  /** The specific due date this payment covers (new model); legacy rows store the running "new due". */
  due_date: string;
  /** "YYYY-MM" — the month this payment covers (derived from the covered due date; legacy advance payments span several rows). */
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
  /** Advance payment in ₱ (money, not a month count). */
  advance_amount: string;
  dueAuto: boolean;
}
