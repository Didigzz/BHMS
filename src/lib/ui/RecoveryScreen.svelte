<script lang="ts">
  import { restoreSafetyCopy, type DatabaseState } from "$lib/db/db-health";

  /**
   * Shown instead of the app when this install has lost its database file. An
   * empty RentEase is indistinguishable from a landlord's data having vanished,
   * so nothing renders until the safety copy is back.
   */
  let { state: databaseState }: { state: DatabaseState } = $props();

  let recovering = $state(false);
  let recoveryError = $state<string | null>(null);

  async function recover() {
    recovering = true;
    recoveryError = null;
    try {
      await restoreSafetyCopy();
      window.location.reload();
    } catch (error) {
      recoveryError = String(error instanceof Error ? error.message : error);
    } finally {
      recovering = false;
    }
  }
</script>

<div class="recovery" role="alertdialog" aria-label="Recover your data">
  <div class="recovery-card">
    <h1>RentEase can't find your data</h1>
    <p class="recovery-detail">
      Your data file is missing from this device. RentEase has <strong>not</strong> started empty in
      its place, so nothing has been overwritten or lost.
    </p>
    {#if databaseState.latestSafetyCopy}
      <p class="recovery-detail">
        A safety copy is available from just before your last restore:
        <code>{databaseState.latestSafetyCopy}</code>
      </p>
      <button class="btn btn-primary" onclick={recover} disabled={recovering}>
        {recovering ? "Restoring…" : "Restore my data"}
      </button>
    {:else}
      <p class="recovery-detail">
        No safety copy was found on this device. Import a <code>.digal</code> backup from
        Settings → Backup &amp; Restore on another device, then copy it here.
      </p>
    {/if}
    {#if recoveryError}
      <p class="recovery-error">{recoveryError}</p>
    {/if}
  </div>
</div>

<style>
  /* ---- recovery: shown instead of the app when the data file is missing --- */
  .recovery {
    position: fixed;
    inset: 0;
    /* Above the toast host (300) — nothing from the app should show through. */
    z-index: 400;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--label);
  }

  .recovery-card {
    max-width: 460px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .recovery-card h1 {
    margin: 0;
    font-size: 1.25rem;
  }

  .recovery-detail {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--label-2);
    overflow-wrap: anywhere;
  }

  .recovery-detail code {
    font-size: 0.85em;
  }

  .recovery-error {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--red-deep);
  }
</style>
