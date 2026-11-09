<script lang="ts">
  /** Level 2's bed-count stepper; the parent owns the draft and the save. */
  let {
    bedsOccupied,
    bedsDraft = $bindable(),
    maxBeds,
    roomFree,
    savingBeds,
    onApply,
  }: {
    bedsOccupied: number;
    bedsDraft: number;
    maxBeds: number;
    roomFree: number;
    savingBeds: boolean;
    onApply: () => void;
  } = $props();
</script>

<div class="beds-control">
  <div class="beds-info">
    <span class="beds-label">Beds occupied</span>
    <span class="beds-free" class:full={roomFree === 0}>
      · {roomFree} bed{roomFree === 1 ? "" : "s"} free
    </span>
  </div>
  <div class="beds-stepper-row">
    <div class="beds-stepper">
      <button
        type="button"
        class="step-btn"
        onclick={() => (bedsDraft = Math.max(1, bedsDraft - 1))}
        disabled={bedsDraft <= 1}
        aria-label="Fewer beds"
      >−</button>
      <span class="beds-value">{bedsDraft}</span>
      <button
        type="button"
        class="step-btn"
        onclick={() => (bedsDraft = Math.min(maxBeds, bedsDraft + 1))}
        disabled={bedsDraft >= maxBeds}
        aria-label="More beds"
      >+</button>
    </div>
    <button
      type="button"
      class="btn btn-small btn-primary"
      onclick={onApply}
      disabled={bedsDraft === bedsOccupied || savingBeds}
    >
      {savingBeds ? "Saving…" : "Apply"}
    </button>
  </div>
</div>

<style>
  /* ---- level-2 bed-count control ---- */
  .beds-control {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    margin-bottom: 12px;
    border: 1px solid var(--separator);
    border-radius: 12px;
    background: var(--fill);
  }

  .beds-info {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 0.85rem;
  }
  .beds-label {
    font-weight: 700;
  }
  .beds-free {
    color: var(--label-3);
  }
  .beds-free.full {
    color: var(--red-deep);
    font-weight: 700;
  }

  .beds-stepper-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .beds-stepper {
    display: flex;
    align-items: center;
    border: 1px solid var(--separator);
    border-radius: 999px;
    overflow: hidden;
    background: var(--card);
  }
  .step-btn {
    width: 38px;
    height: 38px;
    border: none;
    background: none;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--accent);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  @media (hover: hover) {
    .step-btn:hover:not(:disabled) {
      background: var(--fill);
    }
  }

  /* Touch: the ± steppers set a tenant's bed count — too consequential, and
     too tightly paired, for a 38px target. */
  @media (pointer: coarse) {
    .step-btn {
      width: 44px;
      height: 44px;
    }
  }
  .step-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .beds-value {
    min-width: 46px;
    text-align: center;
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
