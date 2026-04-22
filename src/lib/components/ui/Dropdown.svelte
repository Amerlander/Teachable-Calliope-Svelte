<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import Portal from 'svelte-portal';

  let {
    isOpen = $bindable(false),
    trigger,
    children,
    placement = 'bottom-end',
    minWidth = '180px',
    closeOnClick = true
  }: {
    isOpen?: boolean;
    trigger: Snippet;
    children: Snippet;
    placement?: string;
    minWidth?: string;
    closeOnClick?: boolean;
  } = $props();

  let triggerEl: HTMLElement = $state()!;
  let menuEl: HTMLElement = $state()!;
  let menuStyle = $state('');

  function toggle(e: Event) {
    e.stopPropagation();
    isOpen = !isOpen;
    if (isOpen) tick_position();
  }

  function close() { isOpen = false; }

  function onMenuClick() { if (closeOnClick) close(); }

  function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') close(); }

  function tick_position() {
    // position after DOM update
    requestAnimationFrame(() => {
      if (!triggerEl || !menuEl) return;
      const rect = triggerEl.getBoundingClientRect();
      const mw = menuEl.getBoundingClientRect().width || 0;
      let left = rect.right - mw;
      let top = rect.bottom + 8;
      if (left < 8) left = 8;
      menuStyle = `position:fixed;top:${top}px;left:${left}px;min-width:${minWidth};z-index:100000001;`;
    });
  }

  function onDocClick(e: MouseEvent) {
    if (!isOpen) return;
    const target = e.target as Node;
    if (!menuEl?.contains(target) && !triggerEl?.contains(target)) close();
  }

  onMount(() => {
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  });
</script>

<div class="dropdown-wrap" bind:this={triggerEl}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div role="button" tabindex="0"
    onclick={toggle}
    onkeydown={(e) => e.key === 'Enter' && toggle(e)}
  >
    {@render trigger()}
  </div>
</div>

{#if isOpen}
  <Portal>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={menuEl}
      class="dropdown-menu"
      style={menuStyle}
      role="menu"
      tabindex="-1"
      onclick={onMenuClick}
      onkeydown={onKeyDown}
    >
      {@render children()}
    </div>
  </Portal>
{/if}

<style lang="scss">
  .dropdown-wrap { position: relative; display: inline-block; }
  .dropdown-menu {
    background: #fff;
    border-radius: var(--md-radius-md);
    box-shadow: var(--md-elevation-3);
    overflow: hidden;
    animation: menuSlideIn 0.15s ease-out;
  }
</style>
