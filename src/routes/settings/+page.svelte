<script lang="ts">
  import AppearanceSection from "./AppearanceSection.svelte";
  import BackupSection from "./BackupSection.svelte";
  import NotificationsSection from "./NotificationsSection.svelte";
  import HouseNameSection from "./HouseNameSection.svelte";
  import BrandLogo from "$lib/ui/BrandLogo.svelte";
  import DepositRefundSection from "./DepositRefundSection.svelte";
  import ReportsSection from "./ReportsSection.svelte";

  // Page-level status banner shared by the section components: a section
  // reports via onError/onNote and the page renders one banner at the top.
  let error: string | null = $state(null);
  let note: string | null = $state(null);
</script>

<main>
  <header class="page-header">
    <div>
      <p class="eyebrow">Preferences</p>
      <h1>Settings</h1>
      <p class="subtitle">Theme, backup, notifications &amp; app info</p>
    </div>
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}
  {#if note}
    <div class="note-ok">{note}</div>
  {/if}

  <AppearanceSection onError={(m) => (error = m)} />
  <BackupSection onError={(m) => (error = m)} onNote={(m) => (note = m)} />
  <NotificationsSection onError={(m) => (error = m)} />
  <HouseNameSection onError={(m) => (error = m)} />
  <DepositRefundSection onError={(m) => (error = m)} />

  <div class="card">
    <h2 class="section-title">About</h2>
    <div class="about-brand"><BrandLogo size={44} tagline /></div>
    <p class="muted">Version 0.1.0</p>
    <p class="muted">
      Data stays on this phone — export a backup to keep it safe or move it to another phone.
    </p>
  </div>

  <ReportsSection onError={(m) => (error = m)} />
</main>

<style>
  .about-brand {
    margin: var(--space-3) 0;
  }

  /* Description paragraphs inside the settings cards render at this size
     (other pages' empty states keep the default). */
  .card .muted {
    font-size: 0.88rem;
    line-height: 1.5;
  }

  .note-ok {
    background: var(--green-soft);
    color: var(--green-deep);
    border: 1px solid color-mix(in srgb, var(--green) 26%, transparent);
    border-radius: var(--radius-control);
    padding: 10px 12px;
    margin-bottom: 16px;
  }
</style>
