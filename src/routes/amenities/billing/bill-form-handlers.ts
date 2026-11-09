import { round2 } from "$lib/amenities/amenity-billing";
import type { BillFields } from "./bill-form.svelte";

/**
 * Selection and method handlers for the amenity-bill form. They take the
 * reactive field object in and mutate it, so the factory in `bill-form.svelte.ts`
 * stays state + derivation + save inputs, and these stay readable on their own.
 */

export function methodLabel(method: string): string {
  if (method === "shared") return "Shared Billing";
  if (method === "per_room") return "Per-Room Billing — Room-Specific Amenity";
  return "Connected Rooms — Joint Room Billing";
}

export function requestMethodChange(fields: BillFields, next: string) {
  if (next === fields.billing_method) return;
  fields.pendingMethod = next;
}

/** Switching method recomputes from scratch — old entries belong to the old shape (spec §7). */
export function applyMethodChange(fields: BillFields) {
  if (!fields.pendingMethod) return;
  fields.billing_method = fields.pendingMethod;
  fields.pendingMethod = null;
  fields.manualIds = new Set();
  fields.manualAmounts = new Map();
  fields.lastManualAmounts = new Map();
  fields.selectedTenantIds = [];
  fields.selectedConnectedRoomIds = [];
  fields.excludedMap = new Map();
  fields.error = null;
}

export function toggleConnectedRoom(fields: BillFields, id: number) {
  if (fields.selectedConnectedRoomIds.includes(id)) {
    fields.selectedConnectedRoomIds = fields.selectedConnectedRoomIds.filter((x) => x !== id);
  } else {
    fields.selectedConnectedRoomIds = [...fields.selectedConnectedRoomIds, id];
  }
}

export function toggleTenant(fields: BillFields, id: number) {
  if (fields.selectedTenantIds.includes(id)) {
    fields.selectedTenantIds = fields.selectedTenantIds.filter((x) => x !== id);
    const amounts = new Map(fields.manualAmounts);
    amounts.delete(id);
    fields.manualAmounts = amounts;
    const ids = new Set(fields.manualIds);
    ids.delete(id);
    fields.manualIds = ids;
    const excluded = new Map(fields.excludedMap);
    excluded.delete(id);
    fields.excludedMap = excluded;
  } else {
    fields.selectedTenantIds = [...fields.selectedTenantIds, id];
  }
}

export function toggleExclude(fields: BillFields, id: number) {
  const excluded = new Map(fields.excludedMap);
  if (excluded.has(id)) {
    excluded.delete(id);
  } else {
    excluded.set(id, "");
    // Excluded tenants have no share: hide the Manual box, remember the typed
    // amount so a re-tick in this session can restore it (spec §3.4).
    const ids = new Set(fields.manualIds);
    ids.delete(id);
    fields.manualIds = ids;
    const amounts = new Map(fields.manualAmounts);
    const remembered = amounts.get(id);
    if (remembered != null) {
      const last = new Map(fields.lastManualAmounts);
      last.set(id, remembered);
      fields.lastManualAmounts = last;
      amounts.delete(id);
      fields.manualAmounts = amounts;
    }
  }
  fields.excludedMap = excluded;
}

/** Tick a tenant manual and start from its current automatic share. */
export function toggleManual(
  fields: BillFields,
  id: number,
  prefillOf: (id: number) => number,
) {
  const ids = new Set(fields.manualIds);
  const amounts = new Map(fields.manualAmounts);
  if (ids.has(id)) {
    ids.delete(id);
    amounts.delete(id);
  } else {
    ids.add(id);
    amounts.set(id, round2(prefillOf(id)));
  }
  fields.manualIds = ids;
  fields.manualAmounts = amounts;
}

/** The dropdown stays as a bulk shortcut: Manual ticks everyone (spec §3.5). */
export function onDivisionModeChange(
  fields: BillFields,
  event: Event,
  includedIds: number[],
  shares: Map<number, number>,
) {
  const next = (event.target as HTMLSelectElement).value;
  fields.division_mode = next;
  if (next === "manual") {
    const ids = new Set<number>();
    const amounts = new Map<number, number>();
    for (const id of includedIds) {
      ids.add(id);
      amounts.set(id, round2(shares.get(id) ?? fields.manualAmounts.get(id) ?? 0));
    }
    fields.manualIds = ids;
    fields.manualAmounts = amounts;
    fields.lastManualAmounts = new Map(amounts);
  } else {
    const last = new Map(fields.lastManualAmounts);
    for (const [id, value] of fields.manualAmounts) last.set(id, value);
    fields.lastManualAmounts = last;
    fields.manualIds = new Set();
    fields.manualAmounts = new Map();
  }
}

export function setManualAmount(fields: BillFields, id: number, raw: string) {
  const amounts = new Map(fields.manualAmounts);
  const last = new Map(fields.lastManualAmounts);
  const value = Number(raw);
  // Blank means "just use the automatic share" — the tick stays, the override
  // does not (spec §3.3).
  if (raw.trim() === "" || isNaN(value)) {
    amounts.delete(id);
    last.delete(id);
  } else {
    const rounded = round2(value);
    amounts.set(id, rounded);
    last.set(id, rounded);
  }
  fields.manualAmounts = amounts;
  fields.lastManualAmounts = last;
}

export function setExclusionReason(fields: BillFields, id: number, raw: string) {
  const next = new Map(fields.excludedMap);
  next.set(id, raw);
  fields.excludedMap = next;
}
