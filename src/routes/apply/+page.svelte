<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    classifierModel, mobilenetModel, classes,
    setVideoRef
  } from '$lib/stores';
  import { initSharedCamera } from '$lib/machine';
  import { selectedCameraId } from '$lib/stores/camera';
  import { currentLang, t, applyRunning, applyPrediction, btConnected, sendEveryPrediction, appMode } from '$lib/stores/app';
  import { showNotification } from '$lib/stores/notifications';
  import ModelLoaderPanel from '$lib/components/apply/ModelLoaderPanel.svelte';
  import CameraSelect from '$lib/components/CameraSelect.svelte';

  const lang = $derived($currentLang);

  let webcamEl: HTMLVideoElement = $state()!;
  let predInterval: ReturnType<typeof setInterval> | null = null;
  let poseCanvas: HTMLCanvasElement = $state()!;
  let showPoseLayers = $state({ classes: true, detection: false, angles: false, distances: false, coords: false });

  onMount(async () => {
    setVideoRef('webcam', webcamEl);
    await initSharedCamera({ webcam: webcamEl }, get(selectedCameraId) ?? undefined);
    startPrediction();
  });

  onDestroy(() => { stopPrediction(); });

  async function startPrediction() {
    applyRunning.set(true);
    predInterval = setInterval(async () => {
      const model = get(classifierModel);
      const mn = get(mobilenetModel);
      if (!model || !mn || !webcamEl) return;
      try {
        const tf = await import('@tensorflow/tfjs');
        const img = tf.browser.fromPixels(webcamEl)
          .toFloat().div(127.5).sub(1)
          .resizeBilinear([224, 224]).expandDims(0);
        const emb = mn.infer(img, true) as any;
        const preds = model.predict(emb) as any;
        const arr: number[] = await preds.data();
        img.dispose(); emb.dispose(); preds.dispose();
        const clsList = get(classes);
        const topIdx = arr.indexOf(Math.max(...arr));
        const result = { label: clsList[topIdx] || '?', confidence: arr[topIdx] };
        applyPrediction.set(result);
      } catch { /* ignore */ }
    }, 150);
  }

  function stopPrediction() {
    applyRunning.set(false);
    if (predInterval) { clearInterval(predInterval); predInterval = null; }
  }

  function toggleLayer(layer: keyof typeof showPoseLayers) {
    showPoseLayers = { ...showPoseLayers, [layer]: !showPoseLayers[layer] };
  }
</script>

<div class="apply-view">
  <div class="camera-row"><CameraSelect /></div>
  <div class="video-wrap">
    <video bind:this={webcamEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>

    <!-- Pose overlay canvas (hidden unless pose mode) -->
    {#if $appMode === 'pose'}
      <canvas bind:this={poseCanvas} class="pose-overlay"></canvas>
    {/if}

    <!-- Prediction display -->
    {#if $applyPrediction && $applyPrediction.confidence > 0.5}
      <div class="prediction-display">
        <span class="pred-label">{$applyPrediction.label}</span>
        <span class="pred-conf">{Math.round($applyPrediction.confidence * 100)}%</span>
        <div class="bar-bg">
          <div class="bar-fill" style="width:{$applyPrediction.confidence * 100}%"></div>
        </div>
      </div>
    {/if}

    <!-- Pose layer toggle buttons (pose mode only) -->
    {#if $appMode === 'pose'}
      <div class="pose-layer-buttons">
        {#each Object.entries(showPoseLayers) as [layer, active]}
          <button
            class="pose-layer-btn"
            class:active
            onclick={() => toggleLayer(layer as keyof typeof showPoseLayers)}
          >
            {t(`apply.layer${layer.charAt(0).toUpperCase() + layer.slice(1)}`, lang)}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <ModelLoaderPanel />
</div>

<style lang="scss">
  .apply-view {
    width: 100%;
    height: 100%;
    padding: 16px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .camera-row {
    max-width: 320px;
  }
  .video-wrap {
    width: 100%;
    flex: 1;
    position: relative;
    border-radius: var(--md-radius-lg);
    overflow: hidden;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--md-elevation-2);
    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }
  }
  .pose-overlay {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 3;
    transform: scaleX(-1);
  }
  .prediction-display {
    position: absolute;
    top: 24px;
    left: 24px;
    background: rgba(var(--md-surface), 0.95);
    color: rgb(var(--md-on-surface));
    padding: 14px 20px;
    border-radius: var(--md-radius-md);
    z-index: 9999;
    box-shadow: var(--md-elevation-3);
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 140px;
    .pred-label { font-size: 20px; font-weight: 700; }
    .pred-conf  { font-size: 14px; color: rgb(var(--md-on-surface-variant)); }
    .bar-bg { height: 8px; background: rgb(var(--md-surface-variant)); border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; background: rgb(var(--md-primary)); border-radius: 4px; transition: width 0.3s; }
  }
  .pose-layer-buttons {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 12;
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    border-radius: 22px;
    padding: 4px 6px;
  }
  .pose-layer-btn {
    background: transparent;
    color: rgba(255, 255, 255, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 18px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: none;
    min-height: unset;
    transition: all 0.2s;
    &:hover { color: #fff; background: rgba(255, 255, 255, 0.15); }
    &.active { background: rgba(255, 255, 255, 0.25); color: #fff; border-color: rgba(255, 255, 255, 0.4); }
  }
</style>
