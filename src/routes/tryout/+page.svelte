<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { Splitpanes, Pane } from 'svelte-splitpanes';
  import {
    setMakecodeIframe,
    createMakeCodeIframeUrl,
    importFromState,
    onMakeCodeDownload,
  } from '$lib/makecode';
  import { flashCalliope } from '$lib/stores/connection';
  import { currentLang } from '$lib/stores/app';
  import { currentProject } from '$lib/stores/projects';
  import { classes } from '$lib/stores';
  import TryoutCamera from '$lib/components/tryout/TryoutCamera.svelte';

  let iframeEl: HTMLIFrameElement;
  const src = createMakeCodeIframeUrl(get(currentLang));

  onMount(() => {
    const p = get(currentProject);
    if (!p) {
      goto('/');
      return;
    }
    setMakecodeIframe(iframeEl);

    const cls = get(classes);
    if (cls && cls.length > 0) {
      importFromState({
        name: p.name || 'Teachable Project',
        mode: p.mode ?? 'image',
        classes: cls,
      });
    }

    const unsubDownload = onMakeCodeDownload(({ name, hex }) => {
      void flashCalliope(hex, name || p.name || 'project');
    });

    return () => {
      unsubDownload();
      setMakecodeIframe(null);
    };
  });
</script>

<div class="tryout-view">
  {#if $currentProject}
    <Splitpanes theme="modern-theme">
      <Pane size={32} minSize={24} maxSize={60}>
        <div class="panel camera-panel">
          <TryoutCamera />
        </div>
      </Pane>
      <Pane size={68}>
        <div class="panel editor-panel">
          <iframe
            bind:this={iframeEl}
            title="MakeCode Calliope Editor"
            {src}
            allow="usb; bluetooth; autoplay;"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            style="width:100%;height:100%;border:0;"
            allowfullscreen
          ></iframe>
        </div>
      </Pane>
    </Splitpanes>
  {/if}
</div>

<style lang="scss">
  .tryout-view {
    width: 100%;
    height: 100%;
    padding: 16px;
    display: block;
  }
  .panel {
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 12px;
    background: #fff;
  }
  .camera-panel {
    padding: 0;
  }
  .editor-panel {
    padding: 0;
  }

  :global(.splitpanes.modern-theme) {
    background: transparent;
  }
  :global(.splitpanes.modern-theme .splitpanes__pane) {
    background: transparent;
    padding: 0 8px;
    &:first-child { padding-left: 0; }
    &:last-child  { padding-right: 0; }
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  :global(.splitpanes.modern-theme .splitpanes__splitter) {
    background: transparent;
    position: relative;
    width: 6px;
    margin: 0 -3px;
    z-index: 2;
    cursor: col-resize;
    &::before {
      content: '';
      position: absolute;
      inset: 0;
      margin: auto 2px;
      width: 2px;
      background: rgba(0, 0, 0, 0.15);
      border-radius: 2px;
      transition: background 0.15s;
    }
    &:hover::before {
      background: rgba(0, 0, 0, 0.35);
    }
  }
</style>
