<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { setMakecodeIframe, createMakeCodeIframeUrl } from '$lib/makecode';
  import { currentLang } from '$lib/stores/app';

  let iframeEl: HTMLIFrameElement | null = null;
  const src = createMakeCodeIframeUrl(get(currentLang));

  onMount(() => {
    setMakecodeIframe(iframeEl);
    return () => setMakecodeIframe(null);
  });
</script>

<div class="right-panel makecode-editor-container">
  <iframe
    bind:this={iframeEl}
    title="MakeCode editor"
    {src}
    allow="usb; bluetooth; autoplay;"
    style="width: 100%; height: 100%; border: none;"
  ></iframe>
</div>
