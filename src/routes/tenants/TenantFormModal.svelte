<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { modalMaterial } from "$lib/ui/motion";
  import { validateTenantForm } from "$lib/tenants/tenant-form";
  import { pushOverlay } from "$lib/ui/back-stack";
  import type { Room, Tenant, TenantFormState } from "$lib/tenants/types";
  import TenantBoardingToggle from "./TenantBoardingToggle.svelte";
  import TenantFormFields from "./TenantFormFields.svelte";

  let {
    editing,
    rooms,
    tenants,
    onSave,
    onClose,
  }: {
    editing: Tenant | null;
    rooms: Room[];
    tenants: Tenant[];
    onSave: (form: TenantFormState) => Promise<string | null>;
    onClose: () => void;
  } = $props();

  const emptyForm: TenantFormState = {
    id: null,
    name: "",
    contact: "",
    room_id: "",
    monthly_rate: "",
    move_in_date: "",
    due_date: "",
    deposit_amount: "",
    advance_amount: "",
    beds_occupied: "1",
    boarding: false,
    dueAuto: true,
  };

  // The modal is mounted per-open via {#if} in the page, so `editing` is only
  // read once at initialization — untrack() makes that one-time capture explicit.
  let form = $state<TenantFormState>(
    untrack(() =>
      editing
        ? {
            id: editing.id,
            name: editing.name,
            contact: editing.contact,
            room_id: String(editing.room_id),
            // Legacy tenants (pre-migration 031) have no rate — prefill from
            // their current room so an unrelated edit doesn't fail validation.
            monthly_rate:
              editing.monthly_rate == null
                ? String(rooms.find((r) => r.id === editing.room_id)?.monthly_rate ?? "")
                : String(editing.monthly_rate),
            move_in_date: editing.move_in_date,
            due_date: editing.due_date,
            deposit_amount: editing.deposit_amount == null ? "" : String(editing.deposit_amount),
            // The advance field holds MONEY: prefilled with the remaining
            // advance pot so editing it corrects the balance
            // (advance-money-field-spec.md §4.1).
            advance_amount: String(editing.advance_held ?? 0),
            beds_occupied: String(editing.beds_occupied ?? 1),
            // The toggle only exists in Add mode — editing is never boarding.
            boarding: false,
            dueAuto: false,
          }
        : { ...emptyForm }
    )
  );
  let formError: string | null = $state(null);
  // The rate auto-fills from the chosen room while adding until the landlord
  // edits it (mirrors the dueAuto hint behavior).
  let rateTouched = $state(false);
  // True while the save is in flight — disables the buttons and blocks a
  // second submit, so a slow save can't create duplicate tenants.
  let saving = $state(false);

  /** Local ISO "YYYY-MM-DD" for today (already-boarding move-in prefill + validation). */
  function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ----- "Already boarding?" toggle (Add mode only) -----
  // Turning ON backfills a tenant who moved in before the system existed: the
  // move-in date prefills with today and the due-date auto-suggest is disabled.
  // Turning OFF restores the previous auto-suggest state (spec §3.1) but never
  // clears typed values.
  let boardingDueAutoBefore = $state(true);
  function boardingChanged(checked: boolean) {
    if (checked) {
      boardingDueAutoBefore = form.dueAuto;
      if (!form.move_in_date) form.move_in_date = todayIso();
      form.dueAuto = false;
    } else {
      form.dueAuto = boardingDueAutoBefore;
    }
  }

  function validate(): string | null {
    const isAdding = form.id === null;
    const currentRoomIsSame =
      form.id !== null && String(tenants.find((t) => t.id === form.id)?.room_id) === String(form.room_id);
    const moverBeds = isAdding ? 1 : (tenants.find((t) => t.id === form.id)?.beds_occupied ?? 1);
    const room = rooms.find((r) => String(r.id) === String(form.room_id));
    return validateTenantForm(
      {
        name: form.name,
        contact: form.contact,
        room_id: form.room_id,
        monthly_rate: form.monthly_rate,
        move_in_date: form.move_in_date,
        due_date: form.due_date,
        deposit_amount: form.deposit_amount,
        advance_amount: form.advance_amount,
        beds_occupied: form.beds_occupied,
      },
      {
        // The toggle only exists in Add mode, so boarding is only ever true there.
        boarding: form.boarding && isAdding,
        today: todayIso(),
        room: room
          ? {
              room_number: room.room_number,
              capacity: room.capacity,
              occupied_beds: room.occupied_beds,
              held_beds: room.held_beds,
              maintenance: room.maintenance,
              whole_reservations: room.whole_reservations,
            }
          : null,
        isAdding,
        currentRoomIsSame,
        moverBeds,
      }
    );
  }

  async function submit() {
    if (saving) return;
    formError = validate();
    if (formError) return;
    saving = true;
    try {
      const dbError = await onSave(form);
      if (dbError) {
        formError = dbError;
      } else {
        onClose();
      }
    } finally {
      saving = false;
    }
  }

  // Android back button closes this modal (same path as Cancel) instead of
  // letting the WebView navigate its history.
  onMount(() => pushOverlay(onClose));
</script>

<div class="modal" role="dialog" aria-label="Tenant form" transition:modalMaterial>
  <form class="tenant-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <h2>{form.id === null ? (form.boarding ? "Add Existing Tenant" : "Add Tenant") : "Edit Tenant"}</h2>

    {#if form.id === null}
      <TenantBoardingToggle boarding={form.boarding} onChange={boardingChanged} />
    {/if}

    <TenantFormFields {form} {rooms} {rateTouched} onRateTouched={() => (rateTouched = true)} />

    {#if formError}
      <p class="form-error">{formError}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose} disabled={saving}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </form>
</div>

<style>
  /* ---- form ---- */
  .tenant-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .tenant-form h2 {
    margin: 0 0 4px;
    font-size: 1.2rem;
  }
</style>
