<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { classes, classifierModel, examples, setVideoRef } from '$lib/stores';
  import { initSharedCamera, predictFromVideo } from '$lib/machine';
  import { selectedCameraId } from '$lib/stores/camera';
  import {
    currentLang,
    t,
    isTesting,
    isTraining,
    workspaceTab,
    modelTabView,
    draftRoi,
    type Roi
  } from '$lib/stores/app';
  import CameraSelect from '$lib/components/CameraSelect.svelte';
  import { currentProject, setClassThreshold } from '$lib/stores/projects';

  const lang = $derived($currentLang);

  let webcamEl: HTMLVideoElement = $state()!;
  let webcamTestEl: HTMLVideoElement = $state()!;
  let webcamPrepEl: HTMLVideoElement = $state()!;
  let webcamBgEl: HTMLVideoElement = $state()!;
  let webcamTestBgEl: HTMLVideoElement = $state()!;
  let webcamPrepBgEl: HTMLVideoElement = $state()!;
  let cameraReady = $state(false);

  const thresholds = $derived($currentProject?.classThresholds ?? {});
  const topLabel = $derived.by(() => {
    if (!prediction) return null;
    const t = thresholds[prediction.label] ?? 0;
    return prediction.confidence >= t ? prediction.label : null;
  });
  let prediction = $state<{ label: string; confidence: number; all: number[] } | null>(null);
  let predInterval: ReturnType<typeof setInterval> | null = null;
  let lastTickAt = 0;
  let fps = $state(0);

  // Mode: classes tab = train; model tab + new-training = prep; model tab + model = test.
  const mode = $derived<'train' | 'test' | 'prep'>(
    $workspaceTab !== 'model'
      ? 'train'
      : $modelTabView === 'new' && !$isTraining
        ? 'prep'
        : 'test'
  );

  onMount(async () => {
    setVideoRef('webcam', webcamEl);
    setVideoRef('webcamTest', webcamTestEl);
    const stream = await initSharedCamera({ webcam: webcamEl, webcamTest: webcamTestEl }, get(selectedCameraId) ?? undefined);
    if (stream) {
      for (const el of [webcamBgEl, webcamTestBgEl, webcamPrepEl, webcamPrepBgEl]) {
        if (!el) continue;
        el.srcObject = stream;
        el.onloadedmetadata = () => el.play().catch(() => {});
      }
    }
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

  // ---------- ROI editor (prep mode) ----------
  const DEFAULT_ROI: Roi = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };
  let roi = $state<Roi>({ ...($draftRoi ?? DEFAULT_ROI) });
  let roiContainer: HTMLDivElement | null = $state(null);

  $effect(() => {
    draftRoi.set(roi);
  });

  type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  let drag: null | {
    mode: DragMode;
    startX: number;
    startY: number;
    startRoi: Roi;
  } = null;

  function clamp(v: number, lo = 0, hi = 1) {
    return Math.max(lo, Math.min(hi, v));
  }

  function normPointer(e: PointerEvent) {
    const rect = roiContainer!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height)
    };
  }

  function onPointerDown(mode: DragMode, e: PointerEvent) {
    e.stopPropagation();
    if (!roiContainer) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = normPointer(e);
    drag = { mode, startX: p.x, startY: p.y, startRoi: { ...roi } };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || !roiContainer) return;
    const p = normPointer(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const min = 0.05;
    const r = { ...drag.startRoi };
    switch (drag.mode) {
      case 'move': {
        r.x = clamp(drag.startRoi.x + dx, 0, 1 - drag.startRoi.w);
        r.y = clamp(drag.startRoi.y + dy, 0, 1 - drag.startRoi.h);
        break;
      }
      case 'n':
      case 'ne':
      case 'nw': {
        const newY = clamp(drag.startRoi.y + dy, 0, drag.startRoi.y + drag.startRoi.h - min);
        r.h = drag.startRoi.h + (drag.startRoi.y - newY);
        r.y = newY;
        break;
      }
      case 's':
      case 'se':
      case 'sw': {
        r.h = clamp(drag.startRoi.h + dy, min, 1 - drag.startRoi.y);
        break;
      }
    }
    switch (drag.mode) {
      case 'w':
      case 'nw':
      case 'sw': {
        const newX = clamp(drag.startRoi.x + dx, 0, drag.startRoi.x + drag.startRoi.w - min);
        r.w = drag.startRoi.w + (drag.startRoi.x - newX);
        r.x = newX;
        break;
      }
      case 'e':
      case 'ne':
      case 'se': {
        r.w = clamp(drag.startRoi.w + dx, min, 1 - drag.startRoi.x);
        break;
      }
    }
    roi = r;
  }

  function onPointerUp(e: PointerEvent) {
    if (drag) {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      drag = null;
    }
  }

  function resetRoi() {
    roi = { ...DEFAULT_ROI };
  }

  function fullRoi() {
    roi = { x: 0, y: 0, w: 1, h: 1 };
  }
</script>

