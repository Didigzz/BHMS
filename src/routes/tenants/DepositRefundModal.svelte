<script lang="ts">
  import { phpPesoPrecise } from "$lib/format";
  import { modalMaterial } from "$lib/motion";
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
</script>

<div class="modal" role="dialog" aria-label="Deposit refund" transition:modalMaterial>
  <div class="confirm-panel">
    <h2>Deposit Refund</h2>
    <p class="history-subtitle">{tenant.name} has moved out</p>
    <p class="confirm-text">
      Refund their deposit of <strong>{phpPesoPrecise(tenant.deposit_amount ?? 0)}</strong>?
    </p>
    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose}>Not now</button>
      <button type="button" class="btn btn-paid" onclick={() => onRefund(tenant)}>
        Mark as Refunded
      </button>
    </div>
  </div>
</div>

