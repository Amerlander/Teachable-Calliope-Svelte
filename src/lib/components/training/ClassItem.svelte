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
    <span class="name">{name}</span>
    <button
      class="edit-btn"
      onclick={startEdit}
      title="Umbenennen"
      aria-label="Umbenennen"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
      </svg>
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
    font-weight: 500;
    color: rgb(var(--md-on-surface));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    color: rgb(var(--md-on-surface-variant));
    border-radius: 999px;
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s, opacity 0.15s, color 0.15s;
    &:focus-visible {
      opacity: 1;
      outline: 2px solid rgb(var(--md-primary));
      outline-offset: 1px;
    }
    &:hover {
      background: rgba(var(--md-on-surface), 0.08);
      color: rgb(var(--md-on-surface));
    }
  }
  .class-item:hover .edit-btn,
  .class-item.selected .edit-btn {
    opacity: 0.7;
    &:hover { opacity: 1; }
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
