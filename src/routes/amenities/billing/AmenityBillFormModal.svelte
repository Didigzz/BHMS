<script lang="ts">
  import { onMount } from "svelte";
  import { pushToast } from "$lib/ui/toast.svelte";
  import { pushOverlay } from "$lib/ui/back-stack";
  import { phpPesoPrecise } from "$lib/ui/format";
  import { getDb } from "$lib/db/db";
  import { parseOptionalNumber } from "$lib/amenities/amenity-billing";
  import type { AmenityBillRow } from "$lib/amenities/amenity-actions";
  import BillTenantPicker from "./BillTenantPicker.svelte";
  import AmenityBillFields from "./AmenityBillFields.svelte";
  import { saveAmenityBill } from "./bill-save";
  import type { BillingMethod, DivisionMode } from "./bill-form-types";
  import { createBillForm } from "./bill-form.svelte";

  let {
    editing,
    onSaveDone,
    onClose,
  }: {
    editing: AmenityBillRow | null;
    onSaveDone: () => void;
    onClose: () => void;
  } = $props();

  // All fields, derivation and selection handlers live in the rune module; the
  // sheet below is markup, the meter/room block, and save orchestration.
  const form = createBillForm(editing);
  const fields = form.fields;

  onMount(async () => {
    await form.load();
  });

  // Android back closes the sheet before it falls through to navigation.
  onMount(() => pushOverlay(close));

  // Escape does the same on desktop, where there is no back button.
  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  $effect(() => {
    if (fields.selectedRoomId) form.loadRoomTenants(Number(fields.selectedRoomId));
  });

  /**
   * Save the bill. `confirmed` carries the landlord's answers to the two
   * "proceed anyway" prompts (duplicate bill, overlapping connected rooms) —
   * without it the sheet would ask again forever.
   */
  async function handleSave(confirmed: { duplicate?: boolean; overlap?: boolean } = {}) {
    fields.error = null;
    fields.duplicateWarning = null;
    fields.overlapWarning = [];
    try {
      const roomIds =
        fields.billing_method === "per_room"
          ? fields.selectedRoomId
            ? [Number(fields.selectedRoomId)]
            : []
          : fields.billing_method === "connected"
            ? [...fields.selectedConnectedRoomIds]
            : [];

      const outcome = await saveAmenityBill(await getDb(), {
        amenityName: fields.amenity_name.trim(),
        method: fields.billing_method as BillingMethod,
        total: Number(fields.total_amount),
        billingDate: fields.billing_date,
        billingPeriod: fields.billing_period.trim(),
        notes: fields.notes.trim(),
        divisionMode: fields.division_mode as DivisionMode,
        shares: form.computedShares,
        manualIds: [...fields.manualAmounts.keys()].filter((id) => form.computedShares.has(id)),
        excluded: fields.excludedMap,
        roomIds,
        meterStart: parseOptionalNumber(fields.meter_start),
        meterEnd: parseOptionalNumber(fields.meter_end),
        pricePerUnit: parseOptionalNumber(fields.price_per_unit),
        editingId: editing?.id ?? null,
        allowDuplicate: confirmed.duplicate === true,
        allowOverlap: confirmed.overlap === true,
        onWrite: () => {
          fields.saving = true;
        },
      });

      if (outcome.status === "error") {
        fields.error = outcome.message;
        return;
      }
      if (outcome.status === "duplicate") {
        fields.duplicateWarning = outcome.message;
        return;
      }
      if (outcome.status === "overlap") {
        fields.overlapWarning = outcome.messages;
        return;
      }

      pushToast(
        editing
          ? `Amenity bill updated — ${fields.amenity_name.trim()}`
          : `Amenity bill created — ${fields.amenity_name.trim()} ${phpPesoPrecise(Number(fields.total_amount))}`,
        "success",
      );
      dismiss(onSaveDone);
    } catch (e) {
      // An unexpected throw (a field state that is not a string, say) must not
      // leave the sheet open with no feedback — show it inline.
      fields.error = String(e);
    } finally {
      fields.saving = false;
    }
  }

  function reduceMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Play the slide-down first, then unmount through the caller's callback. */
  function dismiss(done: () => void) {
    if (fields.closing) return;
    fields.closing = true;
    window.setTimeout(done, reduceMotion() ? 0 : 250);
  }

  function close() {
    if (fields.saving) return;
    dismiss(onClose);
  }
</script>

