<script lang="ts">
  import { onMount } from "svelte";
  import { getThemePreference, setThemePreference, type ThemePreference } from "$lib/theme";

  let {
    onError,
  }: {
    onError: (msg: string | null) => void;
  } = $props();

  // ----- theme state -----
  // Single "Light mode" switch: ON = light theme, OFF = dark theme.
  let lightMode = $state(false);
  let loaded = $state(false);

  onMount(() => {
    loadPref();
  });

  async function loadPref() {
    try {
      const pref = await getThemePreference();
      // "system" (the old follow-the-device default) is treated as dark —
      // there's no follow-device mode anymore, and dark is the app default.
      lightMode = pref === "light";
    } catch (e) {
      onError(`Failed to load theme: ${String(e)}`);
    } finally {
      loaded = true;
    }
  }

  /** Apply + persist a choice; failures surface via the page banner. */
  async function save(pref: ThemePreference) {
    try {
      await setThemePreference(pref);
      onError(null);
    } catch (e) {
      onError(`Failed to save theme: ${String(e)}`);
    }
  }
</script>

<div class="card">
  <h2 class="section-title">Appearance</h2>
  <p class="muted">Switch between the dark and light themes.</p>

  <label class="switch-row">
    <span>Light mode</span>
    <input
      type="checkbox"
      class="switch"
      checked={lightMode}
      onchange={(e) => {
        lightMode = e.currentTarget.checked;
        save(lightMode ? "light" : "dark");
      }}
      disabled={!loaded}
      aria-label="Light mode"
    />
  </label>

  <p class="theme-note">{lightMode ? "Light theme." : "Dark theme."}</p>
</div>

<style>
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
    font-size: 0.92rem;
    margin: 12px 0;
    cursor: pointer;
  }

  /* iOS-style pill switch (same pattern as the Notifications section). */
  input.switch {
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

  input.switch::after {
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

  input.switch:checked {
    background: var(--green);
  }
  input.switch:checked::after {
    transform: translateX(20px);
  }
  input.switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  input.switch:disabled {
    cursor: default;
  }

  .theme-note {
    margin: 4px 0 0;
    font-size: 0.85rem;
    color: var(--label-3);
  }

  .card .muted {
    font-size: 0.88rem;
    line-height: 1.5;
  }

  @media (prefers-reduced-motion: reduce) {
    input.switch,
    input.switch::after {
      transition: none;
    }
  }
</style>
