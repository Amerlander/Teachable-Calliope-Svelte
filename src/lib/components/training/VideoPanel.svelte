<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    classes,
    classifierModel,
    examples,
    predictionClasses,
    setVideoRef,
    activeClass,
    setActiveClass,
    addClass,
    pushExample,
    clearClass,
    removeClass,
    removeExamples,
    renameClass,
    videoRefs,
    draftRoi,
    setDraftRoi,
    classThumbs
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
    downloadClassImages,
    CAPTURE_SHORT,
    MODEL_INPUT
  } from '$lib/machine';
  import { cameraMirror, selectedCameraId } from '$lib/stores/camera';
  import { showNotification } from '$lib/stores/notifications';
  import Button from '$lib/components/ui/Button.svelte';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import DeleteConfirmDialog, {
    type DeleteTarget
  } from '$lib/components/DeleteConfirmDialog.svelte';
  import {
    isComparing,
    isTesting,
    isTraining,
    workspaceTab,
    modelTabView
  } from '$lib/stores/app';
  import {
    defaultRoi,
    displayRoi,
    roiSizeLabel,
    roiCropStyle,
    roiPixelSize,
    squareRoi,
    type RoiHandle
  } from '$lib/roi';
  import RoiOverlay from '$lib/components/RoiOverlay.svelte';
  import type { Roi } from '$lib/stores/projects';
  import ModelCharts from '$lib/components/training/ModelCharts.svelte';
  import ModelDetailsModal from '$lib/components/training/ModelDetailsModal.svelte';
  import ClassThumbDialog from '$lib/components/training/ClassThumbDialog.svelte';
  import TrainingProgress from '$lib/components/training/TrainingProgress.svelte';
  import {
    activeModel,
    currentProject,
    resetModelClassRanges,
    setModelClassRange,
    setModelSmoothing
  } from '$lib/stores/projects';
  import {
    streamClassProbabilities,
    streamPoseKeypoints,
    type CurrentDetection
  } from '$lib/stores/streaming';
  import {
    CLASS_THRESHOLD,
    MAX_SMOOTHING,
    MIN_RANGE_SPAN,
    MIN_SMOOTHING,
    normalizeSmoothing,
    rangeFor,
    rawTriggerPoint,
    type ClassRange
  } from '$lib/calibration';
  import { autoCalibrateActiveModel } from '$lib/models';

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

  // The mapping windows belong to the model being tested, so they follow the
  // model selection rather than the project's live state.
  const ranges = $derived($activeModel?.classRanges ?? {});
  const smoothing = $derived(normalizeSmoothing($activeModel?.smoothing));
  // The selected model's own region — shown while testing so it is visible what
  // the model is looking at, and never editable there.
  const currentModelRoi = $derived($activeModel?.roi ?? null);
  let videoAspect = $state(4 / 3);
  /** True once the camera has reported its real aspect, not the 4:3 assumption. */
  let aspectKnown = $state(false);
  // Every score below is the mapped one, decided in streamClassProbabilities:
  // it maps each class through its window, applies the fixed threshold and picks
  // the winner. Nothing here recomputes that.
  const topLabel = $derived(prediction?.detected ? prediction.label : null);
  let prediction = $state<CurrentDetection | null>(null);
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

  let detailsOpen = $state(false);

  onMount(async () => {
    // All six feeds are registered, not just the two front ones: the camera can
    // now be switched from the header while any of these views is showing, and
    // the switch rebinds whatever is in the registry.
    setVideoRef('webcam', webcamEl);
    setVideoRef('webcamBg', webcamBgEl);
    setVideoRef('webcamTest', webcamTestEl);
    setVideoRef('webcamTestBg', webcamTestBgEl);
    setVideoRef('webcamPrep', webcamPrepEl);
    setVideoRef('webcamPrepBg', webcamPrepBgEl);
    await initSharedCamera(get(videoRefs), get(selectedCameraId) ?? undefined);
    const capture = webcamPrepEl ?? webcamEl;
    if (capture) {
      // Read it now *and* on the event: by the time this runs the stream may
      // already have its metadata, in which case loadedmetadata has been and
      // gone — and the default region cannot be squared without the aspect.
      const readAspect = () => {
        if (!capture.videoWidth || !capture.videoHeight) return;
        videoAspect = capture.videoWidth / capture.videoHeight;
        aspectKnown = true;
      };
      readAspect();
      // Fires again after a camera switch, so the aspect follows the new device.
      capture.addEventListener('loadedmetadata', readAspect);
    }
    cameraReady = true;
  });

  onDestroy(() => {
    stopTest();
    stopPoseLoop();
    // Leave no detached elements behind for the next camera switch to bind to.
    for (const key of ['webcam', 'webcamBg', 'webcamTest', 'webcamTestBg', 'webcamPrep', 'webcamPrepBg'] as const) {
      setVideoRef(key, null);
    }
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
  // While a training runs, the previously loaded classifier must stay idle — it
  // is about to be replaced and predicting against it competes for the GPU.
  // Auto-calibration scores every recorded example through the same classifier,
  // so the live loop steps aside for it instead of queueing predictions behind
  // each measurement. The comparison overlay runs several models on this same
  // camera while it is on top of this panel, so this loop stands down for it too.
  $effect(() => {
    const m = mode;
    const hasModel = !!$classifierModel;
    if (m === 'test' && hasModel && !$isTraining && !autoCalibrating && !$isComparing) {
      startTest();
    } else {
      stopTest({ keepLastFrame: autoCalibrating || $isComparing });
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
        prediction = streamClassProbabilities($predictionClasses, res.allProbs ?? []);
      } catch {
        /* ignore */
      }
    }, 150);
  }

  // `keepLastFrame` is for the pause during auto-calibration: the panel that
  // holds the button has to stay on screen while the measurement runs.
  function stopTest(opts?: { keepLastFrame?: boolean }) {
    isTesting.set(false);
    if (predInterval) { clearInterval(predInterval); predInterval = null; }
    if (!opts?.keepLastFrame) prediction = null;
    fps = 0;
    lastTickAt = 0;
  }

  // ---------- Region editor (prep mode) ----------
  // `draftRoi` is the source of truth and holds camera-frame coordinates. It
  // lives on the project, so what is dragged here is still here after a run, a
  // model switch or a reload. The feed is shown mirrored, so the box is edited in
  // mirrored coordinates and converted on the way in and out — see $lib/roi.
  //
  // A null draft means "this project has not picked a region yet" rather than
  // "whole image": the box is always on screen, so it always has a value, and an
  // unpicked project falls back to the largest centred square. Old models that
  // were trained on the full frame keep working — inference reads the region off
  // the model, and a null there still means the whole frame.
  let roiContainer: HTMLDivElement | null = $state(null);

  /** The region in use, filled in for a project that has not picked one. */
  const shownRoi = $derived($draftRoi ?? defaultRoi(videoAspect));

  /** The box as it appears on the feed, mirrored along with it. */
  const editRoi = $derived(displayRoi(shownRoi, $cameraMirror));

  /**
   * What training will actually crop to. Pose projects have no region editor, so
   * there the draft is taken as-is — including the null that means whole frame.
   */
  const effectiveRoi = $derived(isPose ? $draftRoi : shownRoi);

  /**
   * Pixel size of the region inside a stored capture. The hover preview is shown
   * at exactly this size (capped to the video area by CSS), so the crop is never
   * upscaled past the detail it actually holds. Pose frames are rendered square;
   * camera frames keep the camera's aspect.
   */
  const previewCrop = $derived(
    roiPixelSize(effectiveRoi, isPose ? 1 : videoAspect, CAPTURE_SHORT)
  );

  /**
   * True once the region holds fewer pixels than the model's input, so the crop
   * gets upscaled on the way in. Worth saying, not worth forbidding: training and
   * inference upscale identically, and a small region still beats a full frame in
   * which the subject is a handful of pixels among mostly background.
   */
  const roiBelowInput = $derived(Math.min(previewCrop.w, previewCrop.h) < MODEL_INPUT);

  function commitEditRoi(shown: Roi) {
    setDraftRoi(displayRoi(shown, $cameraMirror));
  }

  /** Back to the largest centred square — the one reset there is. */
  function resetRoi() {
    setDraftRoi(defaultRoi(videoAspect));
  }

  // Write the fallback through once the camera has reported its real aspect, so
  // training gets the region the user has been looking at all along instead of
  // the null it never chose. Until then `shownRoi` covers the display.
  //
  // Waiting for the aspect and not merely for `cameraReady` matters: that flag is
  // set before the stream's metadata arrives, so committing then would pin the
  // region to a square derived from the assumed 4:3 — which on a 16:9 camera is
  // not a square at all, the one thing this is here to avoid.
  $effect(() => {
    if (mode === 'prep' && !isPose && aspectKnown && !$draftRoi) {
      setDraftRoi(defaultRoi(videoAspect));
    }
  });

  type DragMode = RoiHandle;
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
    const current = editRoi;
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
    // Square by default so the region reaches the model undistorted, free while
    // Shift is held — a wide gesture strip or a tall full-body box is a fair ask,
    // and either way training and inference squash the same region the same way.
    commitEditRoi(e.shiftKey ? r : squareRoi(r, drag.startRoi, drag.mode, videoAspect, min));
  }

  function onPointerUp(e: PointerEvent) {
    if (drag) {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      drag = null;
    }
  }

  // ---------- Tuning mode („Anpassen“) ----------
  // Holds the two controls that change how the model's output is read rather than
  // the model itself: the per-class windows on the value axis, and smoothing on
  // the time axis. One switch for both, because at rest neither belongs on screen
  // — and one switch for the whole list rather than one per row, since the windows
  // are set in a single pass.
  let mappingEdit = $state(false);
  let autoCalibrating = $state(false);
  let autoCalibrateNote = $state<string | null>(null);

  /** Move one end of a class's window, keeping the two at least a span apart. */
  function moveHandle(cls: string, end: 'lo' | 'hi', value: number) {
    const current = rangeFor(ranges, cls);
    const next: ClassRange =
      end === 'lo'
        ? { lo: Math.min(clamp(value), current.hi - MIN_RANGE_SPAN), hi: current.hi }
        : { lo: current.lo, hi: Math.max(clamp(value), current.lo + MIN_RANGE_SPAN) };
    setModelClassRange($activeModel?.id, cls, next);
  }

  function startHandleDrag(cls: string, end: 'lo' | 'hi', e: PointerEvent) {
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    const track = handle.parentElement;
    if (!track) return;
    handle.setPointerCapture(e.pointerId);
    const valueAt = (clientX: number) => {
      const r = track.getBoundingClientRect();
      return (clientX - r.left) / r.width;
    };
    const onMove = (ev: PointerEvent) => moveHandle(cls, end, valueAt(ev.clientX));
    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture?.(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function onHandleKey(cls: string, end: 'lo' | 'hi', e: KeyboardEvent) {
    const current = rangeFor(ranges, cls);
    const v = end === 'lo' ? current.lo : current.hi;
    let next = v;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = v - 0.05;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = v + 0.05;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else return;
    e.preventDefault();
    moveHandle(cls, end, next);
  }

  /** Derive every window from how the model scores the recorded examples. */
  async function runAutoCalibrate() {
    if (autoCalibrating) return;
    autoCalibrating = true;
    autoCalibrateNote = null;
    try {
      const written = await autoCalibrateActiveModel();
      autoCalibrateNote = written
        ? null
        : 'Keine Beispiele im Projekt — Bereiche bitte von Hand setzen.';
    } catch {
      autoCalibrateNote = 'Automatik fehlgeschlagen.';
    } finally {
      autoCalibrating = false;
    }
  }

  // ---------- Interactive class list (replaces sidebar Klassen tab) ----------
  let newClassName = $state('');
  let editingClass = $state<string | null>(null);
  let editDraft = $state('');
  let capturingClass = $state<string | null>(null);
  let captureInterval: ReturnType<typeof setInterval> | null = null;

  /** First unused "Klasse n" — what an unnamed class gets called. */
  function autoClassName(): string {
    const taken = new Set($classes);
    let n = taken.size + 1;
    while (taken.has(`Klasse ${n}`)) n++;
    return `Klasse ${n}`;
  }

  const pendingClassName = $derived(newClassName.trim() || autoClassName());

  /**
   * Turn the placeholder row at the bottom of the list into a real class and
   * return its name. Recording from that row goes through here, so a class can
   * be created by just hitting record — the name is optional.
   */
  function commitNewClass(): string {
    const name = pendingClassName;
    newClassName = '';
    if (!$classes.includes(name)) addClass(name);
    return name;
  }

  function onNewClassKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      commitNewClass();
      (e.target as HTMLInputElement).blur();
    }
  }

  // A typed name makes the class real; an untouched row stays a placeholder.
  function onNewClassBlur() {
    if (newClassName.trim()) commitNewClass();
  }

  // Recording straight from the placeholder row: create the class first, then
  // hand the still-held pointer over to the regular capture loop.
  let ghostRecording = $state(false);

  function startGhostRecord(e: PointerEvent) {
    // Don't create a class we then fail to record into.
    if (capturingClass || advancedRunningClass) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ghostRecording = true;
    startRecord(commitNewClass());
  }

  function stopGhostRecord() {
    ghostRecording = false;
    stopRecord();
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

  // ---------- Example thumbnails: hover preview, click-delete, drag-select ----------
  // Hovering a thumb blows it up over the prep video; a plain click deletes that
  // one image; dragging across the stack selects a range for bulk deletion.
  // While a selection is active a click toggles membership instead of deleting,
  // so the two gestures never fight over the same pointer event.
  let previewSrc = $state<string | null>(null);
  let selectionClass = $state<string | null>(null);
  const selectedIdx = new SvelteSet<number>();
  let thumbDrag = $state<{ cls: string; startIdx: number; moved: boolean } | null>(null);
  // Which stack the pointer is currently inside — a drag that wanders off the
  // stack must not tear down the preview, so pointerleave defers to this.
  let hoveredStack = $state<string | null>(null);

  // ---------- Thumb stack geometry ----------
  // The stack is anchored on its newest image: the per-image offset shrinks
  // until everything fits, and once the thumbs would get too narrow to aim at,
  // the oldest ones drop out of the row instead of running past its right edge.
  const STACK_THUMB = 56;      // keep in sync with --thumb in .thumb-stack
  const STACK_MAX_OFFSET = 14;
  const STACK_MIN_OFFSET = 6;
  const STACK_MORE_WIDTH = 36; // room the "+N older" chip claims on the left

  // Every stack sits in the same column, so one measurement serves them all.
  let stackWidth = $state(0);

  function stackLayout(n: number) {
    const plain = { offset: STACK_MAX_OFFSET, start: 0, hidden: 0, pad: 0 };
    if (n <= 1 || stackWidth <= 0) return plain;
    const avail = Math.max(0, stackWidth - STACK_THUMB);
    const fitted = avail / (n - 1);
    if (fitted >= STACK_MIN_OFFSET) {
      return { offset: Math.min(STACK_MAX_OFFSET, fitted), start: 0, hidden: 0, pad: 0 };
    }
    const room = Math.max(0, avail - STACK_MORE_WIDTH);
    const visible = Math.max(1, Math.floor(room / STACK_MIN_OFFSET) + 1);
    const start = Math.max(0, n - visible);
    return { offset: STACK_MIN_OFFSET, start, hidden: start, pad: STACK_MORE_WIDTH };
  }

  function clearSelection() {
    selectedIdx.clear();
    selectionClass = null;
  }

  function selectRange(a: number, b: number) {
    selectedIdx.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selectedIdx.add(i);
  }

  function deleteSelected() {
    const cls = selectionClass;
    if (!cls || !selectedIdx.size) return;
    removeExamples(cls, [...selectedIdx]);
    clearSelection();
    previewSrc = null;
  }

  function deleteThumb(cls: string, i: number) {
    removeExamples(cls, [i]);
    previewSrc = null;
  }

  function onThumbPointerDown(cls: string, i: number, e: PointerEvent) {
    if (e.button !== 0) return;
    // Stop the browser's native image drag so pointerenter keeps firing on the
    // thumbs we drag across.
    e.preventDefault();
    // Touch implicitly captures the pointer to the element it started on, which
    // would swallow the pointerenter events the drag-select relies on.
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);

    const hadSelection = selectionClass === cls && selectedIdx.size > 0;
    if (selectionClass !== cls) clearSelection();
    thumbDrag = { cls, startIdx: i, moved: false };

    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      const drag = thumbDrag;
      thumbDrag = null;
      // The stack stayed fanned out for the whole drag; now that it is over,
      // the preview only survives if the pointer is still on the thumbs.
      if (hoveredStack !== cls) previewSrc = null;
      if (!drag || drag.moved || ev.type === 'pointercancel') return;
      if (hadSelection) {
        if (selectedIdx.has(i)) selectedIdx.delete(i);
        else selectedIdx.add(i);
        if (!selectedIdx.size) selectionClass = null;
      } else {
        deleteThumb(cls, i);
      }
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function onThumbPointerEnter(cls: string, i: number, data: string) {
    previewSrc = data;
    if (!thumbDrag || thumbDrag.cls !== cls) return;
    thumbDrag.moved = true;
    selectionClass = cls;
    selectRange(thumbDrag.startIdx, i);
  }

  function onThumbKey(cls: string, i: number, e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteThumb(cls, i);
    } else if (e.key === ' ') {
      e.preventDefault();
      if (selectionClass !== cls) clearSelection();
      selectionClass = cls;
      if (selectedIdx.has(i)) selectedIdx.delete(i);
      else selectedIdx.add(i);
      if (!selectedIdx.size) selectionClass = null;
    }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && selectedIdx.size) clearSelection();
  }

  /** What the confirm dialog is currently asking about; null keeps it closed. */
  let pendingDelete = $state<DeleteTarget | null>(null);
  /** The class whose cover is being picked, or null while the dialog is closed. */
  let thumbPickClass = $state<string | null>(null);

  function confirmClear(cls: string) {
    pendingDelete = { kind: 'class', name: cls, clear: true };
  }

  function confirmDelete(cls: string) {
    pendingDelete = { kind: 'class', name: cls };
  }

  /**
   * Runs whatever the dialog was asking about. The target is cleared first so
   * the preview — which reads the live example store — is gone before the data
   * behind it is.
   */
  function runDelete() {
    const t = pendingDelete;
    pendingDelete = null;
    if (t?.kind !== 'class') return;
    if (t.clear) clearClass(t.name);
    else removeClass(t.name);
    if (selectionClass === t.name) clearSelection();
  }

