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
    &.small { padding: 6px 12px; min-height: 32px; font-size: 13px; }
    &.full  { width: 100%; }
  }
</style>
