<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { setMakecodeIframe, createMakeCodeIframeUrl, switchMakeCodeLang, type MakeCodeLang } from '$lib/makecode';
  import { currentLang } from '$lib/stores/app';

  let iframeEl: HTMLIFrameElement | null = null;
  const src = createMakeCodeIframeUrl(get(currentLang));

  let lang: MakeCodeLang = $state('blocks');

  onMount(() => {
    setMakecodeIframe(iframeEl);
    return () => setMakecodeIframe(null);
  });

  function pick(l: MakeCodeLang) {
    lang = l;
    void switchMakeCodeLang(l);
  }
</script>

<div class="right-panel makecode-editor-container">
  <div class="lang-toolbar">
    <button class:active={lang === 'blocks'} onclick={() => pick('blocks')}>Blöcke</button>
    <button class:active={lang === 'js'} onclick={() => pick('js')}>JavaScript</button>
    <button class:active={lang === 'python'} onclick={() => pick('python')}>Python</button>
  </div>
  <iframe
    bind:this={iframeEl}
    title="MakeCode editor"
    {src}
    allow="usb; bluetooth; autoplay;"
    style="width: 100%; flex: 1; border: none;"
  ></iframe>
</div>

<style lang="scss">
  .makecode-editor-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }
  .lang-toolbar {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    background: rgba(var(--md-surface-variant), 0.4);
    border-bottom: 1px solid rgba(var(--md-outline-variant), 0.5);
    flex: 0 0 auto;

    button {
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 6px;
      background: transparent;
      border: 1px solid transparent;
      color: rgb(var(--md-on-surface-variant));
      cursor: pointer;
      min-height: unset;
      box-shadow: none;
      transition: background 0.15s, color 0.15s;

      &:hover {
        background: rgba(var(--md-primary), 0.08);
      }
      &.active {
        background: rgb(var(--md-secondary-container));
        color: rgb(var(--md-on-secondary-container));
        font-weight: 600;
      }
    }
  }
</style>
