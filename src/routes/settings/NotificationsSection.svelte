<script lang="ts">
  import { onMount } from "svelte";
  import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
  import { getSetting, setSetting } from "$lib/settings";

  let {
    onError,
  }: {
    onError: (msg: string | null) => void;
  } = $props();

  // ----- notifications prefs -----
  let remindersEnabled = $state(true);
  let reminderDays = $state(3);
  let savingPrefs = $state(false);
  let prefsSaved = $state(false);
  let permissionGranted = $state(false);
  let permissionUnknown = $state(false);
  let requestingPermission = $state(false);

  async function loadPermission() {
    permissionUnknown = false;
    try {
      permissionGranted = await isPermissionGranted();
    } catch {
      // Not running inside Tauri (e.g. plain-browser dev) — hide the row.
      permissionUnknown = true;
    }
  }

  async function enableNotifications() {
    requestingPermission = true;
    onError(null);
    try {
      const result = await requestPermission();
      permissionGranted = result === "granted";
    } catch {
      permissionUnknown = true;
    } finally {
      requestingPermission = false;
    }
  }

  async function loadPrefs() {
    const enabled = await getSetting("notifications_enabled", "1");
    const days = await getSetting("reminder_days", "3");
    remindersEnabled = enabled === "1";
    reminderDays = Math.max(0, Math.min(30, Number(days) || 3));
  }

  onMount(() => {
    loadPrefs();
    loadPermission();
  });

  async function savePrefs() {
    onError(null);
    prefsSaved = false;
    savingPrefs = true;
    try {
      // Coerce + clamp to the same 0–30 range enforced on load (an empty
      // number input can bind as null/NaN in Svelte 5).
      const days = Math.max(0, Math.min(30, Math.round(Number(reminderDays) || 0)));
      reminderDays = days;
      await setSetting("notifications_enabled", remindersEnabled ? "1" : "0");
      await setSetting("reminder_days", String(days));
      prefsSaved = true;
      // Auto-clear the confirmation after a moment.
      setTimeout(() => {
        prefsSaved = false;
      }, 3000);
    } catch (e) {
      onError(`Failed to save preferences: ${String(e)}`);
    } finally {
      savingPrefs = false;
    }
  }
</script>

<div class="card">
  <h2 class="section-title">Notifications</h2>
  <p class="muted">
    Reminders arrive a few days before rent is due and when a tenant becomes overdue.
    Reminders are checked when you open the app — open it daily to stay reminded.
  </p>

  {#if !permissionUnknown}
    <div class="perm-row">
      {#if permissionGranted}
        <span class="perm-ok">Notifications enabled ✓</span>
      {:else}
        <span class="perm-muted">Notifications are blocked on this device.</span>
        <button
          class="btn"
          onclick={enableNotifications}
          disabled={requestingPermission}
        >
          {requestingPermission ? "Requesting…" : "Enable notifications"}
        </button>
      {/if}
    </div>
  {/if}

  <label class="switch-row">
    <input type="checkbox" bind:checked={remindersEnabled} />
    <span>Payment reminders</span>
  </label>

  <label class="field-label">
    Remind me
    <input
      type="number"
      min="0"
      max="30"
      step="1"
      bind:value={reminderDays}
      class="days-input"
    />
    <span>day{reminderDays === 1 ? "" : "s"} before rent is due</span>
  </label>

  <div class="settings-actions">
    <button class="btn btn-primary" onclick={savePrefs} disabled={savingPrefs}>
      {savingPrefs ? "Saving…" : "Save preferences"}
    </button>
  </div>
  {#if prefsSaved}
    <p class="prefs-saved">Preferences saved ✓</p>
  {/if}
</div>

<style>
  .settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0 8px;
  }

  .perm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
    font-size: 0.88rem;
  }

  .perm-ok {
    color: var(--green-deep);
    font-weight: 700;
  }

  .perm-muted {
    color: var(--label-2);
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

  .field-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--label-2);
    margin: 12px 0 4px;
  }

  .days-input {
    width: 64px;
    border-radius: 10px;
    border: 1px solid var(--separator);
    padding: 8px 10px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
    text-align: center;
  }

  .days-input:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
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
</style>