<div class="right-panel">
  <!-- Top bar: mode indicator + camera select (above the video) -->
  <div class="top-bar">
    <div class="mode-indicator" class:test={mode === 'test'} class:prep={mode === 'prep'}>
      <span class="dot"></span>
      <span class="label">
        {mode === 'test' ? 'Test' : mode === 'prep' ? 'Vorbereitung' : 'Aufnahme'}
      </span>
      <span class="hint">
        {#if mode === 'test'}
          {!$classifierModel ? 'Kein Modell – bitte erst trainieren' : 'Live-Vorhersage aktiv'}
        {:else if mode === 'prep'}
          ROI auswählen – wird mit dem nächsten Training gespeichert
        {:else}
          Bild wird zur aktiven Klasse aufgenommen
        {/if}
      </span>
    </div>
    <CameraSelect />
  </div>

  <!-- Train view -->
  <div class="video-wrap" class:hidden={mode !== 'train'}>
    <video class="bg" bind:this={webcamBgEl} autoplay playsinline muted aria-hidden="true">
      <track kind="captions" />
    </video>
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
    <video class="bg" bind:this={webcamTestBgEl} autoplay playsinline muted aria-hidden="true">
      <track kind="captions" />
    </video>
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
      <div class="prediction-display" class:below-threshold={!topLabel}>
        <div class="pred-head">
          <strong>{topLabel ?? '–'}</strong>
          <span class="pct">{Math.round(prediction.confidence * 100)}%</span>
        </div>
        <div class="bar-bg">
          <div class="bar-fill" style="width:{prediction.confidence * 100}%"></div>
        </div>
        {#if !topLabel}
          <span class="below-hint">unter Schwellwert</span>
        {/if}
      </div>

      <!-- Verbose: all class scores + FPS + per-class threshold -->
      <div class="details">
        <div class="details-head">
          <span>Alle Klassen</span>
          <span class="fps">{fps ? `${fps} Hz` : '…'}</span>
        </div>
        <ul class="score-list">
          {#each $classes as cls, i (cls)}
            {@const p = prediction.all[i] ?? 0}
            {@const thr = thresholds[cls] ?? 0}
            {@const triggered = cls === prediction.label && p >= thr}
            <li class:top={triggered}>
              <div class="row1">
                <span class="name">{cls}</span>
                <span class="sub-pct">{Math.round(p * 100)}%</span>
              </div>
              <span class="sub-bar">
                <span class="sub-fill" style="width:{p * 100}%"></span>
                <span class="threshold-marker" style="left:{thr * 100}%" title="Schwellwert {Math.round(thr * 100)}%"></span>
              </span>
              <div class="row3">
                <input
                  class="thr-slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(thr * 100)}
                  oninput={(e) => setClassThreshold(cls, (+(e.target as HTMLInputElement).value) / 100)}
                  aria-label="Schwellwert für {cls}"
                  title="Schwellwert {Math.round(thr * 100)}%"
                />
                <span class="thr-val">{Math.round(thr * 100)}%</span>
              </div>
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

  <!-- Prep view: smaller ROI-editor video + scrollable class thumbs list -->
  <div class="prep-view" class:hidden={mode !== 'prep'}>
    <div class="video-wrap prep-video">
      <video class="bg" bind:this={webcamPrepBgEl} autoplay playsinline muted aria-hidden="true">
        <track kind="captions" />
      </video>
      <video bind:this={webcamPrepEl} autoplay playsinline muted>
        <track kind="captions" />
      </video>

      {#if !cameraReady}
        <div class="loading-overlay">
          <span class="spinner"></span>
          <span>Kamera wird geladen…</span>
        </div>
      {/if}

      <!-- ROI overlay -->
      <div class="roi-container" bind:this={roiContainer}>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="roi-rect"
          role="region"
          aria-label="Trainingsbereich"
          style="left:{roi.x * 100}%; top:{roi.y * 100}%; width:{roi.w * 100}%; height:{roi.h * 100}%;"
          onpointerdown={(e) => onPointerDown('move', e)}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
        >
          {#each ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as h (h)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="handle {h}"
              onpointerdown={(e) => onPointerDown(h as DragMode, e)}
              onpointermove={onPointerMove}
              onpointerup={onPointerUp}
              onpointercancel={onPointerUp}
            ></span>
          {/each}
        </div>
      </div>

      <div class="roi-actions">
        <button type="button" class="roi-btn" onclick={resetRoi}>Zurücksetzen</button>
        <button type="button" class="roi-btn" onclick={fullRoi}>Ganzes Bild</button>
        <span class="roi-readout">
          {Math.round(roi.w * 100)}×{Math.round(roi.h * 100)}% @ ({Math.round(roi.x * 100)},{Math.round(roi.y * 100)})
        </span>
      </div>
    </div>

    <div class="prep-classes">
      <div class="prep-classes-head">
        <span>Klassen &amp; Bilder</span>
        <span class="hint">werden mit der gewählten ROI trainiert</span>
      </div>
      {#if $classes.length === 0}
        <div class="prep-empty">Noch keine Klassen. Wechsle in den Klassen-Tab, um welche hinzuzufügen.</div>
      {:else}
        {#each $classes as cls (cls)}
          {@const imgs = $examples[cls] ?? []}
          <div class="prep-class">
            <div class="prep-class-head">
              <span class="prep-class-name">{cls}</span>
              <span class="prep-class-count">{imgs.length} Bilder</span>
            </div>
            {#if imgs.length}
              <div class="prep-thumbs">
                {#each imgs as ex, i (cls + '_' + i)}
                  <img src={ex.data} alt="" />
                {/each}
              </div>
            {:else}
              <div class="prep-class-empty">Keine Bilder</div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
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
    &.prep .dot {
      background: #f5a54c;
      box-shadow: 0 0 0 3px rgba(245, 165, 76, 0.25);
    }
  }

  // ----- Prep view -----
  .prep-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    &.hidden { display: none; }
  }
  .prep-video {
    flex: 0 0 auto;
    height: 40%;
    min-height: 200px;
    max-height: 55%;
  }
  .roi-container {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
  }
  .roi-rect {
    position: absolute;
    border: 2px solid rgb(var(--md-primary));
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    cursor: move;
    pointer-events: auto;
    touch-action: none;
    box-sizing: border-box;
    .handle {
      position: absolute;
      width: 12px;
      height: 12px;
      background: rgb(var(--md-primary));
      border: 2px solid #fff;
      border-radius: 50%;
      pointer-events: auto;
      touch-action: none;
      box-sizing: border-box;
      &.n  { top: -6px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
      &.s  { bottom: -6px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
      &.e  { right: -6px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      &.w  { left: -6px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      &.ne { top: -6px; right: -6px; cursor: nesw-resize; }
      &.nw { top: -6px; left: -6px; cursor: nwse-resize; }
      &.se { bottom: -6px; right: -6px; cursor: nwse-resize; }
      &.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
    }
  }
  .roi-actions {
    position: absolute;
    left: 12px;
    bottom: 12px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .roi-btn {
    background: rgba(var(--md-surface), 0.9);
    color: rgb(var(--md-on-surface));
    border: 1px solid rgb(var(--md-outline));
    border-radius: var(--md-radius-sm);
    padding: 4px 10px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    backdrop-filter: blur(6px);
    min-height: unset;
    box-shadow: none;
    &:hover { background: rgba(var(--md-primary), 0.12); border-color: rgb(var(--md-primary)); }
  }
  .roi-readout {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    padding: 3px 8px;
    border-radius: 999px;
    backdrop-filter: blur(6px);
  }
  .prep-classes {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: rgba(var(--md-surface-variant), 0.3);
    border-radius: var(--md-radius-lg);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .prep-classes-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    .hint {
      font-size: 11px;
      font-weight: 400;
      color: rgb(var(--md-on-surface-variant));
    }
  }
  .prep-empty,
  .prep-class-empty {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    font-style: italic;
    padding: 6px 2px;
  }
  .prep-class {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .prep-class-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 12px;
    .prep-class-name {
      font-weight: 600;
      color: rgb(var(--md-on-surface));
    }
    .prep-class-count {
      color: rgb(var(--md-on-surface-variant));
    }
  }
  .prep-thumbs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
    gap: 4px;
    img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 4px;
      background: #000;
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
      position: relative;
      z-index: 1;
    }
    video.bg {
      position: absolute;
      inset: 0;
      object-fit: cover;
      transform: scale(1.1) scaleX(-1);
      filter: blur(28px) brightness(0.55) saturate(1.2);
      z-index: 0;
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
      gap: 10px;
      li {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 12px;
        .name { font-weight: 500; }
        .row1 {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .sub-bar {
          position: relative;
          height: 6px;
          background: rgb(var(--md-surface-variant));
          border-radius: 3px;
          overflow: visible;
        }
        .sub-fill {
          display: block;
          height: 100%;
          background: rgb(var(--md-outline));
          border-radius: 3px;
          transition: width 0.2s;
        }
        .threshold-marker {
          position: absolute;
          top: -2px;
          bottom: -2px;
          width: 2px;
          background: rgb(var(--md-on-surface));
          border-radius: 1px;
          pointer-events: none;
          transform: translateX(-50%);
        }
        .sub-pct {
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: rgb(var(--md-on-surface-variant));
        }
        .row3 {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .thr-slider {
          flex: 1;
          accent-color: rgb(var(--md-primary));
          margin: 0;
          height: 12px;
        }
        .thr-val {
          font-variant-numeric: tabular-nums;
          font-size: 10px;
          color: rgb(var(--md-on-surface-variant));
          width: 32px;
          text-align: right;
        }
        &.top {
          .name { color: rgb(var(--md-primary)); font-weight: 700; }
          .sub-fill { background: rgb(var(--md-primary)); }
        }
      }
    }
  }
  .prediction-display {
    &.below-threshold {
      opacity: 0.65;
      strong { color: rgb(var(--md-on-surface-variant)); }
      .bar-fill { background: rgb(var(--md-outline)); }
    }
    .below-hint {
      font-size: 11px;
      color: rgb(var(--md-on-surface-variant));
      font-style: italic;
    }
  }
</style>
