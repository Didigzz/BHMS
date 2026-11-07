<script lang="ts">
  import type { TransitionConfig } from "svelte/transition";
  // .svelte.ts modules are imported with the .svelte specifier (Svelte 5).
  import { dismissToast, toasts } from "$lib/toast.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import Info from "@lucide/svelte/icons/info";

  /** Top-banner toast motion: settle down from above; opacity-only when the
   *  user prefers reduced motion (mirrors the modalMaterial approach). */
  function toastBanner(node: Element): TransitionConfig {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      return { duration: 120, css: (t) => `opacity: ${t}` };
    }
    return {
      duration: 220,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      css: (t, u) => `opacity: ${t}; transform: translateY(${(-14 * u).toFixed(1)}px);`,
    };
  }
</script>

<div class="toast-host" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <button
      type="button"
      class="toast toast-{toast.variant}"
      title="Tap to dismiss"
      transition:toastBanner
      onclick={() => dismissToast(toast.id)}
    >
      <span class="toast-icon" aria-hidden="true">
        <Icon
          icon={toast.variant === "success" ? CircleCheck : toast.variant === "error" ? CircleX : Info}
          size={16}
        />
      </span>
      <span class="toast-message">{toast.message}</span>
    </button>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    top: calc(env(safe-area-inset-top) + 12px);
    left: 0;
    right: 0;
    z-index: 300; /* above the modal overlay (200) and the tab bar (100) */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    pointer-events: none; /* the empty host never blocks touches */
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(320px, 100%);
    width: max-content;
    border: 1px solid transparent;
    border-radius: 12px;
    padding: 10px 16px;
    font-family: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    line-height: 1.35;
    text-align: left;
    box-shadow: var(--shadow-1);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.12s cubic-bezier(0.23, 1, 0.32, 1);
  }

  .toast:active {
    transform: scale(0.98);
  }

  .toast-icon {
    display: inline-flex;
  }

  .toast-success {
    color: var(--green-deep);
    background: var(--green-soft);
    border-color: rgba(11, 110, 47, 0.2);
  }

  .toast-error {
    color: var(--red-deep);
    background: var(--red-soft);
    border-color: rgba(215, 0, 21, 0.25);
  }

  .toast-info {
    color: var(--accent-deep);
    background: var(--accent-soft);
    border-color: rgba(26, 92, 200, 0.2);
  }

  /* Guarded by the :root data-theme override (src/lib/theme.ts) in addition
     to the OS setting. */
  :global(:root[data-theme="dark"]) .toast-success,
  :global(:root[data-theme="dark"]) .toast-error,
  :global(:root[data-theme="dark"]) .toast-info {
    border-color: transparent;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .toast-success,
    :global(:root:not([data-theme="light"])) .toast-error,
    :global(:root:not([data-theme="light"])) .toast-info {
      border-color: transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .toast,
    .toast:active {
      transition: none;
    }
    .toast:active {
      transform: none;
    }
  }
</style>
