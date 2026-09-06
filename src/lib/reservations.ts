/**
 * Reservation form helpers (reserve-room-lock-spec.md).
 *
 * Pure functions over plain room data — no database access in the capacity
 * math — so the gating rules are unit-testable in isolation and the form just
 * feeds in the selected/locked room (mirrors `earnings.ts` / `bed-boxes.ts`).
 *
 * Rules (spec §5):
 * - "Whole room" is only valid when the room is FULLY vacant (no tenants, no
 *   partial holds, no whole hold). On a partially occupied room the dropdown
 *   entry is disabled and Save is blocked.
 * - "One bed" is valid while at least one bed is free.
 * - "Custom" is never disabled in the dropdown, but the bed count is capped at
 *   the room's remaining beds and Save is blocked above the cap.
 * - Save is gated ONLY on capacity-invalid selections; name/contact/dates still
 *   validate at submit time, as before.
 * - The same rules apply to the room-card flow (room locked) and the general
 *   Reservations page (room freely picked).
 */

import type Database from "@tauri-apps/plugin-sql";

export type HoldType = "whole" | "bed" | "custom";

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

/** The room fields the capacity math needs (subset of the rooms/reservations
 * queries — both `Room` (rooms page) and `RoomOption` (reservations page)
 * structurally satisfy it). */
export interface CapacityRoom {
  capacity: number;
  occupied_beds: number;
  held_beds: number;
  has_whole_hold: number;
  maintenance: number;
}

/** Beds a room still has free (occupied beds + partial holds vs capacity). */
export function remainingBeds(room: CapacityRoom): number {
  return room.capacity - room.occupied_beds - room.held_beds;
}

/** True when holding `holdType` for `beds` beds is possible in `room` right
 * now (the room-list filter; `beds` is the requested custom count, or null
 * for whole-room holds). */
export function roomFitsHold(
  room: CapacityRoom,
  holdType: HoldType,
  beds: number | null
): boolean {
  if (room.maintenance === 1) return false;
  // A whole-room hold needs a completely vacant room (no tenants, no holds).
  if (holdType === "whole") {
    return room.occupied_beds === 0 && room.held_beds === 0 && room.has_whole_hold === 0;
  }
  if (room.has_whole_hold === 1) return false;
  if (beds == null || !Number.isInteger(beds) || beds < 1) return false;
  return beds <= remainingBeds(room);
}

/** True when the hold-type dropdown entry must be disabled for `room`. With no
 * room (or no capacity info) every entry stays enabled — capacity can't be
 * judged yet, and submit-time validation covers the missing-room case. */
export function holdOptionDisabled(
  room: CapacityRoom | null | undefined,
  holdType: HoldType
): boolean {
  if (!room) return false;
  if (room.maintenance === 1) return true;
  if (holdType === "whole") {
    return room.occupied_beds > 0 || room.held_beds > 0 || room.has_whole_hold === 1;
  }
  if (room.has_whole_hold === 1) return true;
  if (holdType === "bed") return remainingBeds(room) < 1;
  // "custom" stays enabled in the dropdown — the count is gated via Save.
  return false;
}

/** True when Save must be disabled because the selection exceeds the room's
 * real remaining capacity. `bedCount` is the parsed custom count (NaN when
 * untyped/invalid — only consulted for the "custom" hold type). */
export function saveDisabledForCapacity(
  room: CapacityRoom | null | undefined,
  holdType: HoldType,
  bedCount: number
): boolean {
  if (!room) return false; // no capacity context — submit-time validation
  if (room.maintenance === 1) return true;
  if (holdType === "whole") {
    return room.occupied_beds > 0 || room.held_beds > 0 || room.has_whole_hold === 1;
  }
  if (room.has_whole_hold === 1) return true;
  const free = remainingBeds(room);
  if (holdType === "bed") return free < 1;
  // custom
  return !Number.isInteger(bedCount) || bedCount < 1 || bedCount > free;
}

/** A short hint under the hold-type control explaining any capacity-disabled
 * state — an invalid option (shown even while another, valid option is
 * selected) or an over-cap custom count; null when everything is fine (or no
 * room). Priority: custom-count errors first (the user is actively editing the
 * count), then whole-room-hold / full-room / whole-room-unavailable. */
export function capacityHint(
  room: CapacityRoom | null | undefined,
  holdType: HoldType,
  bedCount: number
): string | null {
  if (!room) return null;
  if (room.maintenance === 1) return "Room is under maintenance.";
  const free = remainingBeds(room);
  if (holdType === "custom") {
    if (!Number.isInteger(bedCount) || bedCount < 1) {
      return "Beds to hold must be a whole number of at least 1.";
    }
    if (bedCount > free) {
      return `You can hold at most ${free} bed${free === 1 ? "" : "s"}.`;
    }
  }
  // A whole-room hold blocks every partial hold — say so first.
  if (room.has_whole_hold === 1) return "Room is fully reserved for the whole room.";
  if (free < 1) return "Room is full — no beds left to hold";
  // Whole room disabled because of partial occupancy / partial holds — explain
  // it even while another hold type is selected.
  if (holdOptionDisabled(room, "whole")) {
    if (room.occupied_beds > 0) {
      return `Whole room unavailable — ${room.occupied_beds} of ${room.capacity} bed${room.capacity === 1 ? "" : "s"} occupied`;
    }
    return "Whole room unavailable — the room already has an active hold";
  }
  return null;
}

/**
 * Persist a reservation; returns a friendly error string, or null on success.
 * Shared by the Reservations page and the room-card flow (both map the same
 * DB-trigger errors — maintenance / tenants present / conflicting hold / full).
 */
export async function insertReservation(
  db: Database,
  form: ReservationFormState
): Promise<string | null> {
  try {
    // The form field is a number input — Svelte binds it as a number (or
    // undefined when empty), so accept both and normalize to null/₱ value.
    const deposit =
      form.deposit == null || String(form.deposit).trim() === "" ? null : Number(form.deposit);
    // 'whole' holds the entire room (no bed count); 'bed' is exactly one;
    // 'custom' carries the bed count the landlord typed in the form.
    const bedCount =
      form.hold_type === "whole" ? null : form.hold_type === "bed" ? 1 : Number(form.bed_count);
    await db.execute(
      "INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count, deposit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [Number(form.room_id), form.name.trim(), form.contact.trim(), form.reservation_date, form.target_move_in_date, form.hold_type, bedCount, deposit]
    );
    return null;
  } catch (e) {
    const msg = String(e);
    if (msg.toLowerCase().includes("under maintenance")) return "That room is under maintenance.";
    if (msg.toLowerCase().includes("already has tenants")) {
      return "That room already has tenants — choose a bed hold instead.";
    }
    if (msg.toLowerCase().includes("reserved")) return "That room already has a conflicting hold.";
    if (msg.toLowerCase().includes("full capacity")) return "That room has no beds left.";
    return `Failed to save reservation: ${msg}`;
  }
}