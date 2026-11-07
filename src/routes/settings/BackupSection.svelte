<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import {
    chooseBackupFile,
    exportBackup,
    importBackup,
    shareBackup,
    type BackupResult,
    type ChosenBackup,
  } from "$lib/backup";
  import { BACKUP_MESSAGES } from "$lib/backup-format";
  import { getPlatformCapabilities, type PlatformCapabilities } from "$lib/platform";
  import { getSetting } from "$lib/settings";
  import { formatDate } from "$lib/format";
  import { pushToast } from "$lib/toast.svelte";
  import { pushOverlay } from "$lib/back-stack";
  import Icon from "$lib/components/Icon.svelte";
  import Upload from "@lucide/svelte/icons/upload";
  import Download from "@lucide/svelte/icons/download";
  import Share2 from "@lucide/svelte/icons/share-2";

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
  /** The most recent export, kept so the Share action can reuse its URI. */
  let lastExport: BackupResult | null = $state(null);

  /**
   * Export needs somewhere to put the file; **import does not** — picking a file
   * and rebuilding the database both work wherever the app runs, so a platform
   * with no file writer can still restore a backup. Only export is gated.
   */
  let caps = $state<PlatformCapabilities | null>(null);
  getPlatformCapabilities().then((c) => (caps = c));
  const canSave = $derived(caps === null || caps.saveToDevice);

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
      lastExport = result;
      const msg = `Backup saved to ${result.location}`;
      onNote(msg);
      pushToast(msg, "success");
      await loadLastBackup();
    } catch (e) {
      lastExport = null;
      const msg = String(e instanceof Error ? e.message : e);
      onError(msg);
      pushToast(msg, "error");
    } finally {
      exporting = false;
    }
  }

  async function doShare() {
    const target = lastExport;
    if (!target) return;
    try {
      await shareBackup(target.fileName, target.uri);
    } catch (e) {
      const msg = `Could not share the backup: ${String(e)}`;
      onError(msg);
      pushToast(msg, "error");
    }
  }

  // ----- import (pick → confirm modal → safety copy → rebuild + swap) -----
  /** Two stages: the normal confirm, then a second one for an empty backup. */
  type Stage = "confirm" | "empty";
  let pendingImport: ChosenBackup | null = $state(null);
  let stage: Stage = $state("confirm");

  async function doPickImport() {
    onError(null);
    onNote(null);
    try {
      const chosen = await chooseBackupFile();
      if (chosen) {
        pendingImport = chosen;
        stage = "confirm";
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      onError(msg);
      pushToast(msg, "error");
    }
  }

  function closeImport() {
    if (importing) return;
    pendingImport = null;
    stage = "confirm";
  }

  /** Android back button closes the restore-confirm dialog instead of leaving. */
  $effect(() => {
    if (!pendingImport) return;
    const unregister = pushOverlay(closeImport);
    return () => unregister();
  });

  /** Confirm button: an empty backup asks a second time before erasing anything. */
  function advance() {
    const chosen = pendingImport;
    if (!chosen) return;
    if (chosen.snapshot.summary.isEmpty && stage === "confirm") {
      stage = "empty";
      return;
    }
    confirmImport();
  }

  async function confirmImport() {
    const chosen = pendingImport;
    if (!chosen) return;
    importing = true;
    onError(null);
    try {
      await importBackup(chosen);
      const msg = BACKUP_MESSAGES.restored(chosen.fileName);
      onNote(msg);
      pushToast(msg, "success");
      pendingImport = null;
      stage = "confirm";
      await loadLastBackup();
      // Every page still holds pre-restore data in memory — land on the
      // dashboard after the message has been seen.
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      onError(msg);
      pushToast(msg, "error");
    } finally {
      importing = false;
    }
  }

  /** "12 rooms · 34 tenants · 210 payments" for the confirm dialog. */
  function countSummary(counts: { label: string; count: number }[]): string {
    return counts
      .filter((c) => c.count > 0)
      .map((c) => `${c.count} ${c.label}`)
      .join(" · ");
  }

  function exportedDate(iso: string): string {
    return iso ? formatDate(iso.slice(0, 10)) : "—";
  }
</script>

<div class="card">
  <h2 class="section-title">Backup &amp; Restore</h2>
  <p class="muted">
    Export saves a readable <code>.digal</code> backup of your database into Downloads — keep it in
    Drive, email it, or move it to another phone. Import replaces everything on this phone with a
    backup.
  </p>

  <div class="settings-actions">
    <button
      class="btn btn-primary"
      onclick={doExport}
      disabled={exporting || importing || !canSave}
    >
      <span class="btn-icon"><Icon icon={Upload} size={16} /></span>{exporting ? "Exporting…" : "Export backup"}
    </button>
    <button class="btn" onclick={doPickImport} disabled={exporting || importing}>
      <span class="btn-icon"><Icon icon={Download} size={16} /></span>Import backup
    </button>
    {#if lastExport?.uri && caps?.shareSheet}
      <button class="btn" onclick={doShare} disabled={exporting || importing}><span class="btn-icon"><Icon icon={Share2} size={16} /></span>Share backup</button>
    {/if}
  </div>

  {#if caps && !caps.saveToDevice && caps.unavailableReason}
    <p class="muted">{caps.unavailableReason}</p>
  {/if}

  <p class="last-backup">
    {#if lastBackupDate}
      Last backup: <strong>{formatDate(lastBackupDate)}</strong>
    {:else}
      No backup exported yet.
    {/if}
  </p>
</div>

{#if pendingImport}
  {@const summary = pendingImport.snapshot.summary}
  <div class="modal" role="dialog" aria-label="Restore backup" transition:modalMaterial>
    <div class="confirm-panel">
      <h2>{stage === "empty" ? "Restore An Empty Backup" : "Restore Backup"}</h2>
      <p class="history-subtitle">{pendingImport.fileName}</p>

      <dl class="backup-manifest">
        <div class="manifest-row">
          <dt>Exported</dt>
          <dd>{exportedDate(summary.exportedAt)}</dd>
        </div>
        {#if summary.houseName}
          <div class="manifest-row">
            <dt>House</dt>
            <dd>{summary.houseName}</dd>
          </div>
        {/if}
        <div class="manifest-row">
          <dt>Contents</dt>
          <dd>{summary.isEmpty ? "No tenants or rooms" : countSummary(summary.counts)}</dd>
        </div>
      </dl>

      {#if stage === "confirm"}
        {#if pendingImport.comparison.isSmaller}
          <!-- Replacing is the point of an import, so the one case worth a
               warning is a file that carries LESS than this device already has. -->
          <p class="confirm-text confirm-warn">
            {BACKUP_MESSAGES.smallerBackup(
              pendingImport.comparison.backupTotal,
              pendingImport.comparison.liveTotal
            )}
          </p>
          <ul class="reduction-list">
            {#each pendingImport.comparison.reductions as reduction}
              <li>
                <span>{reduction.label}</span>
                <span>{reduction.backup} in the file · {reduction.live} on this device</span>
              </li>
            {/each}
          </ul>
        {/if}
        <p class="confirm-text">
          Restore “{pendingImport.fileName}”? This replaces <strong>ALL current data</strong> on this
          phone with the contents of the backup. A copy of your current data is saved to Downloads
          first. This cannot be undone.
        </p>
        <div class="form-actions">
          <button type="button" class="btn" onclick={closeImport} disabled={importing}>Cancel</button>
          <button type="button" class="btn btn-primary" onclick={advance} disabled={importing}>
            {summary.isEmpty ? "Continue…" : importing ? "Restoring…" : "Replace Data"}
          </button>
        </div>
      {:else}
        <p class="confirm-text confirm-warn">
          This backup contains no tenants or rooms. Restoring it will erase all data on this phone.
          Continue?
        </p>
        <div class="form-actions">
          <button
            type="button"
            class="btn"
            onclick={() => (stage = "confirm")}
            disabled={importing}
          >
            Cancel
          </button>
          <button type="button" class="btn btn-danger" onclick={confirmImport} disabled={importing}>
            {importing ? "Restoring…" : "Erase & Restore"}
          </button>
        </div>
      {/if}
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

  .card code {
    font-size: 0.85em;
  }

  /* ---- restore confirm dialog: what exactly is inside this file ---- */
  .backup-manifest {
    margin: 12px 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--fill);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .manifest-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.85rem;
  }

  .manifest-row dt {
    color: var(--label-2);
  }

  .manifest-row dd {
    margin: 0;
    text-align: right;
    font-weight: 600;
    color: var(--label);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .confirm-warn {
    color: var(--red-deep);
    font-weight: 600;
  }

  /* Every table where the file carries less than the device does. */
  .reduction-list {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--fill);
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.82rem;
  }

  .reduction-list li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .reduction-list li span:first-child {
    color: var(--label-2);
  }

  .btn-icon {
    display: inline-flex;
    margin-right: 6px;
    vertical-align: -0.15em;
  }
</style>
