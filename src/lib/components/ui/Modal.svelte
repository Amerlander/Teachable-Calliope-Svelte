<script lang="ts">
  import type { Snippet } from 'svelte';
  import Portal from 'svelte-portal';

  let {
    title = '',
    isOpen = false,
    size = 'medium',
    showCloseButton = true,
    onclose,
    children,
    actions
  }: {
    title?: string;
    isOpen?: boolean;
    size?: 'small' | 'medium' | 'large' | 'fullscreen';
    showCloseButton?: boolean;
    onclose?: () => void;
    children?: Snippet;
    actions?: Snippet;
  } = $props();

  function close() { onclose?.(); }
  function onBackdrop(e: MouseEvent) { if (e.target === e.currentTarget) close(); }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
</script>

<Portal>
  {#if isOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="overlay" onclick={onBackdrop} onkeydown={onKey} role="dialog" tabindex="-1" aria-modal="true">
      <div class="modal size-{size}">
        <div class="modal-header">
          {#if title}<h2>{title}</h2>{/if}
          {#if showCloseButton}
            <button class="close-btn ghost" onclick={close} aria-label="Schließen">&times;</button>
          {/if}
        </div>
        {#if children}
          <div class="modal-body">{@render children()}</div>
        {/if}
        {#if actions}
          <div class="modal-footer">{@render actions()}</div>
        {/if}
      </div>
    </div>
  {/if}
</Portal>

<style lang="scss">
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
  }
  .modal {
    background: rgb(var(--md-surface));
    border-radius: var(--md-radius-xl);
    box-shadow: var(--md-elevation-3);
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    overflow: hidden;
    animation: modalIn 0.25s ease-out;
    &.size-small    { width: 90%; max-width: 400px; }
    &.size-medium   { width: 90%; max-width: 600px; }
    &.size-large    { width: 90%; max-width: 860px; }
    &.size-fullscreen { width: 95%; max-width: 1200px; }
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 0;
    h2 { margin: 0; font-size: 20px; font-weight: 600; color: rgb(var(--md-on-surface)); }
    .close-btn {
      background: transparent;
      border: none;
      font-size: 28px;
      line-height: 1;
      padding: 4px 8px;
      min-height: unset;
      box-shadow: none;
      color: rgb(var(--md-on-surface-variant));
      border-radius: 50%;
      width: 40px; height: 40px;
      &:hover { background: rgba(var(--md-surface-variant), 0.5); }
    }
  }
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    color: rgb(var(--md-on-surface));
  }
  .modal-footer {
    padding: 16px 24px;
    border-top: 1px solid rgb(var(--md-outline-variant));
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.92) translateY(-16px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
</style>
