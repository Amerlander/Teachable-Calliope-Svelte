<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    classes,
    classifierModel,
    examples,
    setVideoRef,
    activeClass,
    setActiveClass,
    addClass,
    pushExample,
    clearClass,
    removeClass,
    renameClass,
    videoRefs
  } from '$lib/stores';
  import {
    initSharedCamera,
    predictFromVideo,
    estimatePose,
    drawPoseSkeleton,
    setLastPoseCanvas,
    loadPoseDetector,
    captureFrameFromVideo,
    capturePoseFrameFromVideo,
    downloadClassImages
  } from '$lib/machine';
  import { selectedCameraId } from '$lib/stores/camera';
  import { showNotification } from '$lib/stores/notifications';
  import Button from '$lib/components/ui/Button.svelte';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import {
    currentLang,
    t,
    isTesting,
    isTraining,
    workspaceTab,
    modelTabView,
    draftRoi,
    roiEditing,
    DEFAULT_ROI,
    type Roi
  } from '$lib/stores/app';
  import CameraSelect from '$lib/components/CameraSelect.svelte';
  import { currentProject, setClassThreshold } from '$lib/stores/projects';
  import { streamClassProbabilities, streamPoseKeypoints, smoothingWindow, pickWinnerIndex } from '$lib/stores/streaming';

  const lang = $derived($currentLang);
  const isPose = $derived($currentProject?.mode === 'pose');

  let webcamEl: HTMLVideoElement = $state()!;
  let webcamTestEl: HTMLVideoElement = $state()!;
  let webcamPrepEl: HTMLVideoElement = $state()!;
  let webcamBgEl: HTMLVideoElement = $state()!;
  let webcamTestBgEl: HTMLVideoElement = $state()!;
  let webcamPrepBgEl: HTMLVideoElement = $state()!;
  // Skeleton overlay canvases — one per view. Only used in pose mode.
  let poseCanvasTrain: HTMLCanvasElement = $state()!;
  let poseCanvasTest: HTMLCanvasElement = $state()!;
  let poseCanvasPrep: HTMLCanvasElement = $state()!;
  let cameraReady = $state(false);
  let poseRaf: number | null = null;

  const thresholds = $derived($currentProject?.classThresholds ?? {});
  const currentModelRoi = $derived.by(() => {
    const p = $currentProject;
    if (!p?.currentModelId) return null;
    const m = p.modelHistory.find((x) => x.id === p.currentModelId);
    return m?.roi ?? null;
  });
  let videoAspect = $state(4 / 3);
  // Winner is chosen by threshold-normalized score across all classes (see
  // pickWinnerIndex) — a class with lots of headroom above its threshold beats
  // a class with higher raw probability that is sitting below its threshold.
  const topLabel = $derived.by(() => {
    if (!prediction) return null;
    const labels = $classes;
    const idx = pickWinnerIndex(labels, prediction.all, thresholds);
    return idx < 0 ? null : (labels[idx] ?? null);
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
    const capture = webcamPrepEl ?? webcamEl;
    if (capture) {
      capture.addEventListener('loadedmetadata', () => {
        if (capture.videoWidth && capture.videoHeight) {
          videoAspect = capture.videoWidth / capture.videoHeight;
        }
      });
    }
    cameraReady = true;
  });

  onDestroy(() => {
    stopTest();
    stopPoseLoop();
  });

  // ---------- Pose overlay loop (MoveNet) ----------
  // In pose-mode projects, run MoveNet on the currently-visible video element and
  // render the skeleton into the overlay canvas for the active view. The rendered
  // canvas is registered with the ML layer so predictFromVideo uses skeleton pixels.
  function activeVideoAndCanvas(): { video: HTMLVideoElement | null; canvas: HTMLCanvasElement | null } {
    if (mode === 'train') return { video: webcamEl, canvas: poseCanvasTrain };
    if (mode === 'test')  return { video: webcamTestEl, canvas: poseCanvasTest };
    return { video: webcamPrepEl, canvas: poseCanvasPrep };
  }

  async function poseStep() {
    if (!isPose) return;
    const { video, canvas } = activeVideoAndCanvas();
    if (!video || !canvas || !video.videoWidth) {
      poseRaf = requestAnimationFrame(() => void poseStep());
      return;
    }
    try {
      const pose = await estimatePose(video);
      drawPoseSkeleton(canvas, pose, video.videoWidth, video.videoHeight, { size: 512 });
      setLastPoseCanvas(canvas);
      if (pose?.keypoints?.length) {
        streamPoseKeypoints(pose.keypoints, video.videoWidth, video.videoHeight);
      }
    } catch {
      /* ignore — next tick will retry */
    }
    poseRaf = requestAnimationFrame(() => void poseStep());
  }

  function stopPoseLoop() {
    if (poseRaf != null) {
      cancelAnimationFrame(poseRaf);
      poseRaf = null;
    }
    setLastPoseCanvas(null);
  }

  $effect(() => {
    // Re-subscribe whenever pose mode, view mode, or camera readiness changes.
    void $currentProject?.mode;
    void mode;
    void cameraReady;
    stopPoseLoop();
    if (isPose && cameraReady) {
      void loadPoseDetector();
      poseRaf = requestAnimationFrame(() => void poseStep());
    }
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
        streamClassProbabilities($classes, res.allProbs ?? []);
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
  // draftRoi is the source of truth: null = no ROI (full image).
  // "Add ROI" in ModelTab creates a default; drag handlers mutate via draftRoi.set.
  let roiContainer: HTMLDivElement | null = $state(null);

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
    const current = $draftRoi;
    if (!current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = normPointer(e);
    drag = { mode, startX: p.x, startY: p.y, startRoi: { ...current } };
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
    draftRoi.set(r);
  }

  function onPointerUp(e: PointerEvent) {
    if (drag) {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      drag = null;
    }
  }

  function resetRoi() {
    draftRoi.set({ ...DEFAULT_ROI });
  }

  function fullRoi() {
    draftRoi.set({ x: 0, y: 0, w: 1, h: 1 });
  }

  // ---------- Threshold drag (directly on the sub-bar) ----------
  function setThresholdFromEvent(cls: string, el: HTMLElement, clientX: number) {
    const r = el.getBoundingClientRect();
    const v = clamp((clientX - r.left) / r.width);
    setClassThreshold(cls, v);
  }

  function startThresholdDrag(cls: string, e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setThresholdFromEvent(cls, el, e.clientX);
    const onMove = (ev: PointerEvent) => setThresholdFromEvent(cls, el, ev.clientX);
    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture?.(ev.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  // ---------- Interactive class list (replaces sidebar Klassen tab) ----------
  let newClassName = $state('');
  let editingClass = $state<string | null>(null);
  let editDraft = $state('');
  let capturingClass = $state<string | null>(null);
  let captureInterval: ReturnType<typeof setInterval> | null = null;

  function createClass() {
    const name = newClassName.trim();
    if (!name) return;
    addClass(name);
    newClassName = '';
  }

  function onNewClassKey(e: KeyboardEvent) {
    if (e.key === 'Enter') createClass();
  }

  function startEditClass(cls: string) {
    editingClass = cls;
    editDraft = cls;
  }

  function commitEditClass() {
    if (!editingClass) return;
    const next = editDraft.trim();
    const prev = editingClass;
    editingClass = null;
    if (next && next !== prev) renameClass(prev, next);
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    else if (e.key === 'Escape') {
      editingClass = null;
      editDraft = '';
    }
  }

  function activeCaptureVideo(): HTMLVideoElement | null {
    const vids = get(videoRefs);
    return (mode === 'prep' ? webcamPrepEl : vids.webcam) ?? null;
  }

  function startRecord(cls: string) {
    if (capturingClass) return;
    setActiveClass(cls);
    capturingClass = cls;
    const poseMode = isPose;
    const doCapture = async () => {
      const v = activeCaptureVideo();
      if (!v) return;
      const data = poseMode ? await capturePoseFrameFromVideo(v) : captureFrameFromVideo(v);
      if (data) pushExample(cls, data);
    };
    void doCapture();
    captureInterval = setInterval(() => { void doCapture(); }, 120);
  }

  // Advanced (unattended) recording: after an initial delay, take N pictures
  // spaced by a fixed interval. Cancellable mid-run.
  let advDelaySec = $state(3);
  let advCount = $state(10);
  let advIntervalMs = $state(500);
  let advancedRunningClass = $state<string | null>(null);
  let advancedRemaining = $state(0);
  let advancedCountdown = $state(0);
  let advancedTimers: ReturnType<typeof setTimeout>[] = [];

  function cancelAdvanced() {
    for (const t of advancedTimers) clearTimeout(t);
    advancedTimers = [];
    advancedRunningClass = null;
    advancedRemaining = 0;
    advancedCountdown = 0;
  }

  async function startAdvanced(cls: string) {
    if (advancedRunningClass) return;
    if (capturingClass) stopRecord();
    setActiveClass(cls);
    advancedRunningClass = cls;
    const poseMode = isPose;

    // Initial delay with a visible countdown (whole seconds).
    const delayMs = Math.max(0, Math.round(advDelaySec * 1000));
    for (let s = advDelaySec; s > 0; s--) {
      const elapsedMs = (advDelaySec - s) * 1000;
      advancedTimers.push(setTimeout(() => { advancedCountdown = s; }, elapsedMs));
    }
    advancedTimers.push(setTimeout(() => { advancedCountdown = 0; }, delayMs));

    const total = Math.max(1, Math.floor(advCount));
    advancedRemaining = total;
    const stepMs = Math.max(50, Math.floor(advIntervalMs));

    for (let i = 0; i < total; i++) {
      const at = delayMs + i * stepMs;
      advancedTimers.push(setTimeout(async () => {
        if (advancedRunningClass !== cls) return;
        const v = activeCaptureVideo();
        if (v) {
          const data = poseMode ? await capturePoseFrameFromVideo(v) : captureFrameFromVideo(v);
          if (data) pushExample(cls, data);
        }
        advancedRemaining = total - (i + 1);
        if (i === total - 1) {
          advancedRunningClass = null;
          advancedTimers = [];
        }
      }, at));
    }
  }

  function stopRecord() {
    capturingClass = null;
    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }
  }

  function confirmClear(cls: string) {
    if (confirm(`"${cls}" leeren?`)) clearClass(cls);
  }

  function confirmDelete(cls: string) {
    if (confirm(`"${cls}" löschen?`)) removeClass(cls);
  }

  function onThresholdKey(cls: string, thr: number, e: KeyboardEvent) {
    let next = thr;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clamp(thr - 0.05);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clamp(thr + 0.05);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else return;
    e.preventDefault();
    setClassThreshold(cls, next);
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
  <div class="video-wrap" class:hidden={mode !== 'train'} class:pose-mode={isPose}>
    <video class="bg" bind:this={webcamBgEl} autoplay playsinline muted aria-hidden="true">
      <track kind="captions" />
    </video>
    <video bind:this={webcamEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>
    {#if isPose}
      <canvas class="pose-overlay" bind:this={poseCanvasTrain} width="512" height="512"></canvas>
    {/if}

    {#if !cameraReady}
      <div class="loading-overlay">
        <span class="spinner"></span>
        <span>Kamera wird geladen…</span>
      </div>
    {/if}
  </div>

  <!-- Test view -->
  <div class="video-wrap" class:hidden={mode !== 'test'} class:pose-mode={isPose}>
    <video class="bg" bind:this={webcamTestBgEl} autoplay playsinline muted aria-hidden="true">
      <track kind="captions" />
    </video>
    <video bind:this={webcamTestEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>
    {#if isPose}
      <canvas class="pose-overlay" bind:this={poseCanvasTest} width="512" height="512"></canvas>
    {/if}

    {#if !cameraReady}
      <div class="loading-overlay">
        <span class="spinner"></span>
        <span>Kamera wird geladen…</span>
      </div>
    {/if}

    {#if prediction}
      {@const topIdx = topLabel ? $classes.indexOf(topLabel) : -1}
      {@const topConf = topIdx >= 0 ? (prediction.all[topIdx] ?? 0) : prediction.confidence}
      <div class="prediction-display" class:below-threshold={!topLabel}>
        <div class="pred-head">
          <strong>{topLabel ?? '–'}</strong>
          <span class="pct">{Math.round(topConf * 100)}%</span>
        </div>
        <div class="bar-bg">
          <div class="bar-fill" style="width:{topConf * 100}%"></div>
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
            {@const triggered = cls === topLabel && p >= thr}
            <li class:top={triggered}>
              <div class="row1">
                <span class="name">{cls}</span>
                <span class="sub-pct">
                  <span class="pct-val">{Math.round(p * 100)}%</span>
                  <span class="thr-val">· {Math.round(thr * 100)}%</span>
                </span>
              </div>
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                class="sub-bar"
                role="slider"
                tabindex="0"
                aria-label="Schwellwert für {cls}"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(thr * 100)}
                onpointerdown={(e) => startThresholdDrag(cls, e)}
                onkeydown={(e) => onThresholdKey(cls, thr, e)}
              >
                <span class="sub-fill" style="width:{p * 100}%"></span>
                <span class="threshold-marker" style="left:{thr * 100}%" title="Schwellwert {Math.round(thr * 100)}%"></span>
              </div>
            </li>
          {/each}
        </ul>
        <div class="smoothing">
          <label for="smoothing-slider" class="smoothing-label">
            Glättung (Fenster): <strong>{$smoothingWindow}</strong>
          </label>
          <input
            id="smoothing-slider"
            type="range"
            min="1"
            max="20"
            step="1"
            bind:value={$smoothingWindow}
          />
          <span class="smoothing-hint">Median über die letzten N Vorhersagen</span>
        </div>
      </div>
    {/if}

    {#if mode === 'test' && !$classifierModel}
      <div class="overlay">
        <div class="status warning">{t('training.testStatus', lang)}</div>
      </div>
    {/if}

    {#if currentModelRoi && mode === 'test'}
      <div class="roi-container readonly" style="aspect-ratio: {videoAspect};">
        <div
          class="roi-rect readonly"
          style="left:{currentModelRoi.x * 100}%; top:{currentModelRoi.y * 100}%; width:{currentModelRoi.w * 100}%; height:{currentModelRoi.h * 100}%;"
          title="Aktiver Modell-ROI"
        ></div>
      </div>
    {/if}
  </div>

  <!-- Prep view: smaller ROI-editor video + scrollable class thumbs list -->
  <div class="prep-view" class:hidden={mode !== 'prep'}>
    <div class="video-wrap prep-video" class:pose-mode={isPose}>
      <video class="bg" bind:this={webcamPrepBgEl} autoplay playsinline muted aria-hidden="true">
        <track kind="captions" />
      </video>
      <video bind:this={webcamPrepEl} autoplay playsinline muted>
        <track kind="captions" />
      </video>
      {#if isPose}
        <canvas class="pose-overlay" bind:this={poseCanvasPrep} width="512" height="512"></canvas>
      {/if}

      {#if !cameraReady}
        <div class="loading-overlay">
          <span class="spinner"></span>
          <span>Kamera wird geladen…</span>
        </div>
      {/if}

      {#if $roiEditing && $draftRoi && !isPose}
        <!-- ROI overlay (editable) -->
        <div class="roi-container editing" style="aspect-ratio: {videoAspect};" bind:this={roiContainer}>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="roi-rect"
            role="region"
            aria-label="Trainingsbereich"
            style="left:{$draftRoi.x * 100}%; top:{$draftRoi.y * 100}%; width:{$draftRoi.w * 100}%; height:{$draftRoi.h * 100}%;"
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
            {Math.round($draftRoi.w * 100)}×{Math.round($draftRoi.h * 100)}% @ ({Math.round($draftRoi.x * 100)},{Math.round($draftRoi.y * 100)})
          </span>
        </div>
      {:else if $draftRoi && !isPose}
        <!-- Read-only preview of the currently chosen ROI -->
        <div class="roi-container readonly" style="aspect-ratio: {videoAspect};">
          <div
            class="roi-rect readonly"
            style="left:{$draftRoi.x * 100}%; top:{$draftRoi.y * 100}%; width:{$draftRoi.w * 100}%; height:{$draftRoi.h * 100}%;"
          ></div>
        </div>
      {/if}
    </div>

    <div class="prep-classes">
      <div class="prep-classes-head">
        <span>Klassen &amp; Bilder</span>
        <span class="hint">werden mit der gewählten ROI trainiert</span>
      </div>
      {#each $classes as cls (cls)}
        {@const imgs = [...($examples[cls] ?? [])]}
        <div class="prep-class">
          <div class="prep-class-head">
            {#if editingClass === cls}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="class-name-edit"
                bind:value={editDraft}
                onkeydown={onEditKey}
                onblur={commitEditClass}
                autofocus
              />
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="prep-class-name"
                role="button"
                tabindex="0"
                onclick={() => startEditClass(cls)}
                onkeydown={(e) => e.key === 'Enter' && startEditClass(cls)}
                title="Umbenennen"
              >{cls}</span>
            {/if}
            <span class="prep-class-count">{imgs.length}</span>
            <Dropdown placement="bottom-end">
              {#snippet trigger()}
                <Button variant="ghost" size="small" aria-label="Klassen-Aktionen" title="Mehr Aktionen">⋯</Button>
              {/snippet}
              {#snippet children()}
                <DropdownItem onclick={() => startEditClass(cls)}>Umbenennen</DropdownItem>
                <DropdownItem onclick={() => downloadClassImages(cls, imgs)}>Dateien herunterladen</DropdownItem>
                <DropdownItem onclick={() => confirmClear(cls)}>Klasse leeren</DropdownItem>
                <DropdownItem onclick={() => confirmDelete(cls)}>Klasse löschen</DropdownItem>
              {/snippet}
            </Dropdown>
          </div>

          <div class="prep-thumbs-row">
            <div class="thumb-stack" class:empty={!imgs.length}>
              {#if imgs.length}
                {#each imgs as ex, i (cls + '_' + i)}
                  <img
                    class="stack-img"
                    src={ex.data}
                    alt=""
                    style="--i: {i}; --n: {imgs.length};"
                  />
                {/each}
              {:else}
                <div class="prep-class-empty">Keine Bilder</div>
              {/if}
            </div>
            <button
              type="button"
              class="record-btn"
              class:recording={capturingClass === cls || advancedRunningClass === cls}
              aria-label="Bild aufnehmen"
              title="Halten zum Aufnehmen"
              disabled={!!advancedRunningClass && advancedRunningClass !== cls}
              onpointerdown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); startRecord(cls); }}
              onpointerup={stopRecord}
              onpointercancel={stopRecord}
            >
              <span class="record-dot"></span>
              {#if advancedRunningClass === cls}
                {#if advancedCountdown > 0}
                  <span class="adv-badge">{advancedCountdown}</span>
                {:else}
                  <span class="adv-badge">{advancedRemaining}</span>
                {/if}
              {/if}
            </button>
            <Dropdown placement="bottom-end" minWidth="260px">
              {#snippet trigger()}
                <Button variant="ghost" size="small" aria-label="Erweiterte Aufnahme" title="Erweiterte Aufnahme">⋯</Button>
              {/snippet}
              {#snippet children()}
                <div class="adv-popover">
                  <div class="adv-title">Erweiterte Aufnahme</div>
                  <label class="adv-row">
                    <span>Verzögerung vor Start (s)</span>
                    <input type="number" min="0" max="30" bind:value={advDelaySec} />
                  </label>
                  <label class="adv-row">
                    <span>Anzahl Bilder</span>
                    <input type="number" min="1" max="500" bind:value={advCount} />
                  </label>
                  <label class="adv-row">
                    <span>Abstand (ms)</span>
                    <input type="number" min="50" max="5000" step="50" bind:value={advIntervalMs} />
                  </label>
                  <div class="adv-actions">
                    {#if advancedRunningClass === cls}
                      <button class="adv-btn danger" type="button" onclick={cancelAdvanced}>Abbrechen</button>
                    {:else}
                      <button class="adv-btn primary" type="button" onclick={() => startAdvanced(cls)} disabled={!!advancedRunningClass}>Start</button>
                    {/if}
                  </div>
                </div>
              {/snippet}
            </Dropdown>
          </div>
        </div>
      {/each}

      <div class="new-class-row">
        <input
          class="new-class-input"
          type="text"
          placeholder="Neue Klasse hinzufügen"
          bind:value={newClassName}
          onkeydown={onNewClassKey}
        />
        <Button
          class="add-btn"
          size="small"
          onclick={createClass}
          disabled={!newClassName.trim()}
          aria-label="Klasse hinzufügen"
        >
          +
        </Button>
      </div>
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
    margin: auto;
    max-width: 100%;
    max-height: 100%;
    aspect-ratio: 4 / 3;
    z-index: 4;
    pointer-events: none;
    &.readonly { pointer-events: none; }
  }
  .roi-rect {
    position: absolute;
    border: 2px solid rgb(var(--md-primary));
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    cursor: move;
    pointer-events: auto;
    touch-action: none;
    box-sizing: border-box;
    &.readonly {
      cursor: default;
      pointer-events: none;
      box-shadow: none;
      border-style: dashed;
      border-color: rgb(var(--md-tertiary));
      background: rgba(var(--md-tertiary), 0.08);
    }
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
    align-items: center;
    gap: 8px;
    font-size: 12px;
    .prep-class-name {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
      cursor: text;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 2px 4px;
      border-radius: var(--md-radius-sm);
      &:hover { background: rgba(var(--md-on-surface), 0.06); }
    }
    .prep-class-count {
      font-size: 11px;
      color: rgb(var(--md-on-surface-variant));
      background: rgba(var(--md-surface-variant), 0.6);
      padding: 1px 6px;
      border-radius: 99px;
    }
  }
  .class-name-edit {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    border: 1.5px solid rgb(var(--md-primary));
    border-radius: var(--md-radius-sm);
    background: rgb(var(--md-surface));
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
  }
  .prep-thumbs-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .thumb-stack {
    flex: 1;
    min-width: 0;
    position: relative;
    height: 56px;
    // clip horizontally so overflowing images don't reach the record button,
    // but keep vertical overflow so hover pop-out is visible.
    overflow-x: clip;
    overflow-y: visible;
    --thumb: 56px;
    --offset: 14px;
    &.empty { display: flex; align-items: center; }
  }
  .stack-img {
    position: absolute;
    top: 0;
    left: calc(var(--i) * var(--offset));
    width: var(--thumb);
    height: var(--thumb);
    object-fit: cover;
    border-radius: 4px;
    background: #000;
    border: 2px solid rgb(var(--md-surface));
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    z-index: calc(var(--i) + 1);
    transition: left 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
                transform 0.2s ease,
                box-shadow 0.2s ease;
    cursor: pointer;
  }
  // On hover of the stack, fan images farther apart so you can glimpse each one.
  // Spread is capped by container width to avoid overflow.
  .thumb-stack:hover .stack-img {
    left: calc(
      var(--i) *
      min(var(--thumb), (100% - var(--thumb)) / max(var(--n) - 1, 1))
    );
  }
  .stack-img:hover {
    transform: translateY(-8px) scale(1.1);
    z-index: 999;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }
  .record-btn {
    position: relative;
    flex: 0 0 auto;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid rgb(var(--md-outline));
    background: rgba(var(--md-surface), 0.9);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    touch-action: none;
    transition: border-color 0.15s, transform 0.1s, background 0.15s;
    .record-dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #e53935;
      transition: all 0.15s;
    }
    &:hover {
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary-container), 0.3);
    }
    &.recording {
      border-color: #e53935;
      background: rgba(229, 57, 53, 0.15);
      .record-dot {
        border-radius: 4px;
        width: 14px;
        height: 14px;
        animation: recordPulse 0.9s ease-in-out infinite;
      }
    }
  }
  @keyframes recordPulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(0.85); opacity: 0.7; }
  }
  .new-class-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px;
    border: 1px dashed rgba(var(--md-outline), 0.7);
    border-radius: var(--md-radius-md);
    margin-top: 4px;
    &:focus-within {
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary-container), 0.3);
    }
  }
  .new-class-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 6px 8px;
    font: inherit;
    color: rgb(var(--md-on-surface));
    &:focus {
      outline: none;
      border: none;
    }
  }
  :global(.add-btn) {
    width: 32px;
    min-width: 32px;
    height: 32px;
    min-height: 32px;
    padding: 0;
    font-size: 18px;
    font-weight: 500;
    line-height: 1;
    flex-shrink: 0;
    box-shadow: none;
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
    // --- Pose mode: blur the raw camera heavily and show the skeleton canvas on top. ---
    &.pose-mode video:not(.bg) {
      filter: blur(18px) brightness(0.4) saturate(1.1);
    }
    .pose-overlay {
      position: absolute;
      inset: 0;
      margin: auto;
      max-width: 100%;
      max-height: 100%;
      width: 100%;
      height: 100%;
      object-fit: contain;
      transform: scaleX(-1);
      z-index: 2;
      pointer-events: none;
      // The canvas is painted with a black background by drawPoseSkeleton; use
      // multiply so only the skeleton strokes remain visible over the blurred video.
      mix-blend-mode: screen;
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
          height: 12px;
          background: rgb(var(--md-surface-variant));
          border-radius: 6px;
          overflow: visible;
          cursor: pointer;
          touch-action: none;
          user-select: none;
          outline: none;
          &:focus-visible {
            box-shadow: 0 0 0 2px rgb(var(--md-primary));
          }
        }
        .sub-fill {
          display: block;
          height: 100%;
          background: rgb(var(--md-outline));
          border-radius: 6px;
          transition: width 0.15s;
          pointer-events: none;
        }
        .threshold-marker {
          position: absolute;
          top: -3px;
          bottom: -3px;
          width: 4px;
          background: rgb(var(--md-on-surface));
          border-radius: 2px;
          pointer-events: none;
          transform: translateX(-50%);
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
        }
        .sub-pct {
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: rgb(var(--md-on-surface-variant));
          display: inline-flex;
          gap: 4px;
          .pct-val { color: rgb(var(--md-on-surface)); font-weight: 600; }
          .thr-val { opacity: 0.7; }
        }
        &.top {
          .name { color: rgb(var(--md-primary)); font-weight: 700; }
          .sub-fill { background: rgb(var(--md-primary)); }
        }
      }
    }
    .smoothing {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid rgb(var(--md-outline-variant));
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .smoothing-label {
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      strong { color: rgb(var(--md-on-surface)); font-variant-numeric: tabular-nums; }
    }
    .smoothing input[type="range"] {
      width: 100%;
      accent-color: rgb(var(--md-primary));
    }
    .smoothing-hint {
      font-size: 10px;
      color: rgb(var(--md-on-surface-variant));
      opacity: 0.8;
    }
  }
  .adv-popover {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: rgb(var(--md-on-surface));
  }
  .adv-title {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 2px;
  }
  .adv-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    input {
      width: 80px;
      padding: 4px 6px;
      border: 1px solid rgb(var(--md-outline-variant));
      border-radius: 6px;
      font-size: 12px;
      background: rgb(var(--md-surface));
      color: rgb(var(--md-on-surface));
    }
  }
  .adv-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 4px;
  }
  .adv-btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: none;
    min-height: unset;
    &.primary {
      background: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
      &:disabled { opacity: 0.5; cursor: default; }
    }
    &.danger {
      background: transparent;
      border-color: #ef4444;
      color: #ef4444;
    }
  }
  .adv-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 9px;
    background: rgb(var(--md-primary));
    color: rgb(var(--md-on-primary));
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
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
