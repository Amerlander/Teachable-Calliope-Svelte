<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { classes, classifierModel, setVideoRef } from '$lib/stores';
  import { initSharedCamera, predictFromVideo } from '$lib/machine';
  import { selectedCameraId } from '$lib/stores/camera';
  import { currentLang, t, isTesting, workspaceTab } from '$lib/stores/app';
  import CameraSelect from '$lib/components/CameraSelect.svelte';

  const lang = $derived($currentLang);

  let webcamEl: HTMLVideoElement = $state()!;
  let webcamTestEl: HTMLVideoElement = $state()!;
  let cameraReady = $state(false);
  let prediction = $state<{ label: string; confidence: number; all: number[] } | null>(null);
  let predInterval: ReturnType<typeof setInterval> | null = null;
  let lastTickAt = 0;
  let fps = $state(0);

  // Mode is derived from sidebar tab: classes → capture, model → test.
  const mode = $derived<'train' | 'test'>($workspaceTab === 'model' ? 'test' : 'train');

  onMount(async () => {
    setVideoRef('webcam', webcamEl);
    setVideoRef('webcamTest', webcamTestEl);
    await initSharedCamera({ webcam: webcamEl, webcamTest: webcamTestEl }, get(selectedCameraId) ?? undefined);
    cameraReady = true;
  });

  onDestroy(() => {
    stopTest();
  });

  // Auto-start/stop the test loop whenever mode or classifier availability changes.
  $effect(() => {
    const m = mode;
    const hasModel = !!$classifierModel;
    if (m === 'test' && hasModel) {
      startTest();
    } else {
      stopTest();
    }
  });

  function startTest() {
    if (predInterval) return;
    isTesting.set(true);
    prediction = null;
    fps = 0;
    lastTickAt = 0;
    predInterval = setInterval(async () => {
      const vid = webcamTestEl;
      if (!vid || !get(classifierModel)) return;
      try {
        const res = await predictFromVideo(vid);
        if (!res) return;
        const now = performance.now();
        if (lastTickAt) {
          const dt = now - lastTickAt;
          fps = dt > 0 ? Math.round((1000 / dt) * 10) / 10 : 0;
        }
        lastTickAt = now;
        prediction = { label: res.className, confidence: res.probability, all: res.allProbs ?? [] };
      } catch {
        /* ignore */
      }
    }, 150);
  }

  function stopTest() {
    isTesting.set(false);
    if (predInterval) { clearInterval(predInterval); predInterval = null; }
    prediction = null;
    fps = 0;
    lastTickAt = 0;
  }
</script>

