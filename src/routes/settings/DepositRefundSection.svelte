<script lang="ts">
  import { onMount } from "svelte";
  import { getSetting, setSetting } from "$lib/db/settings";

  let {
    onError,
  }: {
    onError: (msg: string | null) => void;
  } = $props();

  let allowRefund = $state(true);
  let saving = $state(false);
  let saved = $state(false);

  onMount(async () => {
    allowRefund = (await getSetting("deposit_refund_allowed", "1")) === "1";
  });

  async function save() {
    onError(null);
    saved = false;
    saving = true;
    try {
      await setSetting("deposit_refund_allowed", allowRefund ? "1" : "0");
      saved = true;
      // Auto-clear the confirmation after a moment.
      setTimeout(() => {
        saved = false;
      }, 3000);
    } catch (e) {
      onError(`Failed to save setting: ${String(e)}`);
    } finally {
      saving = false;
    }
  }
</script>

<div class="card">
  <h2 class="section-title">Deposits</h2>
  <p class="muted">
    Tenants' upfront money (advance + deposit) is <strong>held as balance</strong> and only applied
    to months when you apply it. This controls what happens at move-out.
  </p>

  <label class="switch-row">
    <input type="checkbox" bind:checked={allowRefund} />
    <span>Allow deposit refund at move-out</span>
  </label>
  <p class="muted">
    When <strong>off</strong>, no refund prompt appears — the held deposit is meant to be applied to
    cover the tenant's remaining months instead (e.g. the last month).
  </p>

  <div class="settings-actions">
    <button class="btn btn-primary" onclick={save} disabled={saving}>
      {saving ? "Saving…" : "Save"}
    </button>
  </div>
  {#if saved}
    <p class="prefs-saved">Saved</p>
  {/if}
</div>

<style>
  .settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0 8px;
  }

  .switch-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.92rem;
    margin: 12px 0;
  }

  .switch-row input {
    -webkit-appearance: none;
    appearance: none;
    position: relative;
    width: 51px;
    height: 31px;
    margin: 0;
    border: none;
    border-radius: 16px;
    background: rgba(118, 118, 128, 0.32);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.2s ease;
  }

  .switch-row input::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 27px;
    height: 27px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15), 0 1px 1px rgba(0, 0, 0, 0.08);
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .switch-row input:checked {
    background: var(--green);
  }
  .switch-row input:checked::after {
    transform: translateX(20px);
  }
  .switch-row input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .prefs-saved {
    margin: 4px 0 0;
    color: var(--green-deep);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .card .muted {
    font-size: 0.88rem;
    line-height: 1.5;
  }

  @media (prefers-reduced-motion: reduce) {
    .switch-row input,
    .switch-row input::after {
      transition: none;
    }
  }

  /* Touch: the row is a <label> wrapping the switch, so a 44px row makes the
     whole width tappable instead of just the 51x31 control. */
  @media (pointer: coarse) {
    .switch-row {
      min-height: 44px;
    }
  }
</style>
