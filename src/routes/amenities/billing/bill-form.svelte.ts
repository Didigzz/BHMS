import {
  AMENITY_MESSAGES,
  calcSharedSplit,
  calcPerRoomSplit,
  calcConnectedSplit,
  calculateMeterTotal,
  hasZeroAutoShare,
  parseOptionalNumber,
  round2,
  validateManualAmounts,
  type SplitResult,
} from "$lib/amenities/amenity-billing";
import type { AmenityBillRow } from "$lib/amenities/amenity-actions";
import type { PickTenant } from "./bill-form-types";
import {
  loadBillRows,
  loadRoomTenants as readRoomTenants,
  loadRoomsAndTenants,
  type RoomOption,
} from "./bill-form-load";
import {
  applyMethodChange,
  methodLabel,
  onDivisionModeChange as applyDivisionMode,
  requestMethodChange,
  setExclusionReason as writeExclusionReason,
  setManualAmount as writeManualAmount,
  toggleConnectedRoom as toggleConnected,
  toggleExclude as excludeTenant,
  toggleManual as toggleManualTenant,
  toggleTenant as toggleSelectedTenant,
} from "./bill-form-handlers";

/**
 * All state and derivation for the amenity-bill form, pulled out of the sheet so
 * the component is markup and save orchestration. Runes require a `.svelte.ts`
 * module; the sheet creates one instance per open.
 */

/** Everything the form edits. A `$state` object so fields can be bound deeply. */
export interface BillFields {
  amenity_name: string;
  billing_method: string;
  total_amount: string;
  billing_date: string;
  billing_period: string;
  notes: string;
  division_mode: string;
  /** `bind:value` on a number input writes null when emptied and a number on every keystroke. */
  meter_start: string | number | null;
  meter_end: string | number | null;
  price_per_unit: string | number | null;
  selectedRoomId: string;
  selectedConnectedRoomIds: number[];
  selectedTenantIds: number[];
  excludedMap: Map<number, string>;
  manualIds: Set<number>;
  manualAmounts: Map<number, number>;
  /** Session memory so an exclude/un-tick does not lose the typed amount (spec §3.4). */
  lastManualAmounts: Map<number, number>;
  /**
   * Moved-out tenants stay hidden until the landlord asks for them (spec §9.1,
   * decision #6) — they can still be billed for a period they occupied. The
   * choice is remembered (spec §18.4).
   */
  showInactive: boolean;
  duplicateWarning: string | null;
  overlapWarning: string[];
  pendingMethod: string | null;
  saving: boolean;
  closing: boolean;
  error: string | null;
}

const SHOW_INACTIVE_KEY = "amenity-billing:show-inactive";

