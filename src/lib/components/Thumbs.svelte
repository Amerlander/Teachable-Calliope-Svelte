<script lang="ts">
  import { examples, activeClass } from '$lib/stores';
</script>

<div class="thumbs">
  {#if $activeClass}
    {#each $examples[$activeClass].slice().reverse() || [] as e}
      <img class="thumb" src={e.data} alt="thumb" />
    {/each}
  {:else}
    <div style="color: #666; font-size: 14px;">Keine Klasse ausgewählt</div>
  {/if}
</div>