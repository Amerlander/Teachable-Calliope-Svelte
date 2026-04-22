<script lang="ts">
  let {
    name,
    count,
    selected,
    onselect,
    onrename
  }: {
    name: string;
    count: number;
    selected: boolean;
    onselect: () => void;
    onrename?: (next: string) => void;
  } = $props();

  let editing = $state(false);
  let draft = $state('');

  function startEdit(e: Event) {
    e.stopPropagation();
    draft = name;
    editing = true;
  }

  function commit() {
    const next = draft.trim();
    editing = false;
    if (next && next !== name) onrename?.(next);
  }

  function cancel() {
    editing = false;
    draft = '';
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      cancel();
    }
    e.stopPropagation();
  }
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
  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="name-edit"
      bind:value={draft}
      onkeydown={onInputKey}
      onblur={commit}
      onclick={(e) => e.stopPropagation()}
      autofocus
    />
  {:else}
    <button
      class="name"
      onclick={startEdit}
      onkeydown={(e) => e.key === 'Enter' && startEdit(e)}
      title="Umbenennen"
    >
      {name}
    </button>
  {/if}
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
    flex: 1;
    min-width: 0;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 500;
    color: rgb(var(--md-on-surface));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: text;
    box-shadow: none;
    min-height: unset;
    border-radius: 0;
    &:hover {
      text-decoration: underline dotted;
      text-underline-offset: 3px;
    }
  }
  .name-edit {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    border: 1.5px solid rgb(var(--md-primary));
    border-radius: var(--md-radius-sm);
    background: rgb(var(--md-surface));
    font: inherit;
    font-weight: 500;
    color: rgb(var(--md-on-surface));
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