function readShowInactive(): boolean {
  try {
    return localStorage.getItem(SHOW_INACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function createBillForm(editing: AmenityBillRow | null) {
  let rooms = $state<RoomOption[]>([]);
  let allTenants = $state<PickTenant[]>([]);
  let roomTenants = $state<PickTenant[]>([]);

  const fields: BillFields = $state({
    amenity_name: editing?.amenity_name ?? "",
    billing_method: editing?.billing_method ?? "shared",
    total_amount: editing ? String(editing.total_amount) : "",
    billing_date: editing?.billing_date ?? new Date().toISOString().slice(0, 10),
    billing_period: editing?.billing_period ?? "",
    notes: editing?.notes ?? "",
    division_mode: editing?.division_mode ?? "auto",
    meter_start: editing?.meter_start != null ? String(editing.meter_start) : "",
    meter_end: editing?.meter_end != null ? String(editing.meter_end) : "",
    price_per_unit: editing?.price_per_unit != null ? String(editing.price_per_unit) : "",
    selectedRoomId: "",
    selectedConnectedRoomIds: [],
    selectedTenantIds: [],
    excludedMap: new Map(),
    manualIds: new Set(),
    manualAmounts: new Map(),
    lastManualAmounts: new Map(),
    showInactive: readShowInactive(),
    duplicateWarning: null,
    overlapWarning: [],
    pendingMethod: null,
    saving: false,
    closing: false,
    error: null,
  });

  // Remembering the toggle is an effect, not a write inside a handler: it must
  // follow any change (including hydration turning it on for a moved-out row).
  $effect(() => {
    try {
      localStorage.setItem(SHOW_INACTIVE_KEY, fields.showInactive ? "1" : "0");
    } catch {
      // Storage unavailable (private mode) — the toggle still works per open.
    }
  });

  let editInitialLoaded = false;

  async function loadEditing() {
    if (!editing || editInitialLoaded) return;
    const { tenantRows, roomRows } = await loadBillRows(editing.id);
    fields.selectedConnectedRoomIds = roomRows.map((r) => r.room_id);
    if (editing.billing_method === "per_room" && roomRows.length > 0) {
      fields.selectedRoomId = String(roomRows[0].room_id);
    }

    const shares = new Map<number, number>();
    const excl = new Map<number, string>();
    const sel: number[] = [];
    const manual = new Set<number>();
    // Bills saved before migration 083 carry no per-row flag. A `manual` bill
    // keeps every share fixed, exactly as it did before the upgrade.
    const legacyManual =
      editing.division_mode === "manual" && tenantRows.every((row) => row.is_manual === 0);
    for (const row of tenantRows) {
      if (row.is_excluded) excl.set(row.tenant_id, row.exclusion_reason ?? "");
      else {
        shares.set(row.tenant_id, row.amount);
        sel.push(row.tenant_id);
        if (row.is_manual === 1 || legacyManual) manual.add(row.tenant_id);
      }
    }
    fields.excludedMap = excl;
    fields.selectedTenantIds = sel;
    fields.manualIds = manual;
    fields.manualAmounts = new Map([...shares].filter(([id]) => manual.has(id)));
    fields.lastManualAmounts = new Map(fields.manualAmounts);

    // A bill can outlive a move-out — make sure the rows it already carries are
    // visible and editable instead of silently hidden.
    const billedIds = new Set([...sel, ...excl.keys()]);
    if (allTenants.some((t) => billedIds.has(t.id) && t.moved_out_date !== null)) {
      fields.showInactive = true;
    }

    if (editing.billing_method === "per_room" && fields.selectedRoomId) {
      roomTenants = await readRoomTenants(Number(fields.selectedRoomId));
    }
    editInitialLoaded = true;
  }

  async function load() {
    const loaded = await loadRoomsAndTenants();
    rooms = loaded.rooms;
    allTenants = loaded.allTenants;
    await loadEditing();
  }

  async function loadRoomTenants(roomId: number) {
    roomTenants = await readRoomTenants(roomId);
  }

  const pickableTenants = $derived(
    fields.showInactive ? allTenants : allTenants.filter((t) => t.moved_out_date === null),
  );

  const roomPickable: PickTenant[] = $derived(
    fields.showInactive ? roomTenants : roomTenants.filter((t) => t.moved_out_date === null),
  );

  const pooledTenants: PickTenant[] = $derived.by(() => {
    if (fields.billing_method !== "connected") return [];
    const pooled: PickTenant[] = [];
    for (const roomId of fields.selectedConnectedRoomIds) {
      for (const tenant of pickableTenants) if (tenant.room_id === roomId) pooled.push(tenant);
    }
    return pooled.sort((a, b) => a.name.localeCompare(b.name));
  });

  /** The ids that actually share this bill — the manual/automatic split pool. */
  const includedIds: number[] = $derived.by(() => {
    if (fields.billing_method === "shared") {
      return fields.selectedTenantIds.filter((id) => !fields.excludedMap.has(id));
    }
    if (fields.billing_method === "per_room") return roomPickable.map((t) => t.id);
    return pooledTenants.map((t) => t.id);
  });

  const split: SplitResult = $derived.by(() => {
    const empty: SplitResult = { shares: new Map(), errors: [], absorbed: 0 };
    const total = Number(fields.total_amount) || 0;
    if (!total || total <= 0) return empty;
    try {
      if (fields.billing_method === "shared") {
        const allIds = [...fields.selectedTenantIds, ...[...fields.excludedMap.keys()]];
        return calcSharedSplit({
          total,
          tenantIds: allIds,
          excluded: fields.excludedMap,
          manualOverrides: fields.manualAmounts,
        });
      }
      if (fields.billing_method === "per_room") {
        const ids = roomPickable.map((t) => t.id);
        return calcPerRoomSplit(ids, total, fields.manualAmounts, "manual");
      }
      const ids = pooledTenants.map((t) => t.id);
      return calcConnectedSplit(ids, total, fields.manualAmounts, "manual");
    } catch {
      return empty;
    }
  });

  const liveManualError: string | null = $derived.by(() => {
    const total = Number(fields.total_amount) || 0;
    if (total <= 0 || fields.manualAmounts.size === 0) return null;
    return validateManualAmounts(total, includedIds, fields.manualAmounts);
  });

  const takesAllWarning: string | null = $derived.by(() => {
    const total = Number(fields.total_amount) || 0;
    if (total <= 0 || fields.manualAmounts.size === 0) return null;
    return hasZeroAutoShare(includedIds, fields.manualAmounts, total)
      ? AMENITY_MESSAGES.manualTakesAll
      : null;
  });

  const computedShares = $derived(split.shares);

  const netTotal = $derived(
    round2([...computedShares.values()].reduce((sum, value) => round2(sum + value), 0)),
  );

  const meterInfo = $derived.by(() =>
    calculateMeterTotal(
      parseOptionalNumber(fields.meter_start),
      parseOptionalNumber(fields.meter_end),
      parseOptionalNumber(fields.price_per_unit),
    ),
  );

  return {
    fields,
    get rooms() {
      return rooms;
    },
    get pickableTenants() {
      return pickableTenants;
    },
    get roomPickable() {
      return roomPickable;
    },
    get pooledTenants() {
      return pooledTenants;
    },
    get includedIds() {
      return includedIds;
    },
    get split() {
      return split;
    },
    get computedShares() {
      return computedShares;
    },
    get netTotal() {
      return netTotal;
    },
    get meterInfo() {
      return meterInfo;
    },
    get liveManualError() {
      return liveManualError;
    },
    get takesAllWarning() {
      return takesAllWarning;
    },
    load,
    loadRoomTenants,
    toggleTenant: (id: number) => toggleSelectedTenant(fields, id),
    toggleExclude: (id: number) => excludeTenant(fields, id),
    toggleManual: (id: number) =>
      toggleManualTenant(
        fields,
        id,
        (tenantId) => fields.lastManualAmounts.get(tenantId) ?? computedShares.get(tenantId) ?? 0,
      ),
    onDivisionModeChange: (event: Event) =>
      applyDivisionMode(fields, event, includedIds, computedShares),
    toggleConnectedRoom: (id: number) => toggleConnected(fields, id),
    setManualAmount: (id: number, raw: string) => writeManualAmount(fields, id, raw),
    setExclusionReason: (id: number, raw: string) => writeExclusionReason(fields, id, raw),
    methodLabel,
    requestMethodChange: (next: string) => requestMethodChange(fields, next),
    applyMethodChange: () => applyMethodChange(fields),
  };
}
