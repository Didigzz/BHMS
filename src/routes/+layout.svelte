<script lang="ts">
  import { onMount } from "svelte";
  import { checkAndNotify } from "$lib/reservations/reminders";
  import { initTheme } from "$lib/ui/theme";
  import { needsRecovery, readDatabaseState, type DatabaseState } from "$lib/db/db-health";
  import ToastHost from "$lib/ui/ToastHost.svelte";
  import AppDock from "$lib/ui/AppDock.svelte";
  import RecoveryScreen from "$lib/ui/RecoveryScreen.svelte";
  import TitlebarDragStrip from "$lib/ui/TitlebarDragStrip.svelte";
  // App-wide design system (buttons, cards, badges, modal overlay, theme).
  import "../app.css";

  let recovery = $state<DatabaseState | null>(null);

  // Startup: apply the saved theme (Settings → Appearance, brief flash of the
  // device theme is expected while it loads) and fire any due/overdue pings
  // that happened while the app was closed (de-duped in notifications_log).
  // Both are safe in a plain browser dev server — the Tauri plugin calls are
  // guarded inside theme.ts / reminders.ts.
  onMount(async () => {
    initTheme();

    const state = await readDatabaseState();
    if (needsRecovery(state)) {
      // Deliberately does not call checkAndNotify(): nothing may touch the
      // database here, or the plugin would create an empty one in its place.
      recovery = state;
      return;
    }

    checkAndNotify();
  });
</script>

{#if recovery}
  <RecoveryScreen state={recovery} />
{:else}
  <TitlebarDragStrip />
  <slot />
  <AppDock />
{/if}

<ToastHost />
