/**
 * Add/Edit Tenant form validation (already-boarding-spec.md §3.2).
 *
 * Pure function over plain data — no DOM, no store — so the branching between
 * the normal Add-Tenant flow and the "Already boarding?" backfill flow is
 * unit-testable in isolation. `TenantFormModal.svelte` calls this with its raw
 * form values + the resolved room, keeping the component's `validate()` thin.
 *
 * Two modes:
 * - `boarding: false` — today's exact rules (room maintenance/whole-hold/full
 *   checks, due date must be ≥ move-in, no beds field).
 * - `boarding: true`  — "already boarding" backfill: the tenant is physically
 *   in the room before the system existed, so ALL room checks are skipped
 *   (mirrors the DB trigger bypass, migration v067), the move-in date cannot
 *   be in the future, the beds field must be a whole number ≥ 1, and the due
 *   date may be past or future (the landlord may deliberately record arrears).
 *
 * Error messages match the component's historical strings byte-for-byte for
 * the non-boarding path, so the normal flow's UX is unchanged.
 */

/** The room fields the validation reads (satisfied by the tenants page's Room). */
export interface TenantFormRoom {
  room_number: string;
  capacity: number;
  /** Beds occupied by active tenants. */
  occupied_beds: number;
  /** Beds held by active partial reservations. */
  held_beds: number;
  maintenance: number;
  whole_reservations: number;
}

/** Raw form values (strings) the validation reads. */
export interface TenantFormValues {
  name: string;
  contact: string;
  room_id: string;
  monthly_rate: string;
  move_in_date: string;
  due_date: string;
  deposit_amount: string;
  advance_amount: string;
  beds_occupied: string;
}

/** Edit-context + mode inputs the modal already computes. */
export interface TenantFormValidationContext {
  /** "Already boarding?" toggle state. */
  boarding: boolean;
  /** Local ISO "YYYY-MM-DD" for today (used for the future-move-in check). */
  today: string;
  /** The selected room; null when room_id doesn't resolve to a real room. */
  room: TenantFormRoom | null;
  /** Adding (form.id === null) vs editing. */
  isAdding: boolean;
  /** Editing and keeping the tenant in their current room — always allowed. */
  currentRoomIsSame: boolean;
  /** Beds the saved tenant occupies (1 when adding, their beds when editing). */
  moverBeds: number;
}

/** Error message or null when the form is valid. */
export function validateTenantForm(
  form: TenantFormValues,
  ctx: TenantFormValidationContext
): string | null {
  if (!form.name.trim()) return "Tenant name is required.";
  if (!form.contact.trim()) return "Contact number is required.";
  if (!form.room_id) return "Please select an assigned room.";
  const room = ctx.room;
  if (!room) return "Selected room no longer exists.";

  if (ctx.boarding) {
    // Already-boarding backfill: the tenant is physically in the room today,
    // so the maintenance / whole-hold / capacity checks are all skipped —
    // mirrors the v067 trigger bypass for backfilled=1 inserts.
  } else {
    // When adding, the room must fit the new tenant (1 bed). When editing and
    // moving to a different room, the mover's OWN beds also count against the
    // destination's free space (mirrors the DB trigger v056). Keeping them in
    // their current room is always allowed.
    const occupied = room.occupied_beds + room.held_beds;
    if (!ctx.isAdding && ctx.currentRoomIsSame) {
      // keeping them in their current room — always allowed (matches the DB
      // trigger, which skips maintenance/hold checks for same-room saves)
    } else if (room.maintenance === 1) {
      return `${room.room_number} is under maintenance. Choose another room.`;
    } else if (room.whole_reservations > 0) {
      return `${room.room_number} is held — cancel or convert the reservation first.`;
    } else if (occupied + ctx.moverBeds > room.capacity) {
      return `${room.room_number} is full (${occupied}/${room.capacity}). Choose another room.`;
    }
  }

  const rate = Number(form.monthly_rate);
  if (String(form.monthly_rate ?? "").trim() === "" || Number.isNaN(rate) || rate < 0) {
    return "Monthly rate must be 0 or more.";
  }
  if (!form.move_in_date) return "Move-in date is required.";
  if (ctx.boarding && form.move_in_date > ctx.today) {
    return "Move-in date cannot be in the future for an already-boarding tenant.";
  }
  if (!form.due_date) return "Due date is required.";
  if (form.due_date < form.move_in_date) return "Due date should not be before the move-in date.";
  // Beds: only validated when boarding (the field is hidden in the normal
  // flow, where the save path always writes 1). Must be a whole number ≥ 1.
  if (ctx.boarding) {
    const beds = Number(form.beds_occupied);
    if (String(form.beds_occupied ?? "").trim() === "" || !Number.isInteger(beds) || beds < 1) {
      return "Beds occupied must be a whole number of at least 1.";
    }
  }
  const deposit = Number(form.deposit_amount);
  if (String(form.deposit_amount ?? "").trim() !== "" && (Number.isNaN(deposit) || deposit < 0)) {
    return "Deposit must be 0 or more.";
  }
  const advance = Number(form.advance_amount);
  if (String(form.advance_amount ?? "").trim() !== "" && (Number.isNaN(advance) || advance < 0)) {
    return "Advance payment must be 0 or more.";
  }
  return null;
}