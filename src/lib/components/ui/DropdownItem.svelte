<!-- DropdownItem.svelte - Reusable dropdown item component -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { closeAllDropdowns } from './Dropdown.svelte';
  
  let {
    onselected,
    onclick: onclickProp,
    disabled = false,
    selected = false,
    href,
    target,
    role = 'menuitem',
    ariaLabel,
    title,
    children,
    closeOnClick = true,
    ...restProps
  }: {
    onselected?: (event: MouseEvent) => void;
    onclick?: (event: MouseEvent) => void;
    disabled?: boolean;
    selected?: boolean;
    href?: string;
    target?: string;
    role?: string;
    ariaLabel?: string;
    title?: string;
    children?: Snippet;
    closeOnClick?: boolean;
  } = $props();

  // Determine if this should be a link or button
  let isLink = $derived(!!href);

  function handleClick(event: MouseEvent) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    
    // Close all dropdowns when item is clicked (unless disabled)
    if (closeOnClick) {
      closeAllDropdowns();
    }

    onclickProp?.(event);
    onselected?.(event);
  }
</script>

{#if isLink}
  <a
    {href}
    {target}
    {role}
    aria-label={ariaLabel}
    {title}
    class="dropdown-item"
    class:selected
    class:disabled
    onclick={handleClick}
    {...restProps}
  >
    {#if children}
        {@render children?.()}
    {:else}
        {title}
    {/if}
  </a>
{:else}
  <button
    onclick={handleClick}
    {disabled}
    {role}
    aria-label={ariaLabel}
    {title}
    class="dropdown-item"
    class:selected
    {...restProps}
  >
    {#if children}
        {@render children?.()}
    {:else}
        {title}
    {/if}
  </button>
{/if}

<style>
  /* Sizes are in px, not rem: this app sets the root font-size to 14px, so the
     campus stylesheet's rem values would render every menu 12.5% smaller here.
     The px values below are the campus metrics at its 16px root. */
  .dropdown-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 8px 16px;
    border: none;
    background: transparent;
    color: hsl(210, 4%, 11%); /* #1B1C1D dark text on white background */
    font-size: 14px;
    line-height: 1.5;
    white-space: nowrap;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease-in-out;
    font-family: 'Roboto', sans-serif;
    text-decoration: none;
  }

  .dropdown-item:hover:not(:disabled) {
    background: hsl(156, 12%, 92%); /* #E8EDEB light grey hover */
  }

  .dropdown-item.selected,
  .dropdown-item:disabled {
    background: hsl(190, 12%, 61%); /* #90A4A8 decent grey for active item */
    color: hsl(210, 4%, 11%); /* #1B1C1D */
    cursor: not-allowed;
  }
  .dropdown-item:focus-visible {
    outline: 2px solid hsl(181, 57%, 53%); /* Calliope brand cyan for focus */
    outline-offset: 2px;
  }

  /* Global styles for icons in dropdown items */
  .dropdown-item :global(svg) {
    flex-shrink: 0;
    margin-right: 8px;
    width: 16px;
    height: 16px;
    vertical-align: middle;
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .dropdown-item {
      padding: 10px 12px;
    }

    .dropdown-item :global(svg) {
      width: 14px;
      height: 14px;
      margin-right: 6px;
    }
  }
</style>
