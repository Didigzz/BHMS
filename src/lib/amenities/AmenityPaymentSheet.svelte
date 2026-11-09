<script lang="ts">
  import { onMount, tick } from "svelte";
  import { pushOverlay } from "$lib/ui/back-stack";
  import { formatDate, phpPesoPrecise } from "$lib/ui/format";
  import {
    AMENITY_PAYMENT_MESSAGES,
    todayIso,
    validatePaidDate,
    type AmenityPaymentSheetMode,
  } from "$lib/amenities/amenity-payments";

  let {
    mode,
    tenantName = "",
    roomNumber = "",
    amenityName = "",
    billingPeriod = null,
    amount = null,
    unpaidCount = 0,
    unpaidTotal = 0,
    paidDate = todayIso(),
    error = null,
    onConfirm,
    onClose,
  }: {
    mode: AmenityPaymentSheetMode;
    tenantName?: string;
    roomNumber?: string;
    amenityName?: string;
    billingPeriod?: string | null;
    amount?: number | null;
    unpaidCount?: number;
    unpaidTotal?: number;
    paidDate?: string;
    error?: string | null;
    onConfirm: (value: { paidDate?: string; note?: string }) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  let date = $state(paidDate || todayIso());
  let note = $state("");
  let saving = $state(false);
  let closing = $state(false);
  let localError = $state<string | null>(null);
  let dateInput: HTMLInputElement | undefined = $state();
  let noteInput: HTMLTextAreaElement | undefined = $state();

  const heading = $derived(
    mode === "record"
      ? "Record amenity payment"
      : mode === "bulk"
        ? "Mark all shares paid"
        : mode === "void"
          ? "Void payment"
          : "Edit paid date",
  );

  const primaryLabel = $derived(
    mode === "record"
      ? "Mark as paid"
      : mode === "bulk"
        ? `Mark ${unpaidCount} as paid`
        : mode === "void"
          ? "Void payment"
          : "Save date",
  );

  function close() {
    if (saving || closing) return;
    closing = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onClose, reduce ? 0 : 220);
  }

  async function submit() {
    if (saving) return;
    localError = null;
    if (mode !== "void") {
      const invalid = validatePaidDate(date, todayIso());
      if (invalid) {
        localError = invalid;
        return;
      }
    }
    saving = true;
    try {
      await onConfirm(mode === "void" ? { note } : { paidDate: date });
    } catch (e) {
      localError = String(e);
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    const unregister = pushOverlay(close);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    void tick().then(() => {
      if (mode === "void") noteInput?.focus();
      else dateInput?.focus();
    });
    return () => {
      unregister();
      window.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="sheet-backdrop" class:closing role="presentation" onclick={close}>
  <div
    class="sheet"
    class:closing
    role="dialog"
    aria-modal="true"
    aria-label={heading}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="sheet-grabber" aria-hidden="true"></div>

    <header class="sheet-head">
      <h2>{heading}</h2>
    </header>

    <div class="sheet-body">
      {#if error || localError}
        <p class="form-error">{error || localError}</p>
      {/if}

      {#if mode === "bulk"}
        <div class="payment-context">
          <p class="context-main">{amenityName}{billingPeriod ? ` · ${billingPeriod}` : ""}</p>
          <p class="context-amount">
            {unpaidCount} unpaid share{unpaidCount === 1 ? "" : "s"} · {phpPesoPrecise(unpaidTotal)}
          </p>
        </div>
      {:else}
        <div class="payment-context">
          <p class="context-main" title={tenantName}>{tenantName}</p>
          <p class="context-sub">{roomNumber}{amenityName ? ` · ${amenityName}` : ""}{billingPeriod ? ` · ${billingPeriod}` : ""}</p>
          {#if amount != null}
            <p class="context-amount">{mode === "void" ? "Voiding" : "Share"} {phpPesoPrecise(amount)}</p>
          {/if}
          {#if mode === "void" || mode === "date"}
            <p class="context-sub">Paid {formatDate(paidDate)}</p>
          {/if}
        </div>
      {/if}

      {#if mode !== "void"}
        <label class="field">
          <span class="field-label">Paid date</span>
          <input
            bind:this={dateInput}
            type="date"
            max={todayIso()}
            bind:value={date}
          />
        </label>
      {/if}

      {#if mode === "void"}
        <label class="field">
          <span class="field-label">Note (optional)</span>
          <textarea
            bind:this={noteInput}
            rows="2"
            maxlength="200"
            placeholder="e.g. wrong tenant, cash returned"
            bind:value={note}
          ></textarea>
        </label>
      {/if}
    </div>

    <footer class="sheet-foot">
      <button class="btn sheet-btn" onclick={close} disabled={saving || closing}>
        {mode === "void" ? "Keep payment" : "Cancel"}
      </button>
      <button
        class={`btn sheet-btn ${mode === "void" ? "btn-danger" : "btn-primary"}`}
        onclick={submit}
        disabled={saving || closing}
      >
        {saving ? "Saving…" : primaryLabel}
      </button>
    </footer>
  </div>
</div>

<style>
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
    max-height: calc(100% - env(safe-area-inset-top, 0px) - 34px);
    display: flex;
    flex-direction: column;
    background: var(--card);
    border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    padding: 0 18px calc(18px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -8px 40px -12px rgba(0, 0, 0, 0.45);
    transform: translateY(0);
    transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .sheet.closing {
    transform: translateY(100%);
  }
  @starting-style {
    .sheet {
      transform: translateY(100%);
    }
  }

  .sheet-grabber {
    width: 38px;
    height: 5px;
    border-radius: 999px;
    background: var(--separator-strong);
    margin: 10px auto 4px;
    flex-shrink: 0;
  }

  .sheet-head {
    padding: var(--space-3) 0 var(--space-2);
  }
  .sheet-head h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .sheet-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: var(--space-2);
  }

  .payment-context {
    background: var(--fill);
    border: 1px solid var(--separator);
    border-radius: var(--radius-control);
    padding: 12px;
  }
  .context-main {
    margin: 0;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .context-sub {
    margin: 2px 0 0;
    color: var(--label-3);
    font-size: 0.8rem;
  }
  .context-amount {
    margin: var(--space-2) 0 0;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--label-2);
  }
  .field input,
  .field textarea {
    font-family: inherit;
    font-size: 1rem;
    color: var(--label);
    background: var(--card);
    border: 1px solid var(--separator);
    border-radius: 9px;
    padding: 10px 12px;
    min-height: 44px;
    box-sizing: border-box;
  }
  .field textarea {
    min-height: 70px;
    resize: vertical;
  }
  .field input:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .sheet-foot {
    display: flex;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }
  .sheet-btn {
    flex: 1;
    min-height: 44px;
  }

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
