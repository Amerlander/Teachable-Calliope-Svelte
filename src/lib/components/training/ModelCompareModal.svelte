<script lang="ts">
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CompareChart from './CompareChart.svelte';
  import { examples, setVideoRef, videoRefs } from '$lib/stores';
  import { cachedConfusion } from '$lib/confusion';
  import { isComparing } from '$lib/stores/app';
  import { cameraMirror, selectedCameraId } from '$lib/stores/camera';
  import { currentProject, type TrainedModel } from '$lib/stores/projects';
  import {
    captureFrameFromVideo,
    drawPoseSkeleton,
    estimatePose,
    initSharedCamera,
    loadPoseDetector
  } from '$lib/machine';
  import { drawPoseOverlay } from '$lib/poseOverlay';
  import {
    COMPARE_COLORS,
    disposeComparison,
    loadComparison,
    predictAll,
    runOverExamples,
    unionClasses,
    type CompareEntry,
    type ModelPrediction,
    type TestRunResult
  } from '$lib/compare';
  import RoiOverlay from '$lib/components/RoiOverlay.svelte';
  import { CLASS_THRESHOLD } from '$lib/calibration';
  import { activateModel, modelLabel } from '$lib/models';
  import { showNotification } from '$lib/stores/notifications';
  import { EXTRACTOR_LABELS, OPTIMIZER_LABELS, bytes, dec } from '$lib/modelInsights';

  // Several models, one picture. The columns are the models and the rows are
  // everything that can be said about them side by side — what they see right
  // now, what they scored, and how they were set up. The camera above belongs
  // to all of them: every frame goes through every model, so the percentages in
  // a row describe the same moment and can honestly be read against each other.
  let {
    isOpen = $bindable(false),
    models = []
  }: { isOpen?: boolean; models?: TrainedModel[] } = $props();

  type Source = 'live' | 'examples' | 'saved';

  let entries = $state<CompareEntry[]>([]);
  /**
   * The same list as `entries`, kept as a plain variable: the teardown below has
   * to free the classifiers and must not read reactive state to find them.
   */
  let loadedEntries: CompareEntry[] = [];
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  let source = $state<Source>('live');
  let predictions = $state<ModelPrediction[]>([]);
  /** Rolling per-model average of what one image costs — a single frame is noise. */
  let msByModel = $state<Record<string, number>>({});
  /** What one picture costs with all of them together, embedding shared. */
  let tickMs = $state<number | null>(null);
  /** Whether all models named the same class, for the last hundred frames. */
  let agreeWindow = $state<boolean[]>([]);
  let referenceId = $state<string | null>(null);
  let diffOnly = $state(false);

  let videoEl = $state<HTMLVideoElement | null>(null);
  /**
   * Two canvases, on purpose — see $lib/poseOverlay. `poseCanvas` is the square,
   * black-backed frame the models are fed and stays offscreen; `overlayCanvas` is
   * the transparent one drawn over the camera for the user.
   */
  let poseCanvas = $state<HTMLCanvasElement | null>(null);
  let overlayCanvas = $state<HTMLCanvasElement | null>(null);
  /** The camera's own shape, so the region outlines can track the letterboxed picture. */
  let videoAspect = $state(4 / 3);
  /**
   * A still standing in for the live feed — a frozen frame, a remembered one, or
   * one picked from the images the models disagreed on. It is shown in the
   * camera box and it is what the columns are predicting, so what is on screen
   * and what the numbers describe can never come apart.
   */
  let stillSrc = $state<string | null>(null);
  let stillImage: HTMLImageElement | null = null;
  let savedFrames = $state<string[]>([]);

  let testRun = $state<TestRunResult | null>(null);
  let testRunning = $state(false);
  let testProgress = $state({ done: 0, total: 0 });
  let stopRequested = false;

  const project = $derived($currentProject);
  const isPose = $derived(project?.mode === 'pose');
  const classRows = $derived(unionClasses(models));
  const columns = $derived(models.length);
  /**
   * The label rail plus one column per model. Columns keep a floor width rather
   * than being squeezed: past four models the grid runs wider than the dialog
   * and scrolls sideways, which is the only way percentages and bars stay
   * readable.
   */
  const gridStyle = $derived(
    `grid-template-columns: 190px repeat(${columns}, minmax(250px, 1fr));`
  );

  // ---------- Scrolling the columns ----------
  let cmpScroll = $state<HTMLDivElement | null>(null);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);

  function readScroll() {
    const el = cmpScroll;
    if (!el) return;
    canScrollLeft = el.scrollLeft > 4;
    canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
  }

  /** One column further, so paging lands on column edges rather than mid-bar. */
  function page(direction: -1 | 1) {
    const el = cmpScroll;
    if (!el) return;
    const step = Math.max(250, (el.scrollWidth - 190) / Math.max(1, columns));
    el.scrollBy({ left: direction * step, behavior: 'smooth' });
  }

  $effect(() => {
    const el = cmpScroll;
    // Re-measure when a column is added or the dialog is resized.
    void columns;
    if (!el || typeof ResizeObserver === 'undefined') return;
    readScroll();
    const observer = new ResizeObserver(readScroll);
    observer.observe(el);
    return () => observer.disconnect();
  });

  /**
   * True when every model reads the same picture the same way — then the
   * extractor runs once for all of them and a fourth column is nearly free.
   */
  const sharedExtractor = $derived(
    new Set(
      models.map(
        (m) =>
          `${m.featureExtractor ?? m.options.featureExtractor}|${
            m.roi ? `${m.roi.x},${m.roi.y},${m.roi.w},${m.roi.h}` : 'full'
          }`
      )
    ).size === 1
  );

  const reference = $derived(
    models.find((m) => m.id === referenceId) ?? models[0] ?? null
  );

  /**
   * Which models are being compared, as one value. The list itself is rebuilt
   * whenever the project is saved, so an effect keyed on the array would tear
   * down and reload every classifier for a change that never touched them.
   */
  const comparedKey = $derived(models.map((m) => m.id).join('|'));

  // ---------- Loading and tearing down ----------
  $effect(() => {
    if (!isOpen || !comparedKey) return;
    const wanted = untrack(() => models);
    let cancelled = false;
    loading = true;
    loadError = null;
    isComparing.set(true);

    loadComparison(wanted)
      .then((loaded) => {
        if (cancelled) {
          void disposeComparison(loaded);
          return;
        }
        entries = loaded;
        loadedEntries = loaded;
        referenceId = wanted[0]?.id ?? null;
        loading = false;
      })
      .catch((err) => {
        if (cancelled) return;
        loading = false;
        loadError = (err as Error).message || 'Modelle konnten nicht geladen werden';
      });

    return () => {
      cancelled = true;
      stopRequested = true;
      isComparing.set(false);
      const open = loadedEntries;
      loadedEntries = [];
      entries = [];
      predictions = [];
      agreeWindow = [];
      msByModel = {};
      testRun = null;
      tickMs = null;
      stillSrc = null;
      stillImage = null;
      void disposeComparison(open);
    };
  });

  // ---------- The shared camera ----------
  $effect(() => {
    if (!isOpen || !videoEl) return;
    const el = videoEl;
    setVideoRef('webcamCompare', el);
    // The camera is already running behind the overlay; taking its stream keeps
    // it running instead of stopping and re-requesting it, which would drop the
    // feed in the panel underneath for a moment.
    const live = Object.values(get(videoRefs)).find(
      (v) => v && v !== el && v.srcObject
    ) as HTMLVideoElement | undefined;
    if (live?.srcObject) {
      el.srcObject = live.srcObject;
      void el.play().catch(() => {});
    } else {
      void initSharedCamera(get(videoRefs), get(selectedCameraId) ?? undefined);
    }
    if (isPose) void loadPoseDetector();
    const onMeta = () => {
      if (el.videoWidth && el.videoHeight) videoAspect = el.videoWidth / el.videoHeight;
    };
    el.addEventListener('loadedmetadata', onMeta);
    // The stream is usually already running when this box opens, so the event has
    // been and gone — read it now as well as on the next one.
    onMeta();
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      setVideoRef('webcamCompare', null);
    };
  });

  /** What the models are fed: the skeleton in pose projects, else the picture itself. */
  async function sourceForFrame(): Promise<HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | null> {
    const still = stillImage;
    const video = videoEl;
    const base = still ?? (video && video.videoWidth ? video : null);
    if (!base) return null;
    if (!isPose) return base;
    const canvas = poseCanvas;
    if (!canvas) return null;
    const width = still ? still.naturalWidth : video!.videoWidth;
    const height = still ? still.naturalHeight : video!.videoHeight;
    const pose = await estimatePose(base);
    drawPoseSkeleton(canvas, pose, width, height, { size: 512 });
    if (overlayCanvas) {
      // Follows the picture: the skeleton of a mirrored camera has to be
      // mirrored with it, or it lands back to front over the person.
      drawPoseOverlay(overlayCanvas, pose, width, height, { mirror: $cameraMirror });
    }
    return canvas;
  }

  /** Drop the drawn skeleton, so a live picture is never left under a stale one. */
  function clearPoseOverlay() {
    const canvas = overlayCanvas;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }

  let busy = false;
  let liveTimer: ReturnType<typeof setInterval> | null = null;

  async function tick() {
    if (busy || !entries.length) return;
    busy = true;
    try {
      const src = await sourceForFrame();
      if (!src) return;
      const started = performance.now();
      const next = await predictAll(entries, src);
      const elapsed = performance.now() - started;
      tickMs = tickMs == null ? elapsed : tickMs * 0.8 + elapsed * 0.2;
      predictions = next;
      recordTiming(next);
      recordAgreement(next);
    } catch {
      /* a dropped frame is not worth a message; the next tick tries again */
    } finally {
      busy = false;
    }
  }

  function recordTiming(next: ModelPrediction[]) {
    const merged: Record<string, number> = { ...msByModel };
    for (const p of next) {
      const previous = merged[p.modelId];
      merged[p.modelId] = previous == null ? p.ms : previous * 0.8 + p.ms * 0.2;
    }
    msByModel = merged;
  }

  function recordAgreement(next: ModelPrediction[]) {
    if (next.length < 2) return;
    const allAgree = next.every((p) => p.topLabel === next[0].topLabel);
    const window = [...agreeWindow, allAgree];
    agreeWindow = window.length > 100 ? window.slice(-100) : window;
  }

  // The live loop only runs while the live camera is the source and nothing is
  // frozen — a still is predicted once, not sixty times.
  $effect(() => {
    const shouldRun = isOpen && source === 'live' && !stillSrc && entries.length > 0;
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    if (!shouldRun) {
      // A frozen frame keeps its skeleton — it belongs to the picture on screen.
      // A running camera with a stopped loop must not.
      if (!stillSrc) clearPoseOverlay();
      return;
    }
    void tick();
    liveTimer = setInterval(() => void tick(), 200);
    return () => {
      if (liveTimer) clearInterval(liveTimer);
      liveTimer = null;
    };
  });

  async function showStill(src: string) {
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch {
      return;
    }
    stillSrc = src;
    stillImage = img;
    // The live loop may be inside a prediction right now, and `tick` refuses to
    // run twice at once. Waiting for it is the point: without this the columns
    // would keep the last live result while a different picture is on screen.
    for (let i = 0; i < 40 && busy; i++) await new Promise((r) => setTimeout(r, 25));
    await tick();
  }

  function backToLive() {
    stillSrc = null;
    stillImage = null;
  }

  function freeze() {
    const video = videoEl;
    if (!video || !video.videoWidth) return;
    void showStill(captureFrameFromVideo(video));
  }

  function rememberFrame() {
    const video = videoEl;
    if (!video || !video.videoWidth) return;
    const frame = stillSrc ?? captureFrameFromVideo(video);
    if (!savedFrames.includes(frame)) savedFrames = [...savedFrames, frame];
    showNotification('Bild gemerkt', { type: 'success' });
  }

  /** Put an image on screen and into the strip, whatever it was picked from. */
  function pickImage(src: string) {
    if (!savedFrames.includes(src)) savedFrames = [...savedFrames, src];
    source = 'saved';
    void showStill(src);
  }

  // ---------- The whole test set ----------
  async function runTestSet() {
    if (testRunning || !entries.length) return;
    testRunning = true;
    stopRequested = false;
    testRun = null;
    try {
      const result = await runOverExamples(entries, project?.examples ?? {}, {
        confidenceThreshold: CLASS_THRESHOLD,
        onProgress: (done, total) => (testProgress = { done, total }),
        shouldStop: () => stopRequested || !isOpen
      });
      if (!stopRequested) testRun = result;
    } catch (err) {
      showNotification('Durchrechnen fehlgeschlagen: ' + (err as Error).message, { type: 'error' });
    } finally {
      testRunning = false;
    }
  }

  function switchSource(next: Source) {
    source = next;
    if (next === 'live') backToLive();
    if (next === 'saved' && savedFrames.length && !stillSrc) void showStill(savedFrames[0]);
  }

  async function useModel(model: TrainedModel) {
    try {
      await activateModel(model.id);
      showNotification(`„${modelLabel(model)}" ist jetzt das Modell des Projekts`, { type: 'success' });
      isOpen = false;
    } catch (err) {
      showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
    }
  }

  // ---------- Reading the numbers off the models ----------
  function last(values: number[] | undefined): number | null {
    return values?.length ? values[values.length - 1] : null;
  }
  function accuracyOf(m: TrainedModel) { return last(m.history.accuracy); }
  function valAccuracyOf(m: TrainedModel) { return last(m.history.valAccuracy); }
  function lossOf(m: TrainedModel) { return last(m.history.loss); }
  function imagesOf(m: TrainedModel) {
    const total = Object.values(m.exampleCounts).reduce((a, b) => a + b, 0);
    return total || null;
  }
  function sizeOf(m: TrainedModel) {
    return entries.find((e) => e.model.id === m.id)?.sizeBytes ?? m.metadata?.sizeBytes ?? null;
  }
  function msOf(m: TrainedModel) {
    return msByModel[m.id] ?? null;
  }

  /** Which column wins a row, or null when nothing is measured or it is a tie. */
  function bestIndexOf(values: (number | null)[], better: 'high' | 'low'): number | null {
    let bestAt: number | null = null;
    let bestValue = 0;
    let ties = 0;
    values.forEach((v, i) => {
      if (v == null) return;
      if (bestAt === null) {
        bestAt = i;
        bestValue = v;
        ties = 1;
        return;
      }
      const wins = better === 'high' ? v > bestValue : v < bestValue;
      if (wins) {
        bestAt = i;
        bestValue = v;
        ties = 1;
      } else if (v === bestValue) ties++;
    });
    return ties > 1 ? null : bestAt;
  }

  type Row = {
    label: string;
    values: (number | null)[];
    format: (v: number) => string;
    better?: 'high' | 'low';
    /** How the distance to the reference column reads: points, or the plain unit. */
    delta?: 'pp' | 'abs';
    deltaFormat?: (v: number) => string;
    bestLabel?: string;
    hint?: string;
  };

  const pctOf = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
  const countOf = (v: number) => String(Math.round(v));
  const msFormat = (v: number) => `${Math.round(v)} ms`;

  const metricRows = $derived<Row[]>([
    {
      label: 'Genauigkeit',
      values: models.map(accuracyOf),
      format: pctOf,
      better: 'high',
      delta: 'pp',
      bestLabel: 'beste'
    },
    {
      label: 'Geprüfte Genauigkeit',
      values: models.map(valAccuracyOf),
      format: pctOf,
      better: 'high',
      delta: 'pp',
      bestLabel: 'beste',
      hint: 'auf den im Training zurückgehaltenen Bildern'
    },
    {
      label: 'Verlust',
      values: models.map(lossOf),
      format: (v) => dec(v, 3),
      better: 'low',
      delta: 'abs',
      deltaFormat: (v) => dec(v, 3),
      bestLabel: 'beste'
    },
    { label: 'Trainingsbilder', values: models.map(imagesOf), format: countOf, delta: 'abs', deltaFormat: countOf },
    { label: 'Klassen', values: models.map((m) => m.classes.length), format: countOf },
    {
      label: 'Größe',
      values: models.map(sizeOf),
      format: (v) => bytes(v),
      better: 'low',
      bestLabel: 'kleinste',
      hint: 'nur der trainierte Kopf; der Feature-Extraktor kommt für alle dazu'
    },
    {
      label: 'Zeit pro Bild',
      values: models.map(msOf),
      format: msFormat,
      better: 'low',
      bestLabel: 'schnellste',
      hint: 'gemessen, während der Vergleich läuft'
    }
  ]);

  /** Settings are text, and an imported model brings none along — it shows a dash. */
  function settingOf(m: TrainedModel, read: (m: TrainedModel) => string): string {
    return m.source === 'imported' ? '–' : read(m);
  }

  const settingRows = $derived<{ label: string; values: string[] }[]>([
    { label: 'Epochen', values: models.map((m) => settingOf(m, (x) => String(x.history.epochs.length || x.options.epochs))) },
    { label: 'Lernrate', values: models.map((m) => settingOf(m, (x) => String(x.options.learningRate))) },
    { label: 'Batch-Größe', values: models.map((m) => settingOf(m, (x) => String(x.options.batchSize))) },
    { label: 'Hidden Units', values: models.map((m) => settingOf(m, (x) => String(x.options.hiddenUnits))) },
    {
      label: 'Feature-Extraktor',
      values: models.map((m) => EXTRACTOR_LABELS[m.featureExtractor ?? m.options.featureExtractor] ?? '–')
    },
    { label: 'Optimierer', values: models.map((m) => settingOf(m, (x) => OPTIMIZER_LABELS[x.options.optimizer] ?? '–')) },
    { label: 'Dropout', values: models.map((m) => settingOf(m, (x) => String(x.options.dropout))) },
    {
      label: 'Augmentierung',
      values: models.map((m) =>
        settingOf(m, (x) => (x.options.augmentation ? `an · ×${x.options.augmentationSettings?.multiplier ?? 0}` : 'aus'))
      )
    },
    { label: 'Bildbereich', values: models.map((m) => (m.roi ? 'Ausschnitt' : 'ganzes Bild')) }
  ]);

  const shownSettingRows = $derived(
    diffOnly ? settingRows.filter((r) => new Set(r.values).size > 1) : settingRows
  );

  // ---------- What the columns currently say ----------
  function predictionFor(model: TrainedModel): ModelPrediction | null {
    return predictions.find((p) => p.modelId === model.id) ?? null;
  }

  /** The class most of the columns named, or null when they split evenly. */
  const majorityLabel = $derived.by(() => {
    if (predictions.length < 2) return null;
    const counts = new Map<string, number>();
    for (const p of predictions) counts.set(p.topLabel, (counts.get(p.topLabel) ?? 0) + 1);
    let best: string | null = null;
    let bestCount = 0;
    let tied = false;
    for (const [label, count] of counts) {
      if (count > bestCount) {
        best = label;
        bestCount = count;
        tied = false;
      } else if (count === bestCount) tied = true;
    }
    return tied ? null : best;
  });

  const agreeingNow = $derived(
    predictions.length ? predictions.filter((p) => p.topLabel === majorityLabel).length : 0
  );
  const agreementRate = $derived(
    agreeWindow.length ? agreeWindow.filter(Boolean).length / agreeWindow.length : null
  );

  const testResultFor = $derived.by(() => {
    const run = testRun;
    return (model: TrainedModel) => run?.perModel.find((r) => r.modelId === model.id) ?? null;
  });

  /**
   * The matrix to show for a model: this comparison's own run when it has one,
   * otherwise the measurement stored on the model — the details dialog measures
   * the same images the same way, so a model that has been looked at there
   * arrives here with its confusions already known.
   */
  const matrixFor = $derived.by(() => {
    const run = testRun;
    const ex = $examples;
    return (model: TrainedModel): { matrix: number[][]; classes: string[]; samples: number } | null => {
      const own = run?.perModel.find((r) => r.modelId === model.id);
      if (own?.total) return { matrix: own.matrix, classes: own.classes, samples: own.total };
      const stored = cachedConfusion(model, ex);
      return stored ? { matrix: stored.matrix, classes: stored.classes, samples: stored.samples } : null;
    };
  });

  const anyMatrix = $derived(models.some((m) => matrixFor(m)));

  /** The pair a model mixes up most, once a matrix for it exists. */
  function worstPairOf(model: TrainedModel): string | null {
    const result = matrixFor(model);
    if (!result) return null;
    let worst = { count: 0, from: '', to: '' };
    result.matrix.forEach((row, i) =>
      row.forEach((count, j) => {
        if (i !== j && count > worst.count) {
          worst = { count, from: result.classes[i], to: result.classes[j] };
        }
      })
    );
    return worst.count ? `${worst.from} → ${worst.to} (${worst.count})` : 'keine';
  }

  const bestByAccuracy = $derived.by(() => {
    const at = bestIndexOf(models.map(accuracyOf), 'high');
    return at == null ? null : models[at];
  });
  const bestBySize = $derived.by(() => {
    const at = bestIndexOf(models.map(sizeOf), 'low');
    return at == null ? null : models[at];
  });

  function deltaText(row: Row, value: number | null, index: number): string | null {
    if (!row.delta || value == null || !reference) return null;
    const refIndex = models.findIndex((m) => m.id === reference.id);
    if (refIndex === index) return 'Referenz';
    const refValue = row.values[refIndex];
    if (refValue == null) return null;
    const diff = value - refValue;
    if (Math.abs(diff) < 1e-9) return 'gleich';
    const arrow = diff > 0 ? '▲' : '▼';
    const size = Math.abs(diff);
    if (row.delta === 'pp') return `${arrow} ${(size * 100).toFixed(1).replace('.', ',')} pp`;
    return `${arrow} ${(row.deltaFormat ?? row.format)(size)}`;
  }

  function shade(value: number, peak: number, diagonal: boolean): string {
    const strength = peak > 0 ? value / peak : 0;
    const alpha = diagonal ? 0.08 + 0.9 * strength : 0.04 + 0.5 * strength;
    return `background: rgba(28, 27, 31, ${alpha.toFixed(2)})`;
  }
  function peakOf(matrix: number[][]): number {
    return Math.max(1, ...matrix.flat());
  }
  function shortLabel(label: string): string {
    return label.length > 4 ? label.slice(0, 3) + '.' : label;
  }
