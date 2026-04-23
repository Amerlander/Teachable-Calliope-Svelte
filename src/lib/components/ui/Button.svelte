<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'primary',
    ghost = false,
    active = false,
    size = 'medium',
    disabled = false,
    fullWidth = false,
    type = 'button',
    onclick,
    children,
    ...rest
  }: {
    variant?: 'primary' | 'ghost' | 'active';
    ghost?: boolean;
    active?: boolean;
    size?: 'small' | 'medium';
    disabled?: boolean;
    fullWidth?: boolean;
    type?: 'button' | 'submit' | 'reset';
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

<button
  {type}
  {disabled}
  class:ghost={ghost || variant === 'ghost'}
  class:active-btn={active || variant === 'active'}
  class:small={size === 'small'}
  class:full={fullWidth}
  onclick={disabled ? undefined : onclick}
  {...rest}
>
  {#if children}{@render children()}{/if}
</button>

<style lang="scss">
  button {
    background: rgb(var(--md-primary));
    color: rgb(var(--md-on-primary));
    border: none;
    border-radius: var(--md-radius-sm);
    padding: 10px 24px;
    cursor: pointer;
    user-select: none;
    font-family: var(--md-font);
    font-size: var(--md-font-size-label);
    font-weight: 500;
    letter-spacing: 0.1px;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    box-shadow: var(--md-elevation-1);
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    vertical-align: middle;

    &:hover  { box-shadow: var(--md-elevation-2); background: rgba(var(--md-hover), 0.9); }
    &:active { box-shadow: var(--md-elevation-1); }
    &:disabled {
      background: rgba(var(--md-on-surface), 0.12);
      color: rgba(var(--md-on-surface), 0.38);
      box-shadow: none;
      cursor: not-allowed;
    }

    &.ghost {
      background: transparent;
      color: rgb(var(--md-primary));
      border: 1px solid rgb(var(--md-outline));
      box-shadow: none;
      &:hover {
        background: rgba(var(--md-primary), 0.08);
        border-color: rgb(var(--md-primary));
        box-shadow: none;
      }
    }

    &.active-btn {
      background: rgb(var(--md-tertiary));
      color: rgb(var(--md-on-tertiary));
      &:hover { background: var(--btn-green-hover); }
    }

    &.small { padding: 6px 12px; min-height: 32px; font-size: 13px; }
    &.full  { width: 100%; }
  }
</style>
