<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { exportBackup, chooseBackupFile, importBackup, type ChosenBackup } from "$lib/backup";
  import { getSetting } from "$lib/settings";
  import { formatDate } from "$lib/format";
  import { pushToast } from "$lib/toast.svelte";
  import { pushOverlay } from "$lib/back-stack";

  let {
    onError,
    onNote,
  }: {
    onError: (msg: string | null) => void;
    onNote: (msg: string | null) => void;
  } = $props();

  // ----- backup -----
  let exporting = $state(false);
  let importing = $state(false);
  let lastBackupDate = $state("");

  async function loadLastBackup() {
    lastBackupDate = await getSetting("last_backup_date", "");
  }

  onMount(loadLastBackup);

  async function doExport() {
    onError(null);
    onNote(null);
    exporting = true;
    try {
      const result = await exportBackup();
      if (!result.canceled) {
        onNote("Backup exported ✓");
        pushToast("Backup exported ✓", "success");
        await loadLastBackup();
      }
    } catch (e) {
      const msg = `Failed to export backup: ${String(e)}`;
      onError(msg);
      pushToast(msg, "error");
    } finally {
      exporting = false;
    }
  }

  // ----- import (pick → confirm modal → swap) -----
  let pendingImport: ChosenBackup | null = $state(null);

  async function doPickImport() {
    onError(null);
    onNote(null);
    try {
      const chosen = await chooseBackupFile();
      if (chosen) pendingImport = chosen;
    } catch (e) {
      const msg = String(e);
      onError(msg);
      pushToast(msg, "error");
    }
  }

  function closeImport() {
    if (importing) return;
    pendingImport = null;
  }

  // Android back button closes the restore-confirm dialog instead of
  // navigating away. This section is always mounted, so register only while
  // the (conditional) dialog is actually open.
  $effect(() => {
    if (!pendingImport) return;
    const unregister = pushOverlay(closeImport);
    return () => unregister();
  });

  async function confirmImport() {
    const chosen = pendingImport;
    if (!chosen) return;
    importing = true;
    onError(null);
    try {
      await importBackup(chosen);
      pendingImport = null;
      onNote("Backup restored ✓ All data was replaced.");
      pushToast("Backup restored — all data replaced", "success");
      await loadLastBackup();
    } catch (e) {
      const msg = String(e);
      onError(msg);
      pushToast(msg, "error");
    } finally {
      importing = false;
    }
  }
</script>

<div class="card">
  <h2 class="section-title">Backup &amp; Restore</h2>
  <p class="muted">
    Export shares a copy of your database so you can save it to Drive, email it, or move it
    to another phone. Import replaces everything on this phone with a backup.
  </p>

  <div class="settings-actions">
    <button class="btn btn-primary" onclick={doExport} disabled={exporting || importing}>
      {exporting ? "Exporting…" : "⬆ Export backup"}
    </button>
    <button class="btn" onclick={doPickImport} disabled={exporting || importing}>
      ⬇ Import backup
    </button>
  </div>

  <p class="last-backup">
    {#if lastBackupDate}
      Last backup: <strong>{formatDate(lastBackupDate)}</strong>
    {:else}
      No backup exported yet.
    {/if}
  </p>
</div>

{#if pendingImport}
  <div class="modal" role="dialog" aria-label="Restore backup" transition:modalMaterial>
    <div class="confirm-panel">
      <h2>Restore Backup</h2>
      <p class="history-subtitle">{pendingImport.fileName}</p>
      <p class="confirm-text">
        Restore “{pendingImport.fileName}”? This replaces <strong>ALL current data</strong> on
        this phone with the contents of the backup. This cannot be undone.
      </p>
      <div class="form-actions">
        <button type="button" class="btn" onclick={closeImport} disabled={importing}>Cancel</button>
        <button type="button" class="btn btn-primary" onclick={confirmImport} disabled={importing}>
          {importing ? "Restoring…" : "Replace Data"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0 8px;
  }

  .last-backup {
    margin: 8px 0 0;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  .card .muted {
    font-size: 0.88rem;
    line-height: 1.5;
  }
</style>
