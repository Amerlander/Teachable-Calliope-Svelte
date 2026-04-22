<script lang="ts">
  import Dropdown from './Dropdown.svelte';

  let { text, title = '' }: { text: string; title?: string } = $props();
</script>

<span class="info-tooltip">
  <Dropdown placement="bottom-end" minWidth="260px" closeOnClick={false}>
    {#snippet trigger()}
      <span class="icon" aria-label="Info" title="Info">?</span>
    {/snippet}
    {#snippet children()}
      <div class="tip">
        {#if title}<div class="title">{title}</div>{/if}
        <div class="body">{text}</div>
      </div>
    {/snippet}
  </Dropdown>
</span>

<style lang="scss">
  .info-tooltip {
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgb(var(--md-surface-variant));
    color: rgb(var(--md-on-surface-variant));
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    cursor: help;
    user-select: none;
    transition: background 0.15s, color 0.15s;
    &:hover {
      background: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
    }
  }
  :global(.dropdown-content) .tip {
    padding: 10px 14px;
    max-width: 280px;
    font-size: 12px;
    line-height: 1.45;
    color: rgb(var(--md-on-surface));
    .title {
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 13px;
    }
    .body {
      color: rgb(var(--md-on-surface-variant));
    }
  }
</style>
