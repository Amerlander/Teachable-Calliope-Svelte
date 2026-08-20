<script lang="ts" module>
  /**
   * Every open dialog, innermost last. Escape is answered by the topmost one
   * only, so a confirm opened from inside another dialog closes itself and
   * leaves its opener standing.
   */
  const stack: symbol[] = [];

  /**
   * Whether any dialog is open. For the window-level shortcuts of the page
   * underneath: while a dialog holds the screen, Escape belongs to it and not
   * to a selection or an inline edit somewhere behind it.
   */
  export function anyModalOpen(): boolean {
    return stack.length > 0;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Portal from 'svelte-portal';

  // `flush` hands the body over to the content: no padding and no scrolling of
  // its own, for dialogs that bring their own columns and scroll those.
  let {
    title = '',
    subtitle,
    isOpen = false,
    size = 'medium',
    flush = false,
    showCloseButton = true,
    onclose,
    children,
    actions
  }: {
    title?: string;
    subtitle?: Snippet;
    isOpen?: boolean;
    size?: 'small' | 'medium' | 'large' | 'fullscreen' | 'wide';
    flush?: boolean;
    showCloseButton?: boolean;
    onclose?: () => void;
    children?: Snippet;
    actions?: Snippet;
  } = $props();

  const id = Symbol('modal');
  let modalEl: HTMLElement | null = $state(null);

  function close() { onclose?.(); }
  function onBackdrop(e: MouseEvent) { if (e.target === e.currentTarget) close(); }

  // On the window rather than on the overlay: a keydown only bubbles through
  // the dialog while something inside it has the focus, and a click on the
  // backdrop or on a scroll bar is enough to lose that again.
  function onKey(e: KeyboardEvent) {
    if (!isOpen || e.key !== 'Escape') return;
    if (stack[stack.length - 1] !== id) return;
    close();
  }

  $effect(() => {
    if (!isOpen) return;
    stack.push(id);
    return () => {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  });

  // Arms the default action while the dialog is up, and hands the focus back
  // where it came from afterwards — otherwise Tab resumes at the top of the
  // page instead of next to the button the dialog was opened from.
  $effect(() => {
    if (!isOpen || !modalEl) return;
    const opener = document.activeElement as HTMLElement | null;
    focusInitial(modalEl);
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  });

  function focusInitial(root: HTMLElement) {
    // A body that brings its own `autofocus` wants the caret there — naming the
    // new project comes before the button that creates it.
    if (root.querySelector('[autofocus]')) return;
    // The dialog itself as the fallback, so Escape and a screen reader still
    // land inside it when there is nothing to arm.
    (defaultAction(root) ?? root).focus();
  }

  /**
   * The last enabled button of the footer. Every dialog in the app puts the
   * confirming action last and the way out before it, so this is the one a
   * press of Space or Enter should carry out.
   */
  function defaultAction(root: HTMLElement): HTMLElement | null {
    const buttons = root.querySelectorAll<HTMLElement>('.modal-footer button:not([disabled])');
    return buttons[buttons.length - 1] ?? null;
  }
</script>

<svelte:window onkeydown={onKey} />

<Portal>
  {#if isOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="overlay" onclick={onBackdrop}>
      <div
        bind:this={modalEl}
        class="modal size-{size}"
        role="dialog"
        aria-modal="true"
        aria-label={title || undefined}
        tabindex="-1"
      >
        <div class="modal-header">
          {#if title || subtitle}
            <div class="modal-titles">
              {#if title}<h2>{title}</h2>{/if}
              {#if subtitle}<div class="modal-subtitle">{@render subtitle()}</div>{/if}
            </div>
          {/if}
          {#if showCloseButton}
            <button class="close-btn ghost" onclick={close} aria-label="Schließen">&times;</button>
          {/if}
        </div>
        {#if children}
          <div class="modal-body" class:flush>{@render children()}</div>
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
    // Focused on open as a mechanism, not as an affordance: the ring belongs on
    // the button that is armed, never around the whole dialog.
    &:focus { outline: none; }
    &.size-small    { width: 90%; max-width: 400px; }
    &.size-medium   { width: 90%; max-width: 600px; }
    &.size-large    { width: 90%; max-width: 860px; }
    &.size-fullscreen { width: 95%; max-width: 1200px; height: 88vh; }
    // For dialogs whose content is columns rather than prose: a comparison of
    // several models has nothing to gain from a reading width.
    &.size-wide { width: 97%; max-width: none; height: 92vh; }
  }
  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 20px 24px 0;
    .modal-titles { min-width: 0; }
    .modal-subtitle {
      margin-top: 3px;
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
    }
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
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px;
    color: rgb(var(--md-on-surface));
    &.flush {
      padding: 16px 0 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
  }
  .modal-footer {
    padding: 16px 24px;
    border-top: 1px solid rgb(var(--md-outline-variant));
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    // The default action holds the keyboard from the moment the dialog opens, so
    // that has to be visible even when it was opened by mouse — which is
    // exactly the case `:focus-visible` leaves unmarked on a button.
    :global(button:focus) {
      outline: 3px solid hsl(var(--color-border-focus));
      outline-offset: 2px;
    }
  }
  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.92) translateY(-16px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
</style>