<div class="sheet-backdrop" class:closing={fields.closing} role="presentation" onclick={close}>
  <div
    class="sheet"
    class:closing={fields.closing}
    role="dialog"
    aria-modal="true"
    aria-label={editing ? "Edit Amenity Bill" : "New Amenity Bill"}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="sheet-grabber" aria-hidden="true"></div>

    <header class="sheet-head">
      <h2>{editing ? "Edit Amenity Bill" : "New Amenity Bill"}</h2>
    </header>

    <div class="sheet-body">
      {#if fields.error}
        <p class="form-error">{fields.error}</p>
      {/if}
      {#if fields.duplicateWarning}
        <div class="alert">
          {fields.duplicateWarning}
          <div class="form-actions">
            <button class="btn btn-primary" onclick={() => { fields.duplicateWarning = null; handleSave({ duplicate: true }); }}>Proceed Anyway</button>
            <button class="btn" onclick={() => fields.duplicateWarning = null}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if fields.overlapWarning.length > 0}
        <div class="alert">
          {fields.overlapWarning.join("; ")}. Add {fields.overlapWarning.length > 1 ? "them" : "it"} to this bill anyway?
          <div class="form-actions">
            <button class="btn btn-primary" onclick={() => { fields.overlapWarning = []; handleSave({ overlap: true }); }}>Proceed Anyway</button>
            <button class="btn" onclick={() => fields.overlapWarning = []}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if fields.pendingMethod}
        <div class="alert">
          Switching to {form.methodLabel(fields.pendingMethod)} will recompute the shares from the selected tenants or rooms.
          <div class="form-actions">
            <button class="btn btn-primary" onclick={form.applyMethodChange}>Switch Method</button>
            <button class="btn" onclick={() => fields.pendingMethod = null}>Keep {form.methodLabel(fields.billing_method)}</button>
          </div>
        </div>
      {/if}
      {#if form.meterInfo.error}
        <p class="form-error">{form.meterInfo.error}</p>
      {/if}

      <AmenityBillFields
        {fields}
        absorbed={form.split.absorbed > 0 && form.computedShares.size > 0 ? form.split.absorbed : 0}
        netTotal={form.netTotal}
        liveManualError={form.liveManualError}
        takesAllWarning={form.takesAllWarning}
        rooms={form.rooms}
        roomPickable={form.roomPickable}
        meterInfo={form.meterInfo}
        onMethodChange={form.requestMethodChange}
        onDivisionChange={form.onDivisionModeChange}
        onToggleConnected={form.toggleConnectedRoom}
      />

      <BillTenantPicker
        method={fields.billing_method as BillingMethod}
        manualIds={fields.manualIds}
        pickableTenants={form.pickableTenants}
        roomPickable={form.roomPickable}
        pooledTenants={form.pooledTenants}
        selectedRoomId={fields.selectedRoomId}
        selectedTenantIds={fields.selectedTenantIds}
        excludedMap={fields.excludedMap}
        manualAmounts={fields.manualAmounts}
        shares={form.computedShares}
        bind:showInactive={fields.showInactive}
        onToggleTenant={form.toggleTenant}
        onToggleExclude={form.toggleExclude}
        onToggleManual={form.toggleManual}
        onSetReason={form.setExclusionReason}
        onSetAmount={form.setManualAmount}
      />
    </div>

    <footer class="sheet-foot">
      <button class="btn sheet-btn btn-cancel" onclick={close} disabled={fields.saving || fields.closing}>Cancel</button>
      <button class="btn btn-primary sheet-btn" onclick={() => handleSave()} disabled={fields.saving || fields.closing}>
        {fields.saving ? "Saving…" : editing ? "Save Changes" : "Create Bill"}
      </button>
    </footer>
  </div>
</div>

<style>
  /* ---- presentation: a form sheet, not a centered dialog ---------------- */
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    transition: background-color 0.25s ease;
  }
  .sheet-backdrop.closing {
    background: rgba(0, 0, 0, 0);
  }
  @starting-style {
    .sheet-backdrop {
      background: rgba(0, 0, 0, 0);
    }
  }
  :global(:root[data-theme="dark"]) .sheet-backdrop {
    background: rgba(0, 0, 0, 0.5);
  }
  :global(:root[data-theme="dark"]) .sheet-backdrop.closing {
    background: rgba(0, 0, 0, 0);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .sheet-backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
    :global(:root:not([data-theme="light"])) .sheet-backdrop.closing {
      background: rgba(0, 0, 0, 0);
    }
  }

  .sheet {
    width: 100%;
    max-width: 560px;
    height: 100%;
    /* Leaves the phone's status bar visible above the sheet, exactly as the
       mockup does, while staying full-height on a desktop window. */
    max-height: calc(100% - env(safe-area-inset-top, 0px) - 34px);
    display: flex;
    flex-direction: column;
    background: var(--card);
    border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    border: 1px solid var(--separator);
    border-bottom: none;
    box-shadow: var(--shadow-modal);
    overflow: hidden;
    color-scheme: light;
    transform: translateY(0);
    transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
    will-change: transform;
  }
  .sheet.closing {
    transform: translateY(110%);
  }
  @starting-style {
    .sheet {
      transform: translateY(110%);
    }
  }
  :global(:root[data-theme="dark"]) .sheet {
    color-scheme: dark;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .sheet {
      color-scheme: dark;
    }
  }

  .sheet-grabber {
    flex-shrink: 0;
    width: 44px;
    height: 5px;
    border-radius: 999px;
    background: var(--separator);
    margin: 10px auto 0;
  }

  .sheet-head {
    flex-shrink: 0;
    padding: 14px 20px 12px;
  }
  .sheet-head h2 {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.022em;
  }

  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 20px 20px;
  }

  .sheet-foot {
    flex-shrink: 0;
    display: flex;
    gap: 10px;
    padding: 12px 20px calc(env(safe-area-inset-bottom, 0px) + 14px);
    border-top: 1px solid var(--separator);
    background: var(--card);
  }
  .sheet-btn {
    flex: 1;
    padding: 13px 14px;
    border-radius: 12px;
    font-size: 0.95rem;
  }
  .btn-cancel {
    background: var(--fill);
    border: none;
    color: var(--accent);
  }

  /* ---- reduced transparency / motion ------------------------------------ */
  @media (prefers-reduced-motion: reduce) {
    .sheet-backdrop,
    .sheet {
      transition: none;
    }
    @starting-style {
      .sheet-backdrop {
        background: rgba(0, 0, 0, 0.35);
      }
      .sheet {
        transform: translateY(0);
      }
    }
  }
</style>
