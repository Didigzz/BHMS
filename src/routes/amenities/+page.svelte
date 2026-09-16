<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  onMount(() => goto("/amenities/billing", { replaceState: true }));
</script>
