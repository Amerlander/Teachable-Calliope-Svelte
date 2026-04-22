<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { classes, classifierModel, mobilenetModel, setVideoRef } from '$lib/stores';
  import { initSharedCamera, loadMobilenetModel } from '$lib/machine';
  import { selectedCameraId } from '$lib/stores/camera';
  import { currentLang, t, isTesting } from '$lib/stores/app';
  import CameraSelect from '$lib/components/CameraSelect.svelte';

  const lang = $derived($currentLang);

  let webcamEl: HTMLVideoElement = $state()!;
  let webcamTestEl: HTMLVideoElement = $state()!;
  let statusText = $state('Lädt…');
  let activeTab = $state<'train' | 'test'>('train');
  let testRunning = $state(false);
  let prediction = $state<{ label: string; confidence: number } | null>(null);
  let predInterval: ReturnType<typeof setInterval> | null = null;

  onMount(async () => {
    setVideoRef('webcam', webcamEl);
    setVideoRef('webcamTest', webcamTestEl);
    await initSharedCamera({ webcam: webcamEl, webcamTest: webcamTestEl }, get(selectedCameraId) ?? undefined);
    try {
      await loadMobilenetModel();
      statusText = 'Bereit';
    } catch {
      statusText = 'Fehler beim Laden des Modells';
    }
  });

  onDestroy(() => {
    stopTest();
  });

  function switchTab(tab: 'train' | 'test') {
    activeTab = tab;
    if (tab !== 'test') stopTest();
  }

  async function toggleTest() {
    if (testRunning) {
      stopTest();
      return;
    }
    const model = get(classifierModel);
    if (!model) {
      statusText = 'Bitte erst trainieren';
      return;
    }
    testRunning = true;
    isTesting.set(true);
    prediction = null;
    predInterval = setInterval(async () => {
      const vid = webcamTestEl;
      if (!vid || !get(classifierModel)) return;
      try {
        const mn = get(mobilenetModel);
        if (!mn) return;
        const tf = await import('@tensorflow/tfjs');
        const img = tf.browser.fromPixels(vid)
          .toFloat().div(127.5).sub(1)
          .resizeBilinear([224, 224]).expandDims(0);
        const emb = mn.infer(img, true) as any;
        const preds = get(classifierModel).predict(emb) as any;
        const arr: number[] = await preds.data();
        img.dispose(); emb.dispose(); preds.dispose();
        const clsList = get(classes);
        const topIdx = arr.indexOf(Math.max(...arr));
        prediction = { label: clsList[topIdx] || '?', confidence: arr[topIdx] };
      } catch {
        /* ignore */
      }
    }, 150);
  }

  function stopTest() {
    testRunning = false;
    isTesting.set(false);
    if (predInterval) { clearInterval(predInterval); predInterval = null; }
    prediction = null;
  }
</script>

<div class="right-panel">
  <CameraSelect />

  <!-- Tabs -->
  <div class="tab-bar">
    <button class="tab" class:active={activeTab === 'train'} onclick={() => switchTab('train')}>Aufnahme</button>
    <button class="tab" class:active={activeTab === 'test'} onclick={() => switchTab('test')}>Test</button>
  </div>

  <!-- Train tab -->
  {#if activeTab === 'train'}
    <div class="video-wrap">
      <video bind:this={webcamEl} autoplay playsinline muted>
        <track kind="captions" />
      </video>
      <div class="overlay">
        <div class="status">{statusText}</div>
      </div>
    </div>
  {/if}

  <!-- Test tab -->
  {#if activeTab === 'test'}
    <div class="video-wrap">
      <video bind:this={webcamTestEl} autoplay playsinline muted>
        <track kind="captions" />
      </video>
      <div class="overlay">
        <button class="ghost" onclick={toggleTest}>
          {testRunning ? t('training.stopCapture', lang) : t('training.testButton', lang)}
        </button>
        {#if !testRunning}
          <div class="status" style="color:#adf54c;font-size:12px;">{t('training.testHint', lang)}</div>
        {/if}
      </div>

      {#if prediction}
        <div class="prediction-display">
          <strong>{prediction.label}</strong>
          <span>{Math.round(prediction.confidence * 100)}%</span>
          <div class="bar-bg">
            <div class="bar-fill" style="width:{prediction.confidence * 100}%"></div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  .right-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .tab-bar {
    display: flex;
    gap: 4px;
    background: rgba(var(--md-surface-variant), 0.3);
    padding: 4px;
    border-radius: var(--md-radius-md);
  }
  .tab {
    flex: 1;
    padding: 8px 16px;
    border: none;
    background: transparent;
    border-radius: var(--md-radius-sm);
    font-size: 14px;
    font-weight: 500;
    color: rgb(var(--md-on-surface-variant));
    cursor: pointer;
    box-shadow: none;
    min-height: unset;
    transition: all 0.2s;
    &:hover { background: rgba(var(--md-primary), 0.08); }
    &.active {
      background: rgb(var(--md-secondary-container));
      color: rgb(var(--md-on-secondary-container));
      font-weight: 600;
    }
  }
  .video-wrap {
    flex: 1;
    position: relative;
    border-radius: var(--md-radius-lg);
    overflow: hidden;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--md-elevation-2);
    min-height: 0;
    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }
  }
  .overlay {
    position: absolute;
    right: 16px;
    top: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 2;
    button, .status {
      background: rgba(var(--md-surface), 0.9);
      color: rgb(var(--md-on-surface));
      backdrop-filter: blur(10px);
    }
  }
  .prediction-display {
    position: absolute;
    left: 16px;
    top: 16px;
    background: rgba(var(--md-surface), 0.95);
    color: rgb(var(--md-on-surface));
    padding: 12px 20px;
    border-radius: var(--md-radius-md);
    font-size: 18px;
    font-weight: 600;
    z-index: 3;
    box-shadow: var(--md-elevation-3);
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 140px;
    .bar-bg {
      height: 8px;
      background: rgb(var(--md-surface-variant));
      border-radius: 4px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: rgb(var(--md-primary));
      border-radius: 4px;
      transition: width 0.3s;
    }
  }
</style>