</script>

<Modal {isOpen} title="Modelle vergleichen" size="wide" flush onclose={() => (isOpen = false)}>
  {#snippet subtitle()}
    <span>{models.length} Modelle</span>
    · <span>alle sehen dasselbe Bild</span>
    {#if models.length && new Set(models.flatMap((m) => m.classes)).size !== models[0].classes.length}
      · <span class="chip muted">Klassen weichen ab</span>
    {/if}
  {/snippet}

  {#snippet children()}
    <div class="compare-body">
      {#if loading}
        <div class="state">Modelle werden geladen…</div>
      {:else if loadError}
        <div class="state error">{loadError}</div>
      {:else}
        <!-- ---------- one camera for all of them ---------- -->
        <div class="source-band">
          <div class="cam" class:pose={isPose}>
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={videoEl} autoplay playsinline muted class:hidden={!!stillSrc}></video>
            {#if stillSrc}
              <img class="still" src={stillSrc} alt="Das Bild, das alle Modelle gerade bewerten" />
            {/if}
            {#if isPose}
              <canvas bind:this={overlayCanvas} class="pose-overlay"></canvas>
            {:else}
              <!-- Every model's image region, in the colour of its column. They
                   differ from model to model, and a comparison that hides them
                   invites reading a difference in the numbers as a difference in
                   the model when it was a difference in what each one was shown. -->
              {#each models as model, i (model.id)}
                <RoiOverlay
                  roi={model.roi}
                  aspect={videoAspect}
                  color={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                  label={models.length > 1 ? modelLabel(model) : null}
                  title={`Bildbereich von ${modelLabel(model)}`}
                />
              {/each}
            {/if}
            <div class="cam-tag" class:paused={!!stillSrc}>
              <span class="live-dot"></span>{stillSrc ? 'Standbild' : 'live'}
            </div>
            <div class="cam-foot">
              {#if stillSrc}
                <button type="button" class="mini" onclick={() => switchSource('live')}>▶ Weiter</button>
              {:else}
                <button type="button" class="mini" onclick={freeze}>⏸ Einfrieren</button>
              {/if}
              <button type="button" class="mini" onclick={rememberFrame}>＋ Bild merken</button>
            </div>
          </div>

          <!-- Never shown: the square frame predictAll classifies. -->
          {#if isPose}
            <canvas bind:this={poseCanvas} width="512" height="512" class="offscreen"></canvas>
          {/if}

          <div class="src-right">
            <div class="src-line">
              <span class="src-label">Quelle</span>
              <div class="seg">
                <button type="button" class:on={source === 'live'} onclick={() => switchSource('live')}>
                  Live-Kamera
                </button>
                <button type="button" class:on={source === 'examples'} onclick={() => switchSource('examples')}>
                  Testbilder
                </button>
                <button
                  type="button"
                  class:on={source === 'saved'}
                  disabled={!savedFrames.length}
                  onclick={() => switchSource('saved')}
                >
                  Gemerkte Bilder ({savedFrames.length})
                </button>
              </div>
            </div>

            {#if source === 'examples'}
              <div class="facts">
                <div class="fact">
                  <div class="f-label">Aufgenommene Bilder</div>
                  <div class="f-value">{testProgress.total || Object.values(project?.examples ?? {}).reduce((a, b) => a + b.length, 0)}</div>
                  <div class="f-sub">aus diesem Projekt</div>
                </div>
                <div class="fact">
                  <div class="f-label">Alle einig</div>
                  <div class="f-value">{testRun ? testRun.agreed : '–'}</div>
                  {#if testRun}
                    <div class="f-sub">{Math.round((testRun.agreed / Math.max(1, testRun.images)) * 100)} % der Bilder</div>
                    <div class="meter"><span style="width:{(testRun.agreed / Math.max(1, testRun.images)) * 100}%"></span></div>
                  {/if}
                </div>
                <div class="fact">
                  <div class="f-label">Uneinig</div>
                  <div class="f-value">{testRun ? testRun.images - testRun.agreed : '–'}</div>
                  <div class="f-sub">unten zum Durchsehen</div>
                </div>
              </div>
              <div class="src-line">
                <Button size="small" onclick={runTestSet} disabled={testRunning}>
                  {testRunning ? 'Rechnet…' : testRun ? 'Neu durchrechnen' : 'Durchrechnen'}
                </Button>
                {#if testRunning}
                  <span class="hint">{testProgress.done} / {testProgress.total}</span>
                  <div class="meter grow">
                    <span style="width:{(testProgress.done / Math.max(1, testProgress.total)) * 100}%"></span>
                  </div>
                  <button type="button" class="link" onclick={() => (stopRequested = true)}>Abbrechen</button>
                {/if}
              </div>
              <p class="src-note">
                Beim Live-Bild siehst du ein Bild. Hier laufen alle aufgenommenen Bilder durch jedes Modell — das ist
                der fairere Vergleich, weil alle dieselben Bilder bekommen. Es sind allerdings die Bilder, mit denen
                trainiert wurde: an der Kamera sind die Zahlen meist schlechter.
              </p>
            {:else}
              <div class="facts">
                <div class="fact">
                  <div class="f-label">Einig gerade</div>
                  <div class="f-value">{agreeingNow} von {models.length}</div>
                  <div class="f-sub">{majorityLabel ?? 'kein gemeinsames Ergebnis'}</div>
                </div>
                <div class="fact">
                  <div class="f-label">Einigkeit (letzte {agreeWindow.length} Bilder)</div>
                  <div class="f-value">{agreementRate == null ? '–' : `${Math.round(agreementRate * 100)} %`}</div>
                  {#if agreementRate != null}
                    <div class="meter"><span style="width:{agreementRate * 100}%"></span></div>
                  {/if}
                </div>
                <div class="fact">
                  <div class="f-label">Rechenzeit</div>
                  <div class="f-value">{tickMs == null ? '–' : `${Math.round(tickMs)} ms`}</div>
                  <div class="f-sub">
                    {models.length} Modelle zusammen{sharedExtractor ? ', ein Durchlauf' : ''}
                  </div>
                </div>
              </div>
              <p class="src-note">
                Jedes Bild der Kamera läuft durch alle Modelle, die Prozentwerte unten gehören also zum selben Moment.
                „Einfrieren" hält ein Bild an, „Bild merken" legt es zur Seite.
              </p>
            {/if}

            {#if savedFrames.length}
              <div class="saved-strip">
                {#each savedFrames as frame, i (frame)}
                  <button
                    type="button"
                    class="saved-thumb"
                    class:on={stillSrc === frame}
                    onclick={() => pickImage(frame)}
                    aria-label={`Gemerktes Bild ${i + 1}`}
                  >
                    <img src={frame} alt="" />
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <!-- ---------- the columns ---------- -->
        <div class="cmp-wrap">
          <!-- The lanes span the whole grid so the buttons can stay in view
               while it is scrolled up and down, not only at its top edge. -->
          {#if canScrollLeft}
            <div class="pager-lane left">
              <button type="button" class="pager" onclick={() => page(-1)} aria-label="Spalten nach links">‹</button>
            </div>
          {/if}
          {#if canScrollRight}
            <div class="pager-lane right">
              <button type="button" class="pager" onclick={() => page(1)} aria-label="Spalten nach rechts">›</button>
            </div>
          {/if}
          <div class="cmp-scroll" bind:this={cmpScroll} onscroll={readScroll}>
        <div class="cmp" style={gridStyle}>
          <div class="rail head-rail"></div>
          {#each models as model, i (model.id)}
            <div class="chead sep">
              <div class="ch-top">
                <span class="dot" style="background:{COMPARE_COLORS[i % COMPARE_COLORS.length]}"></span>
                <span class="ch-name" title={modelLabel(model)}>{modelLabel(model)}</span>
              </div>
              <div class="ch-meta">{new Date(model.trainedAt).toLocaleString('de-DE')}</div>
              <div class="ch-chips">
                {#if model.id === project?.currentModelId}<span class="chip">aktiv</span>{/if}
                {#if model.source === 'imported'}<span class="chip muted">importiert</span>{/if}
                <button
                  type="button"
                  class="chip outline"
                  class:on={reference?.id === model.id}
                  onclick={() => (referenceId = model.id)}
                  title="Die anderen Spalten zeigen ihren Abstand zu diesem Modell"
                >
                  {reference?.id === model.id ? 'Referenz' : 'als Referenz'}
                </button>
              </div>
              {#if model.id !== project?.currentModelId}
                <div class="ch-actions">
                  <Button size="small" onclick={() => useModel(model)}>Verwenden</Button>
                </div>
              {/if}
            </div>
          {/each}

          <!-- what they see right now -->
          <div class="group-head">
            <span class="gh-inner">
            {source === 'examples' ? 'Ergebnis auf den Testbildern' : 'Erkannt in diesem Bild'}
            <span class="gh-right">
              {#if source === 'examples'}
                <span class="hint">nur Bilder, deren Klasse das Modell kennt</span>
              {:else}
                <span class="hint">Schwelle {Math.round(CLASS_THRESHOLD * 100)} % als Strich im Balken</span>
              {/if}
            </span>
            </span>
          </div>

          {#if source === 'examples'}
            {#if !testRun}
              <div class="rail"></div>
              <div class="cell sep spanning" style="grid-column: 2 / -1;">
                <span class="hint">Noch nicht durchgerechnet — der Knopf oben startet den Durchlauf.</span>
              </div>
            {:else}
              <div class="rail strong">Richtig erkannt</div>
              {#each models as model (model.id)}
                {@const r = testResultFor(model)}
                <div class="cell sep">
                  {#if r && r.total}
                    <div class="val">{r.correct} von {r.total}</div>
                    <div class="delta">{((r.correct / r.total) * 100).toFixed(1).replace('.', ',')} %</div>
                  {:else}
                    <span class="missing">keine passenden Bilder</span>
                  {/if}
                </div>
              {/each}

              <div class="rail">Davon sicher</div>
              {#each models as model (model.id)}
                {@const r = testResultFor(model)}
                <div class="cell sep">
                  <div class="val plain">{r ? r.confident : '–'}</div>
                  <div class="delta">über {Math.round(CLASS_THRESHOLD * 100)} %</div>
                </div>
              {/each}

              {#each classRows as label (label)}
                <div class="rail">{label}</div>
                {#each models as model (model.id)}
                  {@const r = testResultFor(model)}
                  {@const per = r?.perClass.find((c) => c.label === label)}
                  <div class="cell sep">
                    {#if !per || !per.total}
                      <span class="missing">— Klasse fehlt in diesem Modell</span>
                    {:else}
                      {@const share = per.correct / per.total}
                      <div class="bar-row">
                        <div class="bar"><span style="width:{share * 100}%"></span></div>
                        <span class="pct">{Math.round(share * 100)} %</span>
                      </div>
                    {/if}
                  </div>
                {/each}
              {/each}
            {/if}
          {:else}
            <div class="rail strong">Top-Klasse</div>
            {#each models as model (model.id)}
              {@const p = predictionFor(model)}
              {@const off = !!p && !!majorityLabel && p.topLabel !== majorityLabel}
              <div class="cell sep" class:disagree={off}>
                {#if p}
                  <div class="top-class">
                    <span class="tc-name">{p.topLabel}</span>
                    <span class="tc-pct">{Math.round(p.topProb * 100)} %</span>
                  </div>
                  {#if off || p.topProb < CLASS_THRESHOLD}
                    <span class="flag">
                      {off ? '▲ weicht ab' : ''}{off && p.topProb < CLASS_THRESHOLD ? ' · ' : ''}{p.topProb <
                      CLASS_THRESHOLD
                        ? 'unter Schwelle'
                        : ''}
                    </span>
                  {/if}
                {:else}
                  <span class="missing">–</span>
                {/if}
              </div>
            {/each}

            {#each classRows as label (label)}
              <div class="rail">{label}</div>
              {#each models as model (model.id)}
                {@const index = model.classes.indexOf(label)}
                {@const p = predictionFor(model)}
                <div class="cell sep">
                  {#if index < 0}
                    <span class="missing">— Klasse fehlt in diesem Modell</span>
                  {:else if !p}
                    <span class="missing">–</span>
                  {:else}
                    {@const value = p.probs[index] ?? 0}
                    <div class="bar-row">
                      <div class="bar" class:win={p.topIndex === index}>
                        <span style="width:{value * 100}%"></span>
                        <i class="thr" style="left:{CLASS_THRESHOLD * 100}%"></i>
                      </div>
                      <span class="pct" class:dim={p.topIndex !== index}>{Math.round(value * 100)} %</span>
                    </div>
                  {/if}
                </div>
              {/each}
            {/each}
          {/if}

          <!-- the numbers that belong to the model itself -->
          <div class="group-head">
            <span class="gh-inner">
            Kennzahlen
            <span class="gh-right">
              <span class="hint">Abstand zur Referenz „{reference ? modelLabel(reference) : '–'}"</span>
            </span>
            </span>
          </div>

          {#each metricRows as row (row.label)}
            {@const bestAt = row.better ? bestIndexOf(row.values, row.better) : null}
            <div class="rail" title={row.hint ?? ''}>{row.label}</div>
            {#each models as model, i (model.id)}
              {@const value = row.values[i]}
              <div class="cell sep">
                {#if value == null}
                  <span class="missing">–</span>
                {:else}
                  <div class="val">
                    {row.format(value)}
                    {#if bestAt === i && row.bestLabel}<span class="best">{row.bestLabel}</span>{/if}
                  </div>
                  {@const delta = deltaText(row, value, i)}
                  {#if delta}<div class="delta">{delta}</div>{/if}
                {/if}
              </div>
            {/each}
          {/each}

          <div class="rail">Häufigste Verwechslung</div>
          {#each models as model (model.id)}
            <div class="cell sep">
              {#if worstPairOf(model)}
                <div class="val plain">{worstPairOf(model)}</div>
              {:else}
                <span class="missing">nach dem Durchrechnen</span>
              {/if}
            </div>
          {/each}

          <!-- how they were set up -->
          <div class="group-head">
            <span class="gh-inner">
            Einstellungen
            <span class="gh-right">
              <label class="switch-label">
                <input type="checkbox" bind:checked={diffOnly} />
                nur Unterschiede zeigen
              </label>
            </span>
            </span>
          </div>

          {#if !shownSettingRows.length}
            <div class="rail"></div>
            <div class="cell sep" style="grid-column: 2 / -1;">
              <span class="hint">Diese Modelle wurden mit denselben Einstellungen trainiert.</span>
            </div>
          {/if}
          {#each shownSettingRows as row (row.label)}
            {@const differs = new Set(row.values).size > 1}
            <div class="rail" class:same={!differs}>{row.label}</div>
            {#each models as model, i (model.id)}
              <div class="cell sep">
                <div class="val plain" class:diff={differs && row.values[i] !== row.values[0]}>{row.values[i]}</div>
              </div>
            {/each}
          {/each}

          <!-- where each of them loses which class -->
          {#if anyMatrix}
            <div class="group-head">
            <span class="gh-inner">
              Verwechslungen
              <span class="gh-right"><span class="hint">Zeile = was es war, Spalte = was das Modell sagte</span></span>
            </span>
          </div>
            <div class="rail">Matrix</div>
            {#each models as model (model.id)}
              {@const r = matrixFor(model)}
              <div class="cell sep">
                {#if r && r.classes.length}
                  {@const peak = peakOf(r.matrix)}
                  <div class="mx" style="grid-template-columns: 40px repeat({r.classes.length}, 52px);">
                    <div></div>
                    {#each r.classes as c}<div class="mx-hd" title={c}>{shortLabel(c)}</div>{/each}
                    {#each r.matrix as row, i}
                      <div class="mx-rl" title={r.classes[i]}>{shortLabel(r.classes[i])}</div>
                      {#each row as count, j}
                        <div class="mx-c" class:diag={i === j} style={shade(count, peak, i === j)}>{count}</div>
                      {/each}
                    {/each}
                  </div>
                {:else}
                  <span class="missing">noch nicht gemessen</span>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
          </div>
        </div>

        <!-- ---------- the images they disagreed on ---------- -->
        {#if testRun && testRun.disagreements.length}
          <section class="block">
            <div class="block-head">
              Bilder ohne Einigkeit
              <span class="hint">
                {testRun.images - testRun.agreed} insgesamt{testRun.disagreements.length < testRun.images - testRun.agreed
                  ? `, die ersten ${testRun.disagreements.length} davon`
                  : ''}
              </span>
            </div>
            <div class="strip">
              {#each testRun.disagreements as item (item.src)}
                <button type="button" class="shot" onclick={() => pickImage(item.src)}>
                  <img src={item.src} alt="" />
                  <span class="shot-truth">war: {item.trueLabel}</span>
                  {#each item.verdicts as verdict}
                    {@const at = models.findIndex((m) => m.id === verdict.modelId)}
                    <span class="verdict">
                      <i class="dot" style="background:{COMPARE_COLORS[at % COMPARE_COLORS.length]}"></i>
                      <b>{verdict.label}</b>
                    </span>
                  {/each}
                </button>
              {/each}
            </div>
            <div class="hint">
              Ein Klick rechnet das Bild oben in den Spalten durch — dort stehen dann die Prozentwerte dazu.
            </div>
          </section>
        {/if}

        <!-- ---------- one chart, one curve per model ---------- -->
        <section class="block chart">
          <CompareChart {models} />
        </section>

        <div class="summary">
          {#if bestByAccuracy}
            Beste Genauigkeit: <b>{modelLabel(bestByAccuracy)}</b>
          {/if}
          {#if bestBySize && bestByAccuracy && bestBySize.id !== bestByAccuracy.id}
            · kleinstes Modell: <b>{modelLabel(bestBySize)}</b>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet actions()}
    <Button onclick={() => (isOpen = false)}>Fertig</Button>
  {/snippet}
</Modal>

<style lang="scss">
  .compare-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 24px 20px;
  }
  .state {
    padding: 40px 0;
    text-align: center;
    font-size: 13px;
    color: rgb(var(--md-on-surface-variant));
    &.error { color: rgb(var(--md-error, 186 26 26)); }
  }
  .hint {
    font-size: 11.5px;
    color: rgb(var(--md-on-surface-variant));
  }
  .chip {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 2px 7px;
    border-radius: 99px;
    background: rgb(var(--md-primary));
    color: rgb(var(--md-on-primary));
    white-space: nowrap;
    &.muted { background: rgba(var(--md-surface-variant), 1); color: rgb(var(--md-on-surface-variant)); }
    &.outline {
      background: transparent;
      color: rgb(var(--md-on-surface-variant));
      border: 1px solid rgb(var(--md-outline-variant));
      cursor: pointer;
      font: inherit;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding: 2px 7px;
      &.on { background: rgb(var(--md-primary)); color: rgb(var(--md-on-primary)); border-color: transparent; }
    }
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; display: inline-block; }

  /* ---- the shared camera ---- */
  .source-band {
    display: grid;
    grid-template-columns: 268px 1fr;
    gap: 16px;
    padding: 12px;
    border-radius: var(--md-radius-lg);
    background: rgba(var(--md-surface-variant), 0.45);
    margin-bottom: 12px;
  }
  .cam {
    position: relative;
    border-radius: var(--md-radius-md);
    overflow: hidden;
    aspect-ratio: 4/3;
    background: #22242a;
    // `contain` rather than `cover`: a cropped picture would put the region
    // outlines somewhere other than the pixels they belong to, and half of a
    // region could sit outside the box entirely.
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      transform: scaleX(var(--cam-mirror));
      &.hidden { visibility: hidden; }
    }
    .still {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      transform: scaleX(var(--cam-mirror));
    }
    // Heavier in pose mode: the skeleton is the subject, the picture is not.
    &.pose video { filter: blur(12px) brightness(0.45) saturate(1.1); }
    &.pose .still { filter: blur(12px) brightness(0.45) saturate(1.1); }
    // Matches the picture's box exactly: drawPoseOverlay renders at the camera's
    // aspect ratio, so the same `contain` letterboxes both the same way. No scaleX(-1)
    // — the mirror is in the drawing — and no blend mode, it is transparent.
    .pose-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
      z-index: 2;
    }
  }
  .cam-tag {
    position: absolute;
    left: 8px;
    top: 8px;
    z-index: 4;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    background: rgba(0, 0, 0, 0.72);
    color: #fff;
    padding: 3px 8px;
    border-radius: 99px;
    display: flex;
    align-items: center;
    gap: 5px;
    .live-dot { width: 6px; height: 6px; border-radius: 50%; background: #98f600; }
    &.paused .live-dot { background: #d5d7db; }
  }
  .cam-foot {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 6px 8px;
    display: flex;
    gap: 6px;
    z-index: 4;
    // No gradient scrim: it reads as nothing over a dark frame, which is exactly
    // what a pose box is. Each button carries its own contrast instead.
    .mini {
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      color: #fff;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 99px;
      padding: 4px 10px;
      cursor: pointer;
      &:hover { background: rgba(0, 0, 0, 0.8); border-color: rgba(255, 255, 255, 0.6); }
    }
  }
  .src-right { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .src-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .src-label { font-size: 11.5px; font-weight: 600; color: rgb(var(--md-on-surface-variant)); }
  .seg {
    display: inline-flex;
    background: rgb(var(--md-surface));
    border-radius: 99px;
    padding: 3px;
    gap: 2px;
    box-shadow: inset 0 0 0 1px rgb(var(--md-outline-variant));
    button {
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 99px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: rgb(var(--md-on-surface-variant));
      &.on { background: rgb(var(--md-primary)); color: rgb(var(--md-on-primary)); }
      &:disabled { opacity: 0.4; cursor: default; }
    }
  }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .fact {
    background: rgb(var(--md-surface));
    border-radius: var(--md-radius-md);
    padding: 8px 12px;
    .f-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: rgb(var(--md-on-surface-variant)); }
    .f-value { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.2; }
    .f-sub { font-size: 11px; color: rgb(var(--md-on-surface-variant)); }
  }
  .meter {
    height: 6px;
    border-radius: 99px;
    background: rgba(28, 27, 31, 0.12);
    margin-top: 6px;
    overflow: hidden;
    &.grow { flex: 1; min-width: 80px; margin-top: 0; }
    span { display: block; height: 100%; background: rgb(var(--md-primary)); border-radius: 99px; }
  }
  .src-note { font-size: 11.5px; line-height: 1.5; color: rgb(var(--md-on-surface-variant)); margin: 0; }
  .link {
    font: inherit;
    font-size: 12px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
    color: rgb(var(--md-on-surface-variant));
  }
  .offscreen {
    position: absolute;
    left: -9999px;
    top: 0;
    width: 1px;
    height: 1px;
  }
  .saved-strip {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    .saved-thumb {
      border: 2px solid transparent;
      border-radius: var(--md-radius-sm);
      padding: 0;
      background: none;
      cursor: pointer;
      flex-shrink: 0;
      &.on { border-color: rgb(var(--md-primary)); }
      img { width: 72px; height: 54px; object-fit: cover; border-radius: 6px; display: block; }
    }
  }

  /* ---- the grid ---- */
  .cmp-wrap { position: relative; }
  .cmp-scroll {
    overflow-x: auto;
    // Room for the pager buttons to sit over the edges without covering a value.
    scroll-padding-inline: 44px;
  }
  .pager-lane {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 46px;
    z-index: 6;
    pointer-events: none;
    display: flex;
    justify-content: center;
    &.left { left: 0; background: linear-gradient(to right, rgb(var(--md-surface)) 40%, transparent); }
    &.right { right: 0; background: linear-gradient(to left, rgb(var(--md-surface)) 40%, transparent); }
  }
  .pager {
    position: sticky;
    top: 38vh;
    align-self: flex-start;
    pointer-events: auto;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid rgb(var(--md-outline-variant));
    background: rgb(var(--md-surface));
    box-shadow: var(--md-elevation-1);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    color: rgb(var(--md-on-surface));
    &:hover { background: rgb(var(--md-surface-variant)); }
  }
  .cmp { display: grid; }
  .cmp > div {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(var(--md-outline-variant), 0.55);
    min-width: 0;
  }
  .sep { border-left: 1px solid rgba(var(--md-outline-variant), 0.55); }
  .rail {
    // Stays put while the columns scroll under it — a row of percentages says
    // nothing once its label has left the screen.
    position: sticky;
    left: 0;
    z-index: 3;
    background: rgb(var(--md-surface));
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    display: flex;
    align-items: center;
    justify-content: flex-end;
    text-align: right;
    gap: 6px;
    &.strong { color: rgb(var(--md-on-surface)); font-weight: 600; }
    &.same { opacity: 0.45; }
    &.head-rail { border-bottom: none; }
  }
  .group-head {
    grid-column: 1 / -1;
    padding: 18px 0 6px !important;
    border-bottom: 1px solid rgb(var(--md-outline-variant)) !important;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 700;
    color: rgb(var(--md-on-surface-variant));
    .gh-right { text-transform: none; letter-spacing: 0; font-weight: 400; }
  }
  .gh-inner {
    position: sticky;
    left: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    width: max-content;
    max-width: 100%;
    background: rgb(var(--md-surface));
    padding-right: 14px;
  }
  .switch-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    cursor: pointer;
    color: rgb(var(--md-on-surface-variant));
  }

  .chead {
    padding: 12px !important;
    .ch-top { display: flex; align-items: center; gap: 6px; }
    .ch-name { font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ch-meta { font-size: 11px; color: rgb(var(--md-on-surface-variant)); margin-top: 3px; font-variant-numeric: tabular-nums; }
    .ch-chips { display: flex; gap: 5px; margin-top: 7px; flex-wrap: wrap; align-items: center; }
    .ch-actions { display: flex; gap: 6px; margin-top: 9px; }
  }

  .top-class {
    display: flex;
    align-items: baseline;
    gap: 8px;
    .tc-name { font-size: 17px; font-weight: 700; }
    .tc-pct { font-size: 13px; font-variant-numeric: tabular-nums; color: rgb(var(--md-on-surface-variant)); }
  }
  .cell.disagree {
    background: rgba(28, 27, 31, 0.045);
    box-shadow: inset 2px 0 0 rgb(var(--md-primary));
  }
  .flag {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: rgb(var(--md-on-surface-variant));
    margin-top: 3px;
    display: block;
  }

  .bar-row { display: flex; align-items: center; gap: 8px; }
  .bar {
    flex: 1;
    height: 7px;
    border-radius: 99px;
    background: rgba(28, 27, 31, 0.1);
    position: relative;
    span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 99px; background: rgba(28, 27, 31, 0.3); }
    &.win span { background: rgb(var(--md-primary)); }
    .thr { position: absolute; top: -2px; bottom: -2px; width: 2px; background: rgba(28, 27, 31, 0.45); }
  }
  .pct {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    width: 40px;
    text-align: right;
    font-weight: 600;
    &.dim { font-weight: 400; color: rgb(var(--md-on-surface-variant)); }
  }
  .missing { font-size: 12px; color: rgb(var(--md-on-surface-variant)); opacity: 0.65; }

  .val {
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    gap: 7px;
    &.plain { font-weight: 500; font-size: 13px; }
    &.diff { text-decoration: underline dotted; text-underline-offset: 3px; }
    .best {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      background: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
      padding: 2px 6px;
      border-radius: 99px;
    }
  }
  .delta { font-size: 11px; color: rgb(var(--md-on-surface-variant)); font-variant-numeric: tabular-nums; margin-top: 2px; }

  /* ---- confusion matrices ---- */
  .mx { display: grid; gap: 2px; font-variant-numeric: tabular-nums; }
  .mx-hd, .mx-rl {
    font-size: 9.5px;
    color: rgb(var(--md-on-surface-variant));
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .mx-hd { text-align: center; padding-bottom: 2px; }
  .mx-rl { text-align: right; padding-right: 5px; align-self: center; }
  .mx-c {
    height: 46px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    &.diag { color: rgb(var(--md-on-primary)); }
  }

  /* ---- blocks below the grid ---- */
  .block { margin-top: 18px; }
  .block.chart {
    border: 1px solid rgb(var(--md-outline-variant));
    border-radius: var(--md-radius-md);
    padding: 12px 14px;
  }
  .block-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 700;
    color: rgb(var(--md-on-surface-variant));
    border-bottom: 1px solid rgb(var(--md-outline-variant));
    padding-bottom: 6px;
    margin-bottom: 10px;
    .hint { margin-left: auto; text-transform: none; letter-spacing: 0; font-weight: 400; }
  }
  .strip {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 6px;
    .shot {
      width: 128px;
      flex-shrink: 0;
      text-align: left;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      font: inherit;
      img { width: 128px; height: 96px; object-fit: cover; border-radius: var(--md-radius-sm); display: block; }
      .shot-truth {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: rgb(var(--md-on-surface-variant));
        margin: 5px 0 2px;
      }
      .verdict {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        line-height: 1.5;
        b { font-weight: 600; }
      }
    }
  }
  .summary {
    margin-top: 14px;
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    b { color: rgb(var(--md-on-surface)); font-weight: 600; }
  }
</style>
