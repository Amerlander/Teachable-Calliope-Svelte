<script lang="ts">
  import { onMount } from 'svelte';
  import { setMakecodeIframe } from '$lib/makecode';

  let iframeEl: HTMLIFrameElement | null = null;

  onMount(() => {
    setMakecodeIframe(iframeEl);
    return () => setMakecodeIframe(null);
  });
</script>

<div class="right-panel makecode-editor-container">
<iframe
        bind:this={iframeEl}
        title="MakeCode editor"
        src={`https://makecode.calliope.cc/?hidemenu=1&controller=1&lang=de#editor`}
        allow="usb; bluetooth; autoplay; "
        style="width: 100%; height: 100%; border: none;"
    ></iframe>

</div>

