<script lang="ts">
  import { page } from "$app/state";

  let { children } = $props();

  const onBilling = $derived(page.url.pathname.startsWith("/amenities/billing"));
</script>

<div class="amenities-tabs">
  <nav class="segmented" aria-label="Amenities">
    <a
      href="/amenities/billing"
      class:active={onBilling}
      aria-current={onBilling ? "page" : undefined}
    >
      Billing
    </a>
    <a
      href="/amenities/payments"
      class:active={!onBilling}
      aria-current={!onBilling ? "page" : undefined}
    >
      Payments
    </a>
  </nav>
</div>

{@render children()}

<style>
  .amenities-tabs {
    max-width: 560px;
    margin: 0 auto;
    padding: calc(24px + env(safe-area-inset-top, 0px)) 16px 0;
    box-sizing: border-box;
  }
  .segmented a {
    flex: 1;
    text-align: center;
    padding: 9px 10px;
    border-radius: calc(var(--radius-control) - 3px);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--label-2);
    text-decoration: none;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }
  .segmented a.active {
    background: var(--seg-pill);
    color: var(--label);
    box-shadow:
      inset 0 0 0 1px var(--separator),
      0 2px 6px -3px rgba(26, 33, 30, 0.28);
  }
  @media (prefers-reduced-motion: reduce) {
    .segmented a {
      transition: none;
    }
  }
</style>
