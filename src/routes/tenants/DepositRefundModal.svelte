<script lang="ts">
  import { onMount } from "svelte";
  import { phpPesoPrecise } from "$lib/format";
  import { modalMaterial } from "$lib/motion";
  import { pushOverlay } from "$lib/back-stack";
  import type { Tenant } from "./types";

  let {
    tenant,
    onRefund,
    onClose,
  }: {
    tenant: Tenant;
    onRefund: (t: Tenant) => void;
    onClose: () => void;
  } = $props();

  // Android back button closes this modal instead of navigating away.
  onMount(() => {
    const unregister = pushOverlay(onClose);
    return unregister;
  });
</script>

<div class="modal" role="dialog" aria-label="Deposit refund" transition:modalMaterial>
  <div class="confirm-panel">
    <h2>Deposit Refund</h2>
    <p class="history-subtitle">{tenant.name} has moved out</p>
    <p class="confirm-text">
      Refund their remaining held deposit of <strong>{phpPesoPrecise(tenant.deposit_held ?? 0)}</strong>?
      <span class="refund-note">(Advance money is not refundable.)</span>
    </p>
    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose}>Not now</button>
      <button type="button" class="btn btn-paid" onclick={() => onRefund(tenant)}>
        Mark as Refunded
      </button>
    </div>
  </div>
</div>

<style>
  .refund-note {
    display: block;
    margin-top: 4px;
    font-size: 0.8rem;
    color: var(--label-3);
  }
</style>
