<script lang="ts">
  import { phpPesoPrecise } from "$lib/format";
  import { modalMaterial } from "$lib/motion";
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
</script>

<div class="modal" role="dialog" aria-label="Mark as moved out" transition:modalMaterial>
  <div class="confirm-panel">
    <h2>Move Out</h2>
    <p class="history-subtitle">{tenant.name} · {tenant.room_number}</p>
    <p class="confirm-text">
      Mark {tenant.name} as moved out? Their room frees up, and their record
      (including payment history) is kept in the Archived view.
    </p>
    {#if tenant.deposit_amount != null && tenant.deposit_amount > 0 && tenant.deposit_refunded === 0}
      <p class="deposit-note">💰 Deposit of {phpPesoPrecise(tenant.deposit_amount)} is still unrefunded.</p>
    {/if}
    <div class="form-actions">
      <button type="button" class="btn" onclick={close} disabled={saving}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={confirm} disabled={saving}>
        {saving ? "Saving…" : "Mark Moved Out"}
      </button>
    </div>
  </div>
</div>

