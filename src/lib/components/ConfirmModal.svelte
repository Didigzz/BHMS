<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { pushOverlay } from "$lib/back-stack";

  /**
   * Shared confirmation dialog — the app-wide pattern for any action that
   * needs explicit confirmation (delete room, permanently delete tenant,
   * cancel reservation, restore backup). Renders inside the global `.modal`
   * overlay from +layout.svelte and matches the existing `.confirm-panel`
   * style used by the Move-Out / Deposit-Refund / Backup-Restore dialogs.
   */
  let {
    title,
    message,
    subtitle,
    note,
    confirmLabel = "Confirm",
    busyLabel = "Working…",
    danger = false,
    onConfirm,
    onClose,
  }: {
    title: string;
    message: string;
    subtitle?: string;
    note?: string;
    confirmLabel?: string;
    busyLabel?: string;
    danger?: boolean;
    onConfirm: () => void | Promise<void>;
    onClose: () => void;
  } = $props();

  let busy = $state(false);

  async function confirm() {
    busy = true;
    try {
      await onConfirm();
    } catch {
      // Callers surface their own errors (page alert); never let a rejecting
      // callback become an unhandled rejection or leave the button spinning.
    } finally {
      busy = false;
    }
  }

  function close() {
    if (busy) return;
    onClose();
  }

  // Android back button closes this modal instead of navigating away.
  onMount(() => {
    const unregister = pushOverlay(close);
    return unregister;
  });
</script>

<div class="modal" role="dialog" aria-modal="true" aria-label={title} transition:modalMaterial>
  <div class="confirm-panel">
    <h2>{title}</h2>
    {#if subtitle}
      <p class="history-subtitle">{subtitle}</p>
    {/if}
    <p class="confirm-text">{message}</p>
    {#if note}
      <p class="note">{note}</p>
    {/if}
    <div class="form-actions">
      <button type="button" class="btn" onclick={close} disabled={busy}>Cancel</button>
      <button
        type="button"
        class="btn {danger ? 'btn-danger' : 'btn-primary'}"
        onclick={confirm}
        disabled={busy}
      >
        {busy ? busyLabel : confirmLabel}
      </button>
    </div>
  </div>
</div>

<style>
  /* The shared confirm button renders in filled danger red, overriding the
     global outline-style .btn-danger hover. */
  .btn-danger {
    background: var(--red);
    border-color: transparent;
    color: #ffffff;
  }
  .btn-danger:hover {
    background: var(--red-press);
    border-color: transparent;
    color: #ffffff;
  }
</style>
