<script lang="ts">
  import { onMount } from "svelte";
  import { phpPesoPrecise } from "$lib/ui/format";
  import { modalMaterial } from "$lib/ui/motion";
  import { pushOverlay } from "$lib/ui/back-stack";
  import Icon from "$lib/ui/Icon.svelte";
  import HandCoins from "@lucide/svelte/icons/hand-coins";
  import type { Tenant } from "./types";

  let {
    tenant,
    onConfirm,
    onClose,
  }: {
    tenant: Tenant;
    onConfirm: (t: Tenant) => Promise<void>;
    onClose: () => void;
  } = $props();

  let saving = $state(false);

  async function confirm() {
    saving = true;
    try {
      await onConfirm(tenant);
    } finally {
      saving = false;
    }
  }

  function close() {
    if (saving) return;
    onClose();
  }

  // Android back button closes this modal instead of navigating away.
  onMount(() => {
    const unregister = pushOverlay(close);
    return unregister;
  });
</script>

<div class="modal" role="dialog" aria-label="Mark as moved out" transition:modalMaterial>
  <div class="confirm-panel">
    <h2>Move Out</h2>
    <p class="history-subtitle">{tenant.name} · {tenant.room_number}</p>
    <p class="confirm-text">
      Mark {tenant.name} as moved out? Their room frees up, and their record
      (including payment history) is kept in the Archived view.
    </p>
    {#if tenant.deposit_held > 0 && tenant.deposit_refunded === 0}
      <p class="deposit-note"><span class="lead-icon"><Icon icon={HandCoins} size={16} /></span>Held deposit of {phpPesoPrecise(tenant.deposit_held)} is still unrefunded.</p>
    {:else if tenant.advance_held > 0}
      <p class="deposit-note"><span class="lead-icon"><Icon icon={HandCoins} size={16} /></span>{phpPesoPrecise(tenant.advance_held)} advance is still held — apply it to cover months if refunds aren't allowed.</p>
    {/if}
    <div class="form-actions">
      <button type="button" class="btn" onclick={close} disabled={saving}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={confirm} disabled={saving}>
        {saving ? "Saving…" : "Mark Moved Out"}
      </button>
    </div>
  </div>
</div>

<style>
  .lead-icon {
    display: inline-flex;
    margin-right: 6px;
    vertical-align: -0.15em;
  }
</style>

