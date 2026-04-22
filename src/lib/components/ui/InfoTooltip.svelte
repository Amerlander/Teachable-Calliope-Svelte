<script lang="ts">
  let { text }: { text: string } = $props();
  let open = $state(false);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<span
  class="info-tooltip"
  onmouseenter={() => (open = true)}
  onmouseleave={() => (open = false)}
  onfocus={() => (open = true)}
  onblur={() => (open = false)}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open = !open; } }}
  onclick={(e) => { e.stopPropagation(); open = !open; }}
  role="button"
  tabindex="0"
>
  <span class="icon">?</span>
  {#if open}
    <span class="bubble" role="tooltip">{text}</span>
  {/if}
</span>

<style lang="scss">
  .info-tooltip {
    position: relative;
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    cursor: help;
    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgb(var(--md-surface-variant));
      color: rgb(var(--md-on-surface-variant));
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
    }
    &:hover .icon,
    &:focus-within .icon {
      background: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
    }
  }
  .bubble {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translateX(-50%);
    background: rgb(var(--md-inverse-surface, 31 31 35));
    color: rgb(var(--md-inverse-on-surface, 245 245 247));
    padding: 8px 12px;
    border-radius: var(--md-radius-sm);
    font-size: 12px;
    font-weight: 400;
    line-height: 1.4;
    white-space: normal;
    width: 240px;
    z-index: 1000;
    box-shadow: var(--md-elevation-2);
    pointer-events: none;
    &::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 100%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: rgb(var(--md-inverse-surface, 31 31 35));
    }
  }
</style>
