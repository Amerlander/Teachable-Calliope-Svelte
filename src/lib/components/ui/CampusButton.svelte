<!--
  Copied from calliope-campus (src/lib/components/ui/Button.svelte) so the two
  apps share one button look: pill shape, 4px border, uppercase label. Kept
  API-identical to the campus original so changes there can be diffed straight
  in; the only style additions are `font-family: inherit` (the campus gets its
  font from a global form-control rule this app has no equivalent of) and a
  focus ring. Needs the --color-* HSL tokens in $lib/styles/tokens.scss.

  Deliberately separate from ui/Button.svelte, which is the older --md-* styled
  button still used by the training panels.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'primary',
    type = 'default',
    size = 'medium',
    disabled = false,
    fullWidth = false,
    title,
    onclick,
    children,
    ...restProps
  }: {
    variant?: 'primary' | 'secondary' | 'tertiary';
    type?: 'default' | 'positive' | 'negative' | 'inverse';
    size?: 'small' | 'medium' | 'large';
    disabled?: boolean;
    fullWidth?: boolean;
    title?: string;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();

  function handleClick(event: MouseEvent) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  }
</script>

<button
  class="btn"
  class:btn-primary={variant === 'primary'}
  class:btn-secondary={variant === 'secondary'}
  class:btn-tertiary={variant === 'tertiary'}
  class:btn-default={type === 'default'}
  class:btn-positive={type === 'positive'}
  class:btn-negative={type === 'negative'}
  class:btn-inverse={type === 'inverse'}
  class:btn-small={size === 'small'}
  class:btn-medium={size === 'medium'}
  class:btn-large={size === 'large'}
  class:btn-full-width={fullWidth}
  class:disabled
  onclick={handleClick}
  {disabled}
  {title}
  {...restProps}
>
  {#if children}
    {@render children()}
  {/if}
</button>

<style>
  /* Base button styles - always pill design with 4px border */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
    font-weight: 600;
    border: 4px solid;
    border-radius: 9999px; /* Pill design */
    cursor: pointer;
    transition: all 0.2s ease;
    text-decoration: none;
    outline: none;
    gap: 0.5rem;
    text-transform: uppercase;
    text-align: center;
    width: max-content;
    max-width: 100%;

    /* Default color mapping */
    --btn-dark: var(--color-neutral-100);
    --btn-light: var(--color-neutral-0);
    --btn-light-hover: var(--color-neutral-10);
    --btn-dark-hover: var(--color-neutral-50);
  }

  /* Inverse type - swap light and dark colors */
  .btn-inverse {
    --btn-dark: var(--color-neutral-0);
    --btn-light: var(--color-neutral-100);
    --btn-light-hover: var(--color-neutral-50);
    --btn-dark-hover: var(--color-neutral-10);
  }

  /* Size variants */
  .btn-small {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    line-height: 1.2;
  }

  .btn-medium {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    line-height: 1.3;
  }

  .btn-large {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    line-height: 1.4;
  }

  .btn-full-width {
    width: 100%;
  }

  /* Default type (uses btn-dark and btn-light variables) */
  /* Primary variant */
  .btn-primary.btn-default,
  .btn-primary.btn-inverse {
    background-color: hsl(var(--btn-dark));
    border-color: hsl(var(--btn-dark));
    color: hsl(var(--btn-light));
  }

  .btn-primary.btn-default:hover:not(.disabled),
  .btn-primary.btn-inverse:hover:not(.disabled) {
    background-color: hsl(var(--btn-dark-hover));
    border-color: hsl(var(--btn-dark-hover));
  }

  /* Secondary variant */
  .btn-secondary.btn-default,
  .btn-secondary.btn-inverse {
    background-color: transparent;
    border-color: hsl(var(--btn-dark));
    color: hsl(var(--btn-dark));
  }

  .btn-secondary.btn-default:hover:not(.disabled),
  .btn-secondary.btn-inverse:hover:not(.disabled) {
    background-color: hsl(var(--btn-dark));
    color: hsl(var(--btn-light));
  }

  /* Tertiary variant */
  .btn-tertiary.btn-default,
  .btn-tertiary.btn-inverse {
    background-color: transparent;
    border-color: transparent;
    color: hsl(var(--btn-dark));
  }

  .btn-tertiary.btn-default:hover:not(.disabled),
  .btn-tertiary.btn-inverse:hover:not(.disabled) {
    background-color: hsl(var(--btn-light-hover));
  }

  /* Positive type (green coloring) */
  /* Primary variant */
  .btn-primary.btn-positive {
    background-color: hsl(var(--color-green-100)); /* #98F600 */
    border-color: hsl(var(--color-green-100));
    color: hsl(var(--color-neutral-100)); /* Black text */
  }

  .btn-primary.btn-positive:hover:not(.disabled) {
    background-color: hsl(var(--color-green-50)); /* Lighter on hover */
    border-color: hsl(var(--color-green-50));
  }

  /* Secondary variant */
  .btn-secondary.btn-positive {
    background-color: transparent;
    border-color: hsl(var(--color-green-100)); /* #98F600 */
    color: hsl(var(--color-green-100));
  }

  .btn-secondary.btn-positive:hover:not(.disabled) {
    background-color: hsl(var(--color-green-100)); /* Fill on hover */
    color: hsl(var(--color-neutral-100)); /* Black text */
  }

  /* Tertiary variant */
  .btn-tertiary.btn-positive {
    background-color: transparent;
    border-color: transparent;
    color: hsl(var(--color-green-100)); /* #98F600 */
  }

  .btn-tertiary.btn-positive:hover:not(.disabled) {
    background-color: hsl(var(--color-green-100)); /* Fill on hover */
    color: hsl(var(--color-neutral-100)); /* Black text */
  }

  /* Negative type (red coloring) */
  /* Primary variant */
  .btn-primary.btn-negative {
    background-color: hsl(var(--color-red-100)); /* #E53F4B */
    border-color: hsl(var(--color-red-100));
    color: hsl(var(--color-neutral-0)); /* White text */
  }

  .btn-primary.btn-negative:hover:not(.disabled) {
    background-color: hsl(var(--color-red-50)); /* Lighter on hover */
    border-color: hsl(var(--color-red-50));
  }

  /* Secondary variant */
  .btn-secondary.btn-negative {
    background-color: transparent;
    border-color: hsl(var(--color-red-100)); /* #E53F4B */
    color: hsl(var(--color-red-100));
  }

  .btn-secondary.btn-negative:hover:not(.disabled) {
    background-color: hsl(var(--color-red-100)); /* Fill on hover */
    color: hsl(var(--color-neutral-0)); /* White text */
  }

  /* Tertiary variant */
  .btn-tertiary.btn-negative {
    background-color: transparent;
    border-color: transparent;
    color: hsl(var(--color-red-100)); /* #E53F4B */
  }

  .btn-tertiary.btn-negative:hover:not(.disabled) {
    background-color: hsl(var(--color-red-100)); /* Fill on hover */
    color: hsl(var(--color-neutral-0)); /* White text */
  }

  /* Disabled state - reduce opacity */
  .btn.disabled,
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
  }

  .btn.disabled:hover,
  .btn:disabled:hover {
    transform: none !important;
    opacity: 0.5 !important;
  }

  .btn:focus-visible {
    outline: 3px solid hsl(var(--color-border-focus));
    outline-offset: 2px;
  }
</style>
