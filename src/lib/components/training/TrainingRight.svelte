<script lang="ts">
  import { onMount } from 'svelte';
  import { initSharedCamera, loadMobilenetModel } from '$lib/machine';
  import { setVideoRef } from '$lib/stores';

  let webcamEl: HTMLVideoElement | null = null;
  let webcamTestEl: HTMLVideoElement | null = null;
  let statusText = 'Lädt Modell…';

  onMount(async () => {
    // register video refs in shared store and initialize camera with them
    setVideoRef('webcam', webcamEl);
    setVideoRef('webcamTest', webcamTestEl);
    await initSharedCamera({ webcam: webcamEl, webcamTest: webcamTestEl });
    // load mobilenet in background
    try { await loadMobilenetModel(); statusText = 'Bereit'; } catch (err) { console.error(err); statusText = 'Fehler beim Laden des Modells'; }
  });
</script>

<div class="right-panel">

    <div class="tab-content active">
      <div class="video-wrap">
        <video bind:this={webcamEl} autoplay playsinline>
          <track kind="captions">
        </video>
        <div class="overlay">
          <div class="status dark">{statusText}</div>
        </div>
      </div>
    </div>
</div>
