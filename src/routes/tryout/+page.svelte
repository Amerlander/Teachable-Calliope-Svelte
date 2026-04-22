<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { setMakecodeIframe } from '$lib/makecode';
  import { currentLang } from '$lib/stores/app';
  import { currentProject } from '$lib/stores/projects';

  const lang = $derived($currentLang);

  let iframeEl: HTMLIFrameElement;

  onMount(() => {
    if (!get(currentProject)) {
      goto('/');
      return;
    }
    setMakecodeIframe(iframeEl);
    return () => setMakecodeIframe(null);
  });
</script>

<div class="tryout-view">
  <div class="editor-panel panel">
    <iframe
      bind:this={iframeEl}
      title="MakeCode Calliope Editor"
      src="https://makecode.calliope.cc/?controller=1&nocookiebanner=1&ws=browser#pub:_VjjUK8cH6JCw"
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