<div class="right-panel">
  <!-- Top bar: mode indicator + camera select (above the video) -->
  <div class="top-bar">
    <div class="mode-indicator" class:test={mode === 'test'}>
      <span class="dot"></span>
      <span class="label">{mode === 'test' ? 'Test' : 'Aufnahme'}</span>
      <span class="hint">
        {mode === 'test'
          ? (!$classifierModel ? 'Kein Modell – bitte erst trainieren' : 'Live-Vorhersage aktiv')
          : 'Bild wird zur aktiven Klasse aufgenommen'}
      </span>
    </div>
    <CameraSelect />
  </div>

  <!-- Train view -->
  <div class="video-wrap" class:hidden={mode !== 'train'}>
    <video bind:this={webcamEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>

    {#if !cameraReady}
      <div class="loading-overlay">
        <span class="spinner"></span>
        <span>Kamera wird geladen…</span>
      </div>
    {/if}
  </div>

  <!-- Test view -->
  <div class="video-wrap" class:hidden={mode !== 'test'}>
    <video bind:this={webcamTestEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>

    {#if !cameraReady}
      <div class="loading-overlay">
        <span class="spinner"></span>
        <span>Kamera wird geladen…</span>
      </div>
    {/if}

    {#if prediction}
      <div class="prediction-display">
        <div class="pred-head">
          <strong>{prediction.label}</strong>
          <span class="pct">{Math.round(prediction.confidence * 100)}%</span>
        </div>
        <div class="bar-bg">
          <div class="bar-fill" style="width:{prediction.confidence * 100}%"></div>
        </div>
      </div>

      <!-- Verbose: all class scores + FPS -->
      <div class="details">
        <div class="details-head">
          <span>Alle Klassen</span>
          <span class="fps">{fps ? `${fps} Hz` : '…'}</span>
        </div>
        <ul class="score-list">
          {#each $classes as cls, i (cls)}
            {@const p = prediction.all[i] ?? 0}
            <li class:top={i === $classes.indexOf(prediction.label)}>
              <span class="name">{cls}</span>
              <span class="sub">
                <span class="sub-bar"><span class="sub-fill" style="width:{p * 100}%"></span></span>
                <span class="sub-pct">{Math.round(p * 100)}%</span>
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if mode === 'test' && !$classifierModel}
      <div class="overlay">
        <div class="status warning">{t('training.testStatus', lang)}</div>
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .right-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .mode-indicator {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-radius: var(--md-radius-md);
    background: rgba(var(--md-surface-variant), 0.5);
    font-size: 13px;
    color: rgb(var(--md-on-surface-variant));
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: rgb(var(--md-primary));
      box-shadow: 0 0 0 3px rgba(var(--md-primary), 0.2);
    }
    .label {
      font-weight: 600;
      color: rgb(var(--md-on-surface));
      letter-spacing: 0.3px;
    }
    .hint {
      color: rgb(var(--md-on-surface-variant));
      font-size: 12px;
    }
    &.test .dot {
      background: #adf54c;
      box-shadow: 0 0 0 3px rgba(173, 245, 76, 0.25);
      animation: pulse 1.4s ease-in-out infinite;
    }
  }
  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 14px;
    z-index: 4;
    backdrop-filter: blur(4px);
  }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 3px rgba(173, 245, 76, 0.25); }
    50%      { box-shadow: 0 0 0 6px rgba(173, 245, 76, 0.08); }
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
    &.hidden { display: none; }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
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
    .status {
      background: rgba(var(--md-surface), 0.9);
      color: rgb(var(--md-on-surface));
      backdrop-filter: blur(10px);
      padding: 6px 12px;
      border-radius: var(--md-radius-sm);
      font-size: 12px;
      &.warning { color: #c77a00; }
    }
  }
  .prediction-display {
    position: absolute;
    left: 16px;
    top: 16px;
    background: rgba(var(--md-surface), 0.95);
    color: rgb(var(--md-on-surface));
    padding: 12px 18px;
    border-radius: var(--md-radius-md);
    z-index: 3;
    box-shadow: var(--md-elevation-3);
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 180px;
    .pred-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      strong { font-size: 18px; font-weight: 700; }
      .pct { font-size: 14px; color: rgb(var(--md-on-surface-variant)); }
    }
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
      transition: width 0.2s;
    }
  }
  .details {
    position: absolute;
    right: 16px;
    top: 16px;
    background: rgba(var(--md-surface), 0.95);
    color: rgb(var(--md-on-surface));
    padding: 10px 14px;
    border-radius: var(--md-radius-md);
    z-index: 3;
    box-shadow: var(--md-elevation-2);
    backdrop-filter: blur(10px);
    min-width: 220px;
    max-height: 60%;
    overflow: auto;
    .details-head {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      margin-bottom: 8px;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      .fps {
        font-variant-numeric: tabular-nums;
        color: #adf54c;
      }
    }
    .score-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      li {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 12px;
        .name { font-weight: 500; }
        .sub {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sub-bar {
          flex: 1;
          height: 5px;
          background: rgb(var(--md-surface-variant));
          border-radius: 3px;
          overflow: hidden;
        }
        .sub-fill {
          display: block;
          height: 100%;
          background: rgb(var(--md-outline));
          border-radius: 3px;
          transition: width 0.2s;
        }
        .sub-pct {
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: rgb(var(--md-on-surface-variant));
          width: 36px;
          text-align: right;
        }
        &.top {
          .name { color: rgb(var(--md-primary)); font-weight: 700; }
          .sub-fill { background: rgb(var(--md-primary)); }
        }
      }
    }
  }
</style>
