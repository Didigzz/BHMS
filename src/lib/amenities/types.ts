/** Amenity bill row/input shapes shared by the commands, validation and preview paths. */

export interface CreateAmenityBillInput {
  amenity_name: string;
  billing_method: string;
  total_amount: number;
  billing_date: string;
  billing_period?: string | null;
  notes?: string | null;
  division_mode: string;
  tenantShares: Map<number, number>;
  /** Tenant ids the landlord pinned to a manual amount (blank fields excluded). */
  manualIds?: number[];
  excluded: Map<number, string>;
  roomIds: number[];
  meter_start?: number | null;
  meter_end?: number | null;
  price_per_unit?: number | null;
}

export interface AmenityBillRow {
  id: number;
  amenity_name: string;
  billing_method: string;
  total_amount: number;
  billing_date: string;
  billing_period: string | null;
  notes: string | null;
  division_mode: string;
  status: string;
  meter_start: number | null;
  meter_end: number | null;
  price_per_unit: number | null;
  created_at: string;
  updated_at: string;
}

export interface AmenityBillTenantRow {
  id: number;
  bill_id: number;
  tenant_id: number;
  amount: number;
  is_excluded: number;
  exclusion_reason: string | null;
  /** 1 when the landlord pinned this share to a manual amount. */
  is_manual: number;
  payment_status: string;
  tenant_name_snapshot: string;
  room_number_snapshot: string;
  /** The active payment settling this share, via getBillWithDetails' LEFT JOIN. */
  payment_id: number | null;
  paid_date: string | null;
}

export interface AmenityBillRoomRow {
  id: number;
  bill_id: number;
  room_id: number;
  room_number_snapshot: string;
}

/** One room that already belongs to an active connected bill (spec §7.4). */
export interface ConnectedRoomOverlap {
  room_id: number;
  room_number: string;
  bill_id: number;
  amenity_name: string;
}

/** Payload of the Rust `save_amenity_bill` command (snake_case field names). */
export interface AmenityBillPayload {
  bill_id: number | null;
  amenity_name: string;
  billing_method: string;
  total_amount: number;
  billing_date: string;
  billing_period: string | null;
  notes: string | null;
  division_mode: string;
  meter_start: number | null;
  meter_end: number | null;
  price_per_unit: number | null;
  tenants: { tenant_id: number; amount: number; is_manual: boolean }[];
  excluded: { tenant_id: number; reason: string }[];
  room_ids: number[];
}

/**
 * Codes the Rust command returns. The user-facing text lives in
 * AMENITY_MESSAGES (spec §12) so no message is written twice (todo T10).
 */