</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="right-panel">
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

  <!-- Test view: video on top, facts about the selected model below — the same
       slot that holds classes & images while a new model is being prepared. -->
  <div class="test-view" class:hidden={mode !== 'test'}>
    <div class="video-wrap test-video" class:pose-mode={isPose}>
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
        <div class="prediction-display" class:below-threshold={!topLabel}>
          <div class="pred-head">
            <strong>{topLabel ?? '–'}</strong>
            <span class="pct">{Math.round(prediction.confidence * 100)}%</span>
          </div>
          <div class="bar-bg">
            <div class="bar-fill" style="width:{prediction.confidence * 100}%"></div>
          </div>
          {#if !topLabel}
            <span class="below-hint">unter {Math.round(CLASS_THRESHOLD * 100)}%</span>
          {/if}
        </div>

      {/if}

      {#if mode === 'test' && !$classifierModel && !$isTraining}
        <div class="overlay">
          <div class="status warning">Bereit zum Testen</div>
        </div>
      {/if}

      {#if mode === 'test' && !isPose}
        <RoiOverlay roi={currentModelRoi} aspect={videoAspect} />
      {/if}
    </div>

    <!-- One slot, two states: the running training, then the model it produced.
         Kept unmounted while the test view is hidden — the charts inside measure
         their container on mount and would come back zero-width otherwise. -->
    <div class="model-info" class:hidden={mode !== 'test'}>
      {#if mode !== 'test'}
        <!-- nothing: the whole test view is off-screen -->
      {:else if $isTraining}
        <TrainingProgress />
      {:else}
        <div class="model-info-head">
          <span class="mi-title">Modell-Info</span>
          <span class="hint">
            {#if $activeModel}
              {$activeModel.label || new Date($activeModel.trainedAt).toLocaleString('de-DE')}
            {:else if $classifierModel}
              importiertes Modell
            {:else}
              kein Modell geladen
            {/if}
          </span>
          {#if $classifierModel}
            <span class="mi-head-actions">
              <Button variant="ghost" size="small" onclick={() => (detailsOpen = true)}>
                Details…
              </Button>
            </span>
          {/if}
        </div>

        {#if $classifierModel}
          <!-- Left: what the model can tell apart. Right: how well it does it. -->
          <div class="mi-main">
            <!-- The model's classes and, while a test runs, what each one
                 currently scores. One list instead of a second one floating over
                 the video: the score belongs to the class it describes. -->
            <div class="mi-classes">
              <div class="mi-classes-head">
                <span>Klassen des Modells</span>
                <span class="hint">
                  {$predictionClasses.length} Klassen{prediction && fps ? ` · ${fps} Hz` : ''}
                </span>
                <button class="mi-link" onclick={() => (mappingEdit = !mappingEdit)}>
                  {mappingEdit ? 'Fertig' : 'Anpassen'}
                </button>
              </div>

              {#if mappingEdit}
                <p class="mi-tune-intro">
                  <strong>Empfindlichkeit</strong> — die Griffe legen fest, welcher
                  Wert des Modells als 0 % und welcher als 100 % angezeigt wird.
                  Erkannt wird ab {Math.round(CLASS_THRESHOLD * 100)}%.
                </p>
              {/if}
              {#each $predictionClasses as cls (cls)}
                {@const count = $activeModel
                  ? ($activeModel.exampleCounts?.[cls] ?? 0)
                  : ($examples[cls]?.length ?? 0)}
                <!-- Look the score up by label: the frame carries its own class
                     list, which can lag this one by a frame after a model swap. -->
                {@const idx = prediction ? prediction.labels.indexOf(cls) : -1}
                {@const score = idx >= 0 ? (prediction?.all[idx] ?? null) : null}
                {@const raw = idx >= 0 ? (prediction?.raw[idx] ?? 0) : 0}
                {@const range = rangeFor(ranges, cls)}
                <div class="mi-class" class:detected={cls === topLabel}>
                  <div class="mi-class-row">
                    <span class="mi-class-name">{cls}</span>
                    <span class="mi-class-count">{count} Bilder</span>
                    {#if score !== null}
                      <span class="mi-class-pct">{Math.round(score * 100)}%</span>
                    {/if}
                  </div>
                  {#if score !== null}
                    <div class="mi-bar" aria-hidden="true">
                      <span class="mi-bar-fill" style="width:{score * 100}%"></span>
                      <span class="mi-bar-thr" style="left:{CLASS_THRESHOLD * 100}%"></span>
                    </div>
                  {/if}

                  {#if mappingEdit}
                    <!-- Second track, in raw model values: the only place the
                         model's own number is shown. -->
                    <div class="mi-map">
                      <div class="raw-track">
                        <span
                          class="raw-window"
                          style="left:{range.lo * 100}%;width:{(range.hi - range.lo) * 100}%"
                        ></span>
                        <!-- The fixed threshold projected back onto the raw
                             scale: where inside the window a class starts to
                             count. Moves with the handles. -->
                        <span
                          class="raw-trigger"
                          style="left:{rawTriggerPoint(range) * 100}%"
                          title="Erkannt ab roh {Math.round(rawTriggerPoint(range) * 100)}%"
                        ></span>
                        {#if idx >= 0}
                          <span class="raw-marker" style="left:{raw * 100}%"></span>
                        {/if}
                        <button
                          class="raw-handle"
                          style="left:{range.lo * 100}%"
                          role="slider"
                          aria-label="Roher Wert für 0 %, {cls}"
                          aria-valuemin="0"
                          aria-valuemax="100"
                          aria-valuenow={Math.round(range.lo * 100)}
                          onpointerdown={(e) => startHandleDrag(cls, 'lo', e)}
                          onkeydown={(e) => onHandleKey(cls, 'lo', e)}
                        ></button>
                        <button
                          class="raw-handle"
                          style="left:{range.hi * 100}%"
                          role="slider"
                          aria-label="Roher Wert für 100 %, {cls}"
                          aria-valuemin="0"
                          aria-valuemax="100"
                          aria-valuenow={Math.round(range.hi * 100)}
                          onpointerdown={(e) => startHandleDrag(cls, 'hi', e)}
                          onkeydown={(e) => onHandleKey(cls, 'hi', e)}
                        ></button>
                      </div>
                      <div class="mi-map-legend">
                        <span>0 % ab roh {Math.round(range.lo * 100)}%</span>
                        {#if idx >= 0}
                          <span class="mi-map-now">roh {Math.round(raw * 100)}%</span>
                        {/if}
                        <span>100 % ab roh {Math.round(range.hi * 100)}%</span>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}

              {#if mappingEdit}
                <div class="mi-map-actions">
                  <div class="mi-map-buttons">
                    <button onclick={runAutoCalibrate} disabled={autoCalibrating}>
                      {autoCalibrating ? 'Messe…' : 'Aus Beispielen bestimmen'}
                    </button>
                    <button onclick={() => resetModelClassRanges($activeModel?.id)}>
                      Auf 0–100 % zurücksetzen
                    </button>
                  </div>
                  {#if autoCalibrateNote}
                    <span class="mi-map-note">{autoCalibrateNote}</span>
                  {/if}
                </div>

                <!-- The other half of the mode: not per class and not on the
                     value axis, so it gets its own name and sits apart from the
                     class rows. -->
                <label for="smoothing-slider" class="mi-tune-row">
                  <span class="mi-tune-label">
                    <strong>Glättung</strong> — Median über die letzten
                    {smoothing} Vorhersagen
                  </span>
                  <input
                    id="smoothing-slider"
                    type="range"
                    min={MIN_SMOOTHING}
                    max={MAX_SMOOTHING}
                    step="1"
                    value={smoothing}
                    disabled={!$activeModel}
                    oninput={(e) =>
                      setModelSmoothing($activeModel?.id, Number(e.currentTarget.value))}
                  />
                </label>
              {/if}
            </div>

            <div class="mi-eval">
              <div class="mi-eval-head">
                <span>Auswertung</span>
              </div>
              <ModelCharts />
            </div>
          </div>
        {:else}
          <div class="mi-empty">
            Wähle links ein Modell aus oder trainiere ein neues, um es hier zu testen.
          </div>
        {/if}
      {/if}
    </div>
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

      <!-- Hover preview: the thumb under the cursor, blown up over the video.
           Cropped to the region, so what you inspect is what the model gets. -->
      {#if previewSrc}
        <div class="thumb-preview" aria-hidden="true">
          <div
            class="crop preview-crop"
            style="width: {previewCrop.w}px; aspect-ratio: {previewCrop.w} / {previewCrop.h};"
          >
            <img src={previewSrc} alt="" style={roiCropStyle(effectiveRoi)} />
          </div>
        </div>
      {/if}

      <!-- The region for the next model lives in the camera, always drawn and
           always draggable: there is nowhere else it could be judged, and a mode
           to enter and leave only hid what the model is about to be fed. -->
      {#if !isPose}
        <div class="roi-container" style="aspect-ratio: {videoAspect};" bind:this={roiContainer}>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="roi-rect"
            role="region"
            aria-label="Trainingsbereich"
            style="left:{editRoi.x * 100}%; top:{editRoi.y * 100}%; width:{editRoi.w * 100}%; height:{editRoi.h * 100}%;"
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
          <button type="button" class="roi-btn" onclick={resetRoi}>Bereich zurücksetzen</button>
          <span class="roi-readout">
            {roiSizeLabel(shownRoi)} · {previewCrop.w}×{previewCrop.h} px
          </span>
          <!-- Not a warning: the crop is upscaled, which training and testing do
               alike. Only worth knowing while sizing the box. -->
          {#if roiBelowInput}
            <span class="roi-note" title="Kleiner als die Modellauflösung von {MODEL_INPUT} px">
              wird hochskaliert
            </span>
          {/if}
          <span class="roi-note">Shift = frei formen</span>
        </div>
      {/if}
    </div>

    <div class="prep-classes">
      <div class="prep-classes-head">
        <span>Klassen &amp; Bilder</span>
        <span class="hint">
          {#if $draftRoi}werden im festgelegten Bereich trainiert{:else}werden mit dem ganzen Bild trainiert{/if}
        </span>
      </div>
      {#each $classes as cls (cls)}
        {@const imgs = [...($examples[cls] ?? [])]}
        {@const layout = stackLayout(imgs.length)}
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
              <!-- The cover, right where the class is named — the one place it is
                   worth checking that the right picture stands for the class. -->
              {#if $classThumbs[cls]}
                <img class="prep-class-thumb" src={$classThumbs[cls]} alt="" />
              {/if}
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
                <DropdownItem onclick={() => (thumbPickClass = cls)}>Klassenbild wählen</DropdownItem>
                <DropdownItem onclick={() => downloadClassImages(cls, imgs)}>Dateien herunterladen</DropdownItem>
                <DropdownItem onclick={() => confirmClear(cls)}>Klasse leeren</DropdownItem>
                <DropdownItem onclick={() => confirmDelete(cls)}>Klasse löschen</DropdownItem>
              {/snippet}
            </Dropdown>
          </div>

          {#if selectionClass === cls && selectedIdx.size}
            <div class="sel-bar">
              <span class="sel-count">{selectedIdx.size} ausgewählt</span>
              <button type="button" class="sel-btn danger" onclick={deleteSelected}>Löschen</button>
              <button type="button" class="sel-btn" onclick={clearSelection}>Abbrechen</button>
            </div>
          {/if}

          <div class="prep-thumbs-row">
            <div
              class="thumb-stack"
              class:empty={!imgs.length}
              class:selecting={selectionClass === cls && selectedIdx.size > 0}
              class:dragging={thumbDrag?.cls === cls}
              style="--offset: {layout.offset}px; --pad: {layout.pad}px; --n: {imgs.length - layout.start};"
              role="group"
              aria-label="Bilder von {cls}"
              bind:clientWidth={stackWidth}
              onpointerenter={() => (hoveredStack = cls)}
              onpointerleave={() => {
                hoveredStack = null;
                // A drag that runs off the stack keeps its preview and its
                // fanned-out thumbs until the pointer is actually released.
                if (!thumbDrag) previewSrc = null;
              }}
            >
              {#if imgs.length}
                {#if layout.hidden}
                  <span class="stack-more" title="{layout.hidden} ältere Bilder">+{layout.hidden}</span>
                {/if}
                {#each imgs.slice(layout.start) as ex, vi (cls + '_' + (layout.start + vi))}
                  {@const i = layout.start + vi}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="stack-item"
                    class:selected={selectionClass === cls && selectedIdx.has(i)}
                    style="--i: {vi};"
                    role="button"
                    tabindex="0"
                    aria-label="Bild {i + 1} löschen"
                    title="Klick löscht · ziehen wählt mehrere aus"
                    onpointerdown={(e) => onThumbPointerDown(cls, i, e)}
                    onpointerenter={() => onThumbPointerEnter(cls, i, ex.data)}
                    onkeydown={(e) => onThumbKey(cls, i, e)}
                  >
                    <div class="crop">
                      <img src={ex.data} alt="" draggable="false" style={roiCropStyle(effectiveRoi)} />
                    </div>
                    <span class="thumb-badge" aria-hidden="true">
                      {selectionClass === cls && selectedIdx.has(i) ? '✓' : '✕'}
                    </span>
                  </div>
                {/each}
              {:else}
                <div class="prep-class-empty">Keine Bilder</div>
              {/if}
            </div>
            <Dropdown triggerMode={'hover'} styling={'basic'}>
              {#snippet trigger()}
                <button
                  type="button"
                  class="record-btn"
                  class:recording={capturingClass === cls || advancedRunningClass === cls}
                  class:cancel={advancedRunningClass === cls}
                  aria-label={advancedRunningClass === cls ? 'Serienaufnahme abbrechen' : 'Bild aufnehmen'}
                  title={advancedRunningClass === cls ? 'Klicken zum Abbrechen' : 'Halten zum Aufnehmen'}
                  disabled={!!advancedRunningClass && advancedRunningClass !== cls}
                  onpointerdown={(e) => {
                    // While a series is running for this class the button is a
                    // cancel button — don't start a manual capture on top of it.
                    if (advancedRunningClass === cls) { cancelAdvanced(); return; }
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    startRecord(cls);
                  }}
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
              {/snippet}
              {advancedRunningClass === cls ? 'Klicken zum Abbrechen' : 'Halten zum Aufnehmen'}
            </Dropdown>
            <Dropdown minWidth="260px" closeOnClick={false}>
              {#snippet trigger()}
                <Button variant="ghost" size="small" aria-label="Erweiterte Aufnahme" title="Erweiterte Aufnahme">Serie</Button>
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

      <!-- Placeholder row: not a class yet (hence the dimming), but recording
           from here works right away and creates it on the first frame. -->
      <div class="prep-class ghost" class:armed={!!newClassName.trim()}>
        <div class="prep-class-head">
          <input
            class="new-class-input"
            type="text"
            placeholder="Neue Klasse hinzufügen"
            aria-label="Neue Klasse hinzufügen"
            bind:value={newClassName}
            onkeydown={onNewClassKey}
            onblur={onNewClassBlur}
          />
        </div>

        <div class="prep-thumbs-row">
          <div class="thumb-stack empty">
            <span class="ghost-note">
              {#if newClassName.trim()}
                Enter legt „{pendingClassName}“ an
              {:else}
                Aufnahme legt „{pendingClassName}“ an
              {/if}
            </span>
          </div>
          <Dropdown triggerMode={'hover'} styling={'basic'}>
            {#snippet trigger()}
              <button
                type="button"
                class="record-btn"
                class:recording={ghostRecording}
                aria-label="Neue Klasse aufnehmen"
                title="Halten zum Aufnehmen"
                disabled={!!advancedRunningClass}
                onpointerdown={startGhostRecord}
                onpointerup={stopGhostRecord}
                onpointercancel={stopGhostRecord}
              >
                <span class="record-dot"></span>
              </button>
            {/snippet}
            Halten zum Aufnehmen — legt die Klasse an
          </Dropdown>
          <Dropdown minWidth="260px" closeOnClick={false}>
            {#snippet trigger()}
              <Button variant="ghost" size="small" aria-label="Erweiterte Aufnahme" title="Erweiterte Aufnahme">Serie</Button>
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
                  {#if advancedRunningClass}
                    <button class="adv-btn danger" type="button" onclick={cancelAdvanced}>Abbrechen</button>
                  {:else}
                    <button
                      class="adv-btn primary"
                      type="button"
                      onclick={() => startAdvanced(commitNewClass())}
                    >Start</button>
                  {/if}
                </div>
              </div>
            {/snippet}
          </Dropdown>
        </div>
      </div>
    </div>
  </div>
</div>

<ModelDetailsModal bind:isOpen={detailsOpen} />

<DeleteConfirmDialog
  target={pendingDelete}
  onconfirm={runDelete}
  oncancel={() => (pendingDelete = null)}
/>

<ClassThumbDialog
  open={!!thumbPickClass}
  className={thumbPickClass ?? ''}
  images={thumbPickClass ? ($examples[thumbPickClass] ?? []) : []}
  current={thumbPickClass ? $classThumbs[thumbPickClass] : undefined}
  onclose={() => (thumbPickClass = null)}
/>

<style lang="scss">
  // Nothing in the column has a frame anymore, so it also has no gaps: the video
  // starts at the pane's top edge and the band below it meets it flush.
  .right-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  // ----- Test view -----
  // Same two-part shape as the prep view: video on top, the panel below holds
  // what the current context is about — there the classes you record, here the
  // model you are testing.
  .test-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    &.hidden { display: none; }
  }
  .test-video {
    flex: 1 1 auto;
    min-height: 160px;
  }
  .model-info {
    // Takes what it needs, gives space back to the video when it gets tight.
    // It carries the classes and the curves — the run's numbers live in the
    // details modal — and scrolls once it hits the cap.
    flex: 0 1 auto;
    max-height: 62%;
    overflow-y: auto;
    // A full-width band below the video rather than a card — the pane's content
    // has no frames of its own.
    background: rgba(var(--md-surface-variant), 0.3);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    &.hidden { display: none; }
  }
  .model-info-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    .mi-title {
      flex-shrink: 0;
    }
    .hint {
      min-width: 0;
      font-size: 11px;
      font-weight: 400;
      color: rgb(var(--md-on-surface-variant));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mi-head-actions {
      margin-left: auto;
      flex-shrink: 0;
    }
  }
  // Classes on the left, the evaluation on the right; wraps to one column when
  // the camera pane is dragged narrow.
  .mi-main {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-start;
  }
  .mi-classes {
    // Wide enough that the raw-value track stays draggable when the mapping is
    // open, which is the narrowest this column may usefully get.
    flex: 1 1 240px;
    min-width: 220px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mi-eval {
    flex: 2 1 320px;
    min-width: 280px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mi-eval-head {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(var(--md-on-surface-variant));
  }
  .mi-classes-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(var(--md-on-surface-variant));
    margin-bottom: 2px;
    .hint {
      text-transform: none;
      letter-spacing: 0;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
    }
  }
  // A text button, not a framed one: it only reveals the second track and should
  // not compete with the class names next to it.
  .mi-link {
    margin-left: auto;
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    text-transform: none;
    letter-spacing: 0;
    color: rgb(var(--md-primary));
    cursor: pointer;
    &:hover { text-decoration: underline; }
  }
  .mi-class {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    padding: 4px 8px 5px;
    border-radius: var(--md-radius-sm);
    background: rgba(var(--md-surface-variant), 0.4);
    .mi-class-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .mi-class-name {
      font-weight: 600;
      color: rgb(var(--md-on-surface));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mi-class-count {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      color: rgb(var(--md-on-surface-variant));
    }
    .mi-class-pct {
      margin-left: auto;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
    }
    // The mapped score. The threshold is the same for every class, so the mark
    // sits in the same place on every bar and reads as one line down the list.
    .mi-bar {
      position: relative;
      height: 4px;
      border-radius: 2px;
      background: rgba(var(--md-outline-variant), 0.8);
    }
    .mi-bar-fill {
      display: block;
      height: 100%;
      border-radius: 2px;
      background: rgb(var(--md-outline));
      transition: width 0.15s;
    }
    .mi-bar-thr {
      position: absolute;
      top: -2px;
      bottom: -2px;
      width: 1px;
      background: rgb(var(--md-on-surface-variant));
    }
    &.detected {
      .mi-class-name { color: rgb(var(--md-primary)); }
      .mi-class-pct { color: rgb(var(--md-primary)); }
      .mi-bar-fill { background: rgb(var(--md-primary)); }
    }
    // The raw-value track. Its scale is the model's own output rather than the
    // mapped one above it, so it stays visually apart: inset, thinner, and only
    // present while the windows are being set.
    .mi-map {
      margin: 5px 2px 1px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .raw-track {
      position: relative;
      height: 4px;
      border-radius: 2px;
      background: rgba(var(--md-outline-variant), 0.5);
      touch-action: none;
    }
    .raw-window {
      position: absolute;
      top: 0;
      bottom: 0;
      border-radius: 2px;
      background: rgba(var(--md-primary), 0.3);
      pointer-events: none;
    }
    .raw-marker {
      position: absolute;
      top: -3px;
      bottom: -3px;
      width: 1px;
      background: rgb(var(--md-on-surface));
      transform: translateX(-50%);
      pointer-events: none;
    }
    .raw-trigger {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: rgb(var(--md-primary));
      transform: translateX(-50%);
    }
    .raw-handle {
      position: absolute;
      top: -5px;
      width: 8px;
      height: 14px;
      margin-left: -4px;
      padding: 0;
      border: 1px solid rgb(var(--md-outline));
      border-radius: 2px;
      background: rgb(var(--md-surface));
      cursor: ew-resize;
      touch-action: none;
      outline: none;
      &:focus-visible { box-shadow: 0 0 0 2px rgb(var(--md-primary)); }
    }
    .mi-map-legend {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      margin-top: 6px;
      font-size: 9px;
      font-variant-numeric: tabular-nums;
      color: rgb(var(--md-on-surface-variant));
      .mi-map-now { color: rgb(var(--md-on-surface)); }
    }
  }
  // The two halves of the tuning mode name themselves, so the switch above can
  // stay generic: this one introduces the per-class tracks that follow.
  .mi-tune-intro {
    margin: 2px 0 4px;
    font-size: 10px;
    line-height: 1.4;
    color: rgb(var(--md-on-surface-variant));
    strong { color: rgb(var(--md-on-surface)); }
  }
  .mi-tune-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    font-size: 10px;
    color: rgb(var(--md-on-surface-variant));
    .mi-tune-label {
      flex: 0 1 auto;
      strong { color: rgb(var(--md-on-surface)); }
    }
    input[type='range'] {
      flex: 1 1 60px;
      min-width: 60px;
      accent-color: rgb(var(--md-primary));
    }
  }
  .mi-map-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
    font-size: 10px;
    color: rgb(var(--md-on-surface-variant));
    .mi-map-buttons {
      display: flex;
      gap: 6px;
    }
    button {
      flex: 1;
      font-size: 10px;
      padding: 3px 6px;
      border: 1px solid rgb(var(--md-outline-variant));
      border-radius: var(--md-radius-sm);
      background: transparent;
      color: rgb(var(--md-on-surface-variant));
      cursor: pointer;
      &:hover:not(:disabled) { color: rgb(var(--md-on-surface)); }
      &:disabled { opacity: 0.5; cursor: default; }
    }
  }
  .mi-empty {
    font-size: 12px;
    font-style: italic;
    color: rgb(var(--md-on-surface-variant));
    padding: 6px 2px;
  }

  // ----- Prep view -----
  .prep-view {
    flex: 1;
    display: flex;
    flex-direction: column;
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
    &.primary {
      background: rgb(var(--md-primary));
      border-color: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
      font-weight: 600;
      &:hover { background: rgb(var(--md-primary)); filter: brightness(0.95); }
    }
  }
  .roi-readout {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    padding: 3px 8px;
    border-radius: 999px;
    backdrop-filter: blur(6px);
    white-space: nowrap;
  }
  // Quieter than the readout: these state a consequence, not a measurement.
  .roi-note {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.75);
    background: rgba(0, 0, 0, 0.4);
    padding: 3px 8px;
    border-radius: 999px;
    backdrop-filter: blur(6px);
    white-space: nowrap;
  }
  .prep-classes {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    // Same full-width band as .model-info in the test view.
    background: rgba(var(--md-surface-variant), 0.3);
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
  // The name sits close to the images it belongs to — the air between classes
  // (.prep-classes' own gap) is what separates one stack from the next.
  .prep-class {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .prep-class-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    .prep-class-thumb {
    width: 26px;
    height: 26px;
    border-radius: var(--md-radius-sm);
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(var(--md-surface-variant), 0.6);
  }
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
  // Window onto the region of a stored capture: the image is positioned by
  // roiCropStyle() so that only the region shows. The flip lives here rather
  // than on the image because mirroring the image would slide the window over
  // to the opposite side of the frame — see $lib/roi. It also has to sit on the
  // box and not on .stack-item, whose transform is already spoken for by the
  // hover pop-out.
  .crop {
    position: relative;
    overflow: hidden;
    background: #000;
    transform: scaleX(var(--cam-mirror));
    // Purely a viewport: every gesture on a thumb (click-delete, drag-select) is
    // handled by .stack-item, and pointerenter only reaches it from a descendant
    // if nothing in between claims the event.
    pointer-events: none;
    img {
      position: absolute;
      display: block;
      max-width: none;
    }
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
    // --offset/--pad/--n come from stackLayout(): the row is laid out from its
    // newest image backwards, so a fresh capture is never the one that falls off.
    --offset: 14px;
    --pad: 0px;
    &.empty { display: flex; align-items: center; }
  }
  // How many older images had to leave the row to keep the newest ones in it.
  .stack-more {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: rgb(var(--md-on-surface-variant));
    background: rgba(var(--md-surface-variant), 0.7);
    padding: 2px 6px;
    border-radius: 99px;
    pointer-events: none;
  }
  .stack-item {
    position: absolute;
    top: 0;
    left: calc(var(--pad) + var(--i) * var(--offset));
    width: var(--thumb);
    height: var(--thumb);
    border-radius: 4px;
    background: #000;
    border: 2px solid rgb(var(--md-surface));
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    z-index: calc(var(--i) + 1);
    transition: left 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
                transform 0.2s ease,
                box-shadow 0.2s ease,
                border-color 0.15s ease;
    cursor: pointer;
    box-sizing: border-box;
    overflow: visible;
    outline: none;
    touch-action: none;
    // Drag-select must not start a text/image selection.
    user-select: none;
    -webkit-user-select: none;
    .crop {
      width: 100%;
      height: 100%;
      border-radius: 2px;
    }
    img {
      transition: filter 0.15s ease;
    }
  }
  // On hover of the stack, fan images farther apart so you can glimpse each one.
  // Spread is capped by container width to avoid overflow. A running drag-select
  // holds the fan open even after the pointer wanders off the stack — collapsing
  // mid-gesture would pull the thumbs out from under the selection.
  .thumb-stack:hover .stack-item,
  .thumb-stack.dragging .stack-item {
    left: calc(
      var(--pad) + var(--i) *
      min(var(--thumb), (100% - var(--pad) - var(--thumb)) / max(var(--n) - 1, 1))
    );
  }
  .stack-item:hover,
  .stack-item:focus-visible {
    transform: translateY(-8px) scale(1.1);
    z-index: 999;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }
  // Click deletes: hovering tints the thumb red and reveals the ✕ badge.
  .thumb-stack:not(.selecting) .stack-item:hover,
  .thumb-stack:not(.selecting) .stack-item:focus-visible {
    border-color: #e53935;
    img { filter: brightness(0.55) saturate(0.6) sepia(0.35) hue-rotate(-30deg); }
    .thumb-badge { opacity: 1; transform: scale(1); }
  }
  .stack-item.selected {
    border-color: rgb(var(--md-primary));
    box-shadow: 0 0 0 2px rgba(var(--md-primary), 0.45);
    img { filter: brightness(1.05); }
    .thumb-badge {
      opacity: 1;
      transform: scale(1);
      background: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
    }
  }
  .thumb-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #e53935;
    color: #fff;
    font-size: 11px;
    line-height: 1;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.6);
    transition: opacity 0.15s ease, transform 0.15s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .sel-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    .sel-count {
      font-weight: 600;
      color: rgb(var(--md-on-surface));
    }
  }
  .sel-btn {
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid rgb(var(--md-outline-variant));
    background: transparent;
    color: rgb(var(--md-on-surface-variant));
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    min-height: unset;
    box-shadow: none;
    &:hover { background: rgba(var(--md-on-surface), 0.08); }
    &.danger {
      border-color: #ef4444;
      color: #ef4444;
      font-weight: 600;
      &:hover { background: rgba(239, 68, 68, 0.12); }
    }
  }
  // Blown-up thumb over the prep video while a thumbnail is hovered.
  .thumb-preview {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(6px);
    pointer-events: none;
    // Sized in pixels from previewCrop, so the region shows at its own
    // resolution instead of being blown up past the detail it holds. The caps
    // keep it inside the video on small panels or wide regions.
    .preview-crop {
      box-sizing: border-box;
      max-width: 94%;
      max-height: 94%;
      border-radius: var(--md-radius-md);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
      border: 2px solid rgba(255, 255, 255, 0.35);
    }
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
    // Series running: the button becomes a stop/cancel button.
    &.cancel {
      border-color: #f5a54c;
      background: rgba(245, 165, 76, 0.2);
      .record-dot {
        border-radius: 3px;
        width: 16px;
        height: 16px;
        animation: none;
      }
      &:hover { border-color: #e53935; background: rgba(229, 57, 53, 0.2); }
    }
  }
  @keyframes recordPulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(0.85); opacity: 0.7; }
  }
  // The row below the last class is a class that does not exist yet: it carries
  // the same controls, dimmed, and firms up as soon as it is named or recorded.
  .prep-class.ghost {
    padding: 6px 8px;
    border: 1px dashed rgba(var(--md-outline), 0.7);
    border-radius: var(--md-radius-md);
    opacity: 0.55;
    transition: opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    &:hover,
    &:focus-within,
    &.armed {
      opacity: 1;
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary-container), 0.25);
    }
  }
  .new-class-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 2px 4px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    &:focus {
      outline: none;
      border: none;
    }
  }
  .ghost-note {
    font-size: 11px;
    font-style: italic;
    color: rgb(var(--md-on-surface-variant));
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
  // No frame of its own: the video runs edge to edge and straight into the
  // corners, and the only rounding it shows is the one the pane clips it with.
  .video-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    &.hidden { display: none; }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      transform: scaleX(var(--cam-mirror));
      position: relative;
      z-index: 1;
    }
    video.bg {
      position: absolute;
      inset: 0;
      object-fit: cover;
      transform: scale(1.1) scaleX(var(--cam-mirror));
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
      transform: scaleX(var(--cam-mirror));
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
