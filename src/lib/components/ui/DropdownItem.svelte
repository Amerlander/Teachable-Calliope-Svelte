<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    onclick,
    active = false,
    disabled = false,
    children
  }: {
    onclick?: (e: MouseEvent) => void;
    active?: boolean;
    disabled?: boolean;
    children?: Snippet;
  } = $props();
</script>

<button
  class="item"
  class:active
  class:disabled
  {disabled}
  onclick={disabled ? undefined : onclick}
  role="menuitem"
>
  {#if children}{@render children()}{/if}
</button>

<style lang="scss">
  .item {
    display: block;
    width: 100%;
    padding: 12px 24px;
    border: none;
    background: transparent;
    color: rgb(var(--md-on-surface));
    font-size: var(--md-font-size-label);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    box-shadow: none;
    min-height: unset;
    border-radius: 0;
    &:hover:not(.disabled)    { background: rgba(var(--md-primary), 0.08); }
    &.active  { background: rgb(var(--md-secondary-container)); color: rgb(var(--md-on-secondary-container)); }
    &.disabled { opacity: 0.4; cursor: not-allowed; }
  }
</style>
