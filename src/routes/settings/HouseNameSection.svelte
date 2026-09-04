<script lang="ts">
  import { onMount } from "svelte";
  import { getSetting, setSetting } from "$lib/settings";
  import { pushToast } from "$lib/toast.svelte";

  let {
    onError,
  }: {
    onError: (msg: string | null) => void;
  } = $props();

  let houseName = $state("RentEase");
  let loaded = $state(false);

  onMount(async () => {
    try {
      houseName = await getSetting("house_name", "RentEase");
    } catch (e) {
      onError(`Failed to load settings: ${String(e)}`);
    } finally {
      loaded = true;
    }
  });

  /** Persist the name; used at the top of payment receipts. */
  async function save() {
    const trimmed = houseName.trim();
    if (!trimmed) {
      pushToast("Boarding house name can't be empty", "error");
      houseName = await getSetting("house_name", "RentEase");
      return;
    }
    try {
      await setSetting("house_name", trimmed);
      houseName = trimmed;
      pushToast("Boarding house name saved", "success");
    } catch (e) {
      onError(`Failed to save: ${String(e)}`);
    }
  }
</script>

<div class="card">
  <h2 class="section-title">Receipts</h2>
  <p class="muted">This name appears at the top of payment receipts.</p>

  <label class="house-label">
    Boarding house name
    <div class="house-row">
      <input
        type="text"
        placeholder="e.g. RentEase"
        maxlength="60"
        bind:value={houseName}
      />
      <button type="button" class="btn btn-primary" onclick={save} disabled={!loaded}>Save</button>
    </div>
  </label>
</div>

<style>
  .house-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .house-row {
    display: flex;
    gap: 8px;
  }

  .house-row input {
    flex: 1;
    min-width: 0;
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  .house-row input:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }
</style>
