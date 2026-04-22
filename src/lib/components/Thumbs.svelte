<script lang="ts">
  import VirtualList from 'svelte-tiny-virtual-list';
  import { examples, activeClass } from '$lib/stores';

  const THUMB_SIZE = 64;
  const GAP = 6;
  const CONTAINER_HEIGHT = 260;

  let containerWidth = $state(0);

  const rawImages = $derived(
    $activeClass ? [...($examples[$activeClass] ?? [])].reverse() : []
  );

  const columns = $derived(
    Math.max(1, Math.floor((containerWidth + GAP) / (THUMB_SIZE + GAP)))
  );
  const rowCount = $derived(Math.ceil(rawImages.length / columns));
  const rowSize = THUMB_SIZE + GAP;
</script>

<div class="thumbs-container" bind:clientWidth={containerWidth}>
  {#if !$activeClass}
    <div class="empty">Keine Klasse ausgewählt</div>
  {:else if rawImages.length === 0}
    <div class="empty">Keine Bilder aufgenommen</div>
  {:else if containerWidth > 0}
    <VirtualList
      height={CONTAINER_HEIGHT}
      width="100%"
      itemCount={rowCount}
      itemSize={rowSize}
      overscanCount={2}
    >
      <div slot="item" let:index let:style {style}>
        <div class="row" style="--cols: {columns}; --thumb: {THUMB_SIZE}px; --gap: {GAP}px;">
          {#each rawImages.slice(index * columns, (index + 1) * columns) as e}
            <img class="thumb" src={e.data} alt="Beispielbild" />
          {/each}
        </div>
      </div>
    </VirtualList>
  {/if}
</div>

<style lang="scss">
  .thumbs-container {
    width: 100%;
    min-height: 80px;
    border-radius: var(--md-radius-sm);
    background: rgba(var(--md-surface-variant), 0.25);
  }
  .empty {
    padding: 24px 12px;
    text-align: center;
    font-size: 13px;
    color: rgb(var(--md-on-surface-variant));
    font-style: italic;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(var(--cols), var(--thumb));
    gap: var(--gap);
    padding: 0 var(--gap);
  }
  .thumb {
    width: var(--thumb);
    height: var(--thumb);
    object-fit: cover;
    border-radius: 4px;
    display: block;
  }
</style>
