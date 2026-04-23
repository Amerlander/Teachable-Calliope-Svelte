<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import {
    setMakecodeIframe,
    createMakeCodeIframeUrl,
    importFromState,
  } from '$lib/makecode';
  import { currentLang } from '$lib/stores/app';
  import { currentProject } from '$lib/stores/projects';
  import { classes } from '$lib/stores';

  let iframeEl: HTMLIFrameElement;
  const src = createMakeCodeIframeUrl(get(currentLang));

  onMount(() => {
    const p = get(currentProject);
    if (!p) {
      goto('/');
      return;
    }
    setMakecodeIframe(iframeEl);

    // If the user already has classes, queue their project so MakeCode opens
    // it instead of the blank seed. We set it here before the driver asks for
    // initialProjects — importFromState also keeps it available for re-sync.
    const cls = get(classes);
    if (cls && cls.length > 0) {
      importFromState({
        name: p.name || 'Teachable Project',
        mode: p.mode ?? 'image',
        classes: cls,
      });
    }

    return () => setMakecodeIframe(null);
  });
</script>

<div class="tryout-view">
  <div class="editor-panel panel">
    <iframe
      bind:this={iframeEl}
      title="MakeCode Calliope Editor"
      {src}
      allow="usb; bluetooth; autoplay;"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      style="width:100%;height:100%;border:0;border-radius:12px;"
      allowfullscreen
    ></iframe>
  </div>
</div>

<style lang="scss">
  .tryout-view {
    width: 100%;
    height: 100%;
    padding: 16px;
    padding-left: 16px;
  }
  .editor-panel {
    width: 100%;
    height: 100%;
    padding: 0;
    overflow: hidden;
  }
</style>
