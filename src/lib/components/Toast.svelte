<script lang="ts">
  import { notifications } from '$lib/stores/notifications';
  import { fly } from 'svelte/transition';
  import { derived } from 'svelte/store';

  const visible = derived(notifications, $n => $n);
</script>

<div class="toast-container" aria-live="polite" aria-atomic="true">
  {#each $visible as n (n.id)}
    <div class="toast {n.type}" role="status" transition:fly={{ y: 10 }}>
      {n.message}
    </div>
  {/each}
</div>


<style>
  .toast-container {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
    z-index: 10000;
  }
  .toast {
    background: rgba(0,0,0,0.85);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    min-width: 220px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.2);
    font-size: 14px;
  }
  .toast.success { background: rgba(18, 120, 60, 0.95); }
  .toast.error { background: rgba(200, 40, 40, 0.9); }
  .toast.warning { background: rgba(200, 130, 44, 0.9); }
  .toast.info { background: rgba(0,0,0,0.85); }
</style>