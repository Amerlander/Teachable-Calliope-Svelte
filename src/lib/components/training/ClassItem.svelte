<script lang="ts">
  let {
    name,
    count,
    selected,
    onselect
  }: {
    name: string;
    count: number;
    selected: boolean;
    onselect: () => void;
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
  <span class="name">{name}</span>
  <span class="count">{count}</span>
</div>

<style lang="scss">
  .class-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    gap: 8px;
    border-radius: var(--md-radius-md);
    cursor: pointer;
    background: rgba(var(--md-surface-variant), 0.3);
    border: 2px solid transparent;
    transition: all 0.2s;
    outline: none;
    &:hover {
      background: rgb(var(--md-surface-variant));
      box-shadow: var(--md-elevation-1);
    }
    &.selected {
      background: rgba(var(--md-primary-container));
      border-color: rgb(var(--md-primary));
      padding: 9px 11px;
    }
  }
  .name {
    font-weight: 500;
    color: rgb(var(--md-on-surface));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .count {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    background: rgba(var(--md-surface-variant), 0.6);
    padding: 1px 6px;
    border-radius: 99px;
    flex-shrink: 0;
  }
</style>
