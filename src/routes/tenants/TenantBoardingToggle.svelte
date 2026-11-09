<script lang="ts">
  import { onMount } from "svelte";

  /**
   * "Already boarding?" switch (Add mode only) with its "?" help tooltip.
   *
   * ON = backfilling a tenant who moved in before the system was introduced;
   * the parent decides what that means for the dates and room checks. The
   * tooltip is tap-to-toggle on touch, hover on desktop, and Esc-blur to close.
   */
  let { boarding, onChange }: { boarding: boolean; onChange: (checked: boolean) => void } = $props();

  let helpOpen = $state(false);
  // The pointer that opened the tooltip. A mouse hover already shows it, so a
  // following mouse click must not immediately toggle it back off.
  let helpPointerType = "";

  function onHelpPointerEnter(e: PointerEvent) {
    if (e.pointerType === "mouse") helpOpen = true;
  }
  function onHelpPointerLeave(e: PointerEvent) {
    if (e.pointerType === "mouse") helpOpen = false;
  }
  function onHelpPointerDown(e: PointerEvent) {
    helpPointerType = e.pointerType;
  }
  function onHelpClick() {
    // Mouse hover owns the open state; only touch/keyboard clicks toggle.
    if (helpPointerType === "mouse") return;
    helpOpen = !helpOpen;
  }
  function onHelpFocus(e: FocusEvent) {
    // A touch tap also focuses the button but doesn't match :focus-visible, so
    // its click can still toggle the tooltip.
    if ((e.currentTarget as HTMLElement).matches(":focus-visible")) helpOpen = true;
  }
  function onHelpBlur() {
    helpOpen = false;
  }
  function onHelpKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") helpOpen = false;
  }

  onMount(() => {
    // Mobile: a tap anywhere outside the boarding box dismisses the tooltip.
    const onDocPointerDown = (e: PointerEvent) => {
      if (!helpOpen) return;
      if ((e.target as HTMLElement | null)?.closest(".boarding-box")) return;
      helpOpen = false;
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  });
</script>

<div class="boarding-box">
  <div class="boarding-row">
    <button
      type="button"
      class="help-btn"
      aria-label="Help: what does Already boarding mean?"
      aria-describedby={helpOpen ? "boarding-help-tip" : undefined}
      onpointerenter={onHelpPointerEnter}
      onpointerleave={onHelpPointerLeave}
      onpointerdown={onHelpPointerDown}
      onclick={onHelpClick}
      onfocus={onHelpFocus}
      onblur={onHelpBlur}
      onkeydown={onHelpKeydown}
    >?</button>
    <label class="switch-row">
      <span>Already boarding?</span>
      <input
        type="checkbox"
        class="switch"
        checked={boarding}
        onchange={(e) => onChange(e.currentTarget.checked)}
        aria-label="Already boarding?"
      />
    </label>
  </div>
  {#if helpOpen}
    <span class="help-tip" role="tooltip" id="boarding-help-tip">
      Use this option for tenants who moved in before the system was introduced.
    </span>
  {/if}
</div>

<style>
  /* ---- "Already boarding?" toggle (Add mode only) ---- */
  .boarding-box {
    position: relative;
    margin: 0 0 2px;
    padding: 10px 12px;
    border: 1px solid var(--separator);
    border-radius: var(--radius-control);
    background: var(--card);
  }

  .boarding-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .boarding-row .switch-row {
    flex: 1;
    min-width: 0;
  }

  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
    font-size: 0.92rem;
    color: var(--label);
    cursor: pointer;
  }

  /* iOS-style pill switch (same pattern as the Settings sections). */
  input.switch {
    -webkit-appearance: none;
    appearance: none;
    position: relative;
    width: 44px;
    height: 27px;
    margin: 0;
    border: none;
    border-radius: 14px;
    background: rgba(118, 118, 128, 0.32);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.2s ease;
  }

  input.switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 23px;
    height: 23px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15), 0 1px 1px rgba(0, 0, 0, 0.08);
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  }

  input.switch:checked {
    background: var(--green);
  }
  input.switch:checked::after {
    transform: translateX(17px);
  }
  input.switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---- compact "?" help button + tooltip ---- */
  .help-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--separator);
    border-radius: 999px;
    background: var(--fill);
    color: var(--label-3);
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  @media (hover: hover) {
    .help-btn:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
  }
  .help-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    color: var(--accent);
    border-color: var(--accent);
  }

  @media (pointer: coarse) {
    /* The row is a <label>, so a 44px row makes its whole width a target
       instead of just the 44x27 switch at the end of it. */
    .switch-row {
      min-height: 44px;
    }

    /* "?" is a 22px circle between the card edge and the label. Grow the
       tappable box to 44px without moving the circle or the row, accepting that
       ~11px of the label's left edge now belongs to the button — the label is
       still tappable across the rest of its width. */
    .help-btn {
      position: relative;
    }
    .help-btn::before {
      content: "";
      position: absolute;
      inset: -11px;
    }
  }

  .help-tip {
    position: absolute;
    top: calc(100% - 2px);
    left: 0;
    z-index: 5;
    max-width: 240px;
    padding: 8px 10px;
    border: 1px solid var(--separator);
    border-radius: var(--radius-control);
    background: var(--card);
    box-shadow: var(--shadow-modal);
    color: var(--label-2);
    font-size: 0.82rem;
    font-weight: 500;
    line-height: 1.4;
  }
</style>
