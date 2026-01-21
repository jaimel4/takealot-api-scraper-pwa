<script>
  import { onMount } from "svelte";

  onMount(async () => {
    if (!import.meta.env.DEV) return;
    if (!("serviceWorker" in navigator)) return;

    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  });
</script>

<slot />
