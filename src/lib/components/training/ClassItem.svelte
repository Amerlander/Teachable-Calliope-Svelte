<script lang="ts">
  let {
    name,
    count,
    selected,
    onselect,
    onclear,
    ondelete,
    ondownload
  }: {
    name: string;
    count: number;
    selected: boolean;
    onselect: () => void;
    onclear: () => void;
    ondelete: () => void;
    ondownload: () => void;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="class-item"
  class:selected
  onclick={onselect}
  onkeydown={(e) => e.key === 'Enter' && onselect()}
  role="button"
  aria-pressed={selected}
  tabindex="0"
>
  <div class="class-name">
    <span class="name">{name}</span>
    <span class="count">{count}</span>
  </div>
  <div class="class-actions" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="none">
    {#if count > 0}
      <button class="ghost small" onclick={ondownload} title="Download">↓</button>
      <button class="ghost small" onclick={onclear} title="Clear">⊘</button>
    {/if}
    <button class="ghost small" onclick={ondelete} title="Delete">✕</button>
  </div>
</div>

<style lang="scss">
  .class-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: var(--md-radius-md);
    cursor: pointer;
    background: rgba(var(--md-surface-variant), 0.3);
    border: 2px solid transparent;
    transition: all 0.2s;
    outline: none;
    &:hover { background: rgb(var(--md-surface-variant)); box-shadow: var(--md-elevation-1); }
    &.selected {
      background: rgba(var(--md-primary-container));
      border-color: rgb(var(--md-primary));
      padding: 9px 11px;
    }
  }
  .class-name {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    .name { font-weight: 500; color: rgb(var(--md-on-surface)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count {
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      background: rgba(var(--md-surface-variant), 0.6);
      padding: 1px 6px;
      border-radius: 99px;
      flex-shrink: 0;
    }
  }
  .class-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    button {
      padding: 4px 8px;
      min-height: 28px;
      font-size: 13px;
      box-shadow: none;
    }
  }
</style>
