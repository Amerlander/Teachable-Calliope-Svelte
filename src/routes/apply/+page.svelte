<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import {
    initSharedCamera,
    predictFromVideo,
    estimatePose,
    drawPoseSkeleton,
    setLastPoseCanvas,
  } from '$lib/machine';
  import { drawPoseOverlay } from '$lib/poseOverlay';
  import {
    setVideoRef,
    mobilenetModel,
    classifierModel,
    predictionClasses,
    classThumbs,
  } from '$lib/stores';
  import { cameraMirror, selectedCameraId } from '$lib/stores/camera';
  import {
    activeModel,
    availableModels,
    currentProject,
    type TrainedModel,
  } from '$lib/stores/projects';
  import { ensureActiveModelLoaded, modelLabel } from '$lib/models';
  import {
    disposeComparison,
    loadComparison,
    overlayColor,
    predictAll,
    MAX_COMPARED,
    type CompareEntry,
    type ModelPrediction,
  } from '$lib/compare';
  import { displayRoi, roiCropStyle } from '$lib/roi';
  import NoModelNotice from '$lib/components/NoModelNotice.svelte';
  import RoiOverlay from '$lib/components/RoiOverlay.svelte';
  import ApplySidebar from '$lib/components/apply/ApplySidebar.svelte';
  import ApplyResults from '$lib/components/apply/ApplyResults.svelte';
  import { applyView, THUMB_SCALE } from '$lib/stores/applyView';
  import {
    streamClassProbabilities,
    streamPoseKeypoints,
    currentDetection,
    resetStreamState,
  } from '$lib/stores/streaming';
  import { showNotification } from '$lib/stores/notifications';
  import { setConnectionUiActive } from '@calliope-edu/mini-connection-widget';

  const TICK_MS = 100;

  let stageWrap: HTMLDivElement | null = $state(null);
  let videoEl: HTMLVideoElement | null = $state(null);
  // Two canvases, on purpose — see $lib/poseOverlay. `skeletonCanvas` is the
  // square, black-backed picture the model is fed and must stay exactly what
  // drawPoseSkeleton renders; `overlayCanvas` is the one on screen.
  let skeletonCanvas: HTMLCanvasElement | null = $state(null);
  let overlayCanvas: HTMLCanvasElement | null = $state(null);
  let videoAspect = $state(4 / 3);
  let fullscreen = $state(false);

  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let tickInFlight = false;
  let disposed = false;

  const mode = $derived($currentProject?.mode ?? 'image');
  const modelReady = $derived(!!$classifierModel && !!$mobilenetModel);
  const det = $derived($currentDetection);

  // ---------- Several models on one picture ----------
  // The selected model comes first and is always in the set, whatever the cap
  // does to the rest: it is the one being streamed to the board, so it is the one
  // column that may never be missing. The others follow newest first.
  const comparedModels = $derived.by((): TrainedModel[] => {
    if (!$applyView.allModels) return [];
    const rest = [...$availableModels].reverse().filter((m) => m.id !== $activeModel?.id);
    const picked = $activeModel ? [$activeModel, ...rest] : rest;
    return picked.slice(0, MAX_COMPARED);
  });

  let compareEntries: CompareEntry[] = $state([]);
  let comparePredictions: ModelPrediction[] = $state([]);
  /** Guards against two loads racing when the model list changes mid-load. */
  let compareToken = 0;

  const multiResults = $derived(
    compareEntries.length
      ? compareEntries.map((e) => ({
          model: e.model,
          prediction: comparePredictions.find((p) => p.modelId === e.model.id) ?? null,
        }))
      : null,
  );

  async function releaseComparison() {
    const entries = compareEntries;
    compareEntries = [];
    comparePredictions = [];
    if (entries.length) await disposeComparison(entries);
  }

  async function reloadComparison(models: TrainedModel[]) {
    const token = ++compareToken;
    await releaseComparison();
    if (token !== compareToken || disposed) return;
    if (models.length < 2) return;
    try {
      const entries = await loadComparison(models);
      // Another change landed while these were loading, or the view is gone —
      // either way nothing would be left holding a reference to them.
      if (token !== compareToken || disposed) {
        await disposeComparison(entries);
        return;
      }
      compareEntries = entries;
    } catch (err) {
      console.warn('[apply] Vergleich konnte nicht geladen werden', err);
      showNotification('Die Modelle konnten nicht gemeinsam geladen werden', {
        type: 'error',
      });
    }
  }

  $effect(() => {
    // Re-loads whenever the set of compared models changes — including down to
    // none, which is what turning the setting off looks like from here.
    const models = comparedModels;
    // `comparedModels` is the only thing this effect may depend on. Untracked,
    // because reloadComparison both reads and writes `compareEntries`: tracked,
    // that read would make the effect its own trigger and it would never settle.
    untrack(() => void reloadComparison(models));
  });

  async function tick() {
    if (disposed || tickInFlight) return;
    tickInFlight = true;
    try {
      if (!videoEl || !videoEl.videoWidth) return;
      if (mode === 'pose') {
        try {
          const pose = await estimatePose(videoEl);
          // Rendered every frame regardless of the skeleton setting: this canvas
          // is what the classifier reads, so switching the overlay off may not
          // switch off the model's input.
          if (skeletonCanvas) {
            drawPoseSkeleton(
              skeletonCanvas,
              pose,
              videoEl.videoWidth,
              videoEl.videoHeight,
              { size: 512 },
            );
            setLastPoseCanvas(skeletonCanvas);
          }
          if (overlayCanvas) {
            drawPoseOverlay(overlayCanvas, pose, videoEl.videoWidth, videoEl.videoHeight, {
              skeleton: $applyView.poseSkeleton,
              labels: $applyView.poseLabels,
              angles: $applyView.poseAngles,
              // Follows the picture: an unmirrored camera with a mirrored
              // skeleton would put the person's left arm on the wrong side.
              mirror: $cameraMirror,
            });
          }
          if (pose?.keypoints?.length) {
            streamPoseKeypoints(pose.keypoints, videoEl.videoWidth, videoEl.videoHeight);
          }
        } catch {
          /* retry next tick */
        }
      }

      if (compareEntries.length) {
        // One extractor pass feeds every head (see $lib/compare), so the board is
        // served out of this run rather than from a second prediction — the
        // selected model is one of these columns.
        const source = mode === 'pose' && skeletonCanvas ? skeletonCanvas : videoEl;
        const preds = await predictAll(compareEntries, source);
        comparePredictions = preds;
        const active = preds.find((p) => p.modelId === $activeModel?.id);
        if (active) streamClassProbabilities($predictionClasses, active.probs);
      } else if (modelReady) {
        const p = await predictFromVideo(videoEl);
        if (p) {
          // Labels come from the running model, not from the project's live
          // class list — those two drift apart as soon as a class is added.
          streamClassProbabilities($predictionClasses, p.allProbs);
        }
      }
    } finally {
      tickInFlight = false;
      if (!disposed) tickTimer = setTimeout(() => void tick(), TICK_MS);
    }
  }

  // ---------- The image region ----------
  // Pose models read a skeleton rather than a part of the frame, so none of this
  // applies to them.
  const roiMode = $derived(mode === 'pose' ? 'hide' : $applyView.roiDisplay);

  /**
   * The regions to outline: one per compared model when several are running, else
   * the selected model's. Models trained on the whole frame carry no region and
   * drop out — an outline around the entire picture says nothing.
   */
  const roiOutlines = $derived.by(() => {
    if (roiMode !== 'show') return [];
    const models = multiResults ? multiResults.map((r) => r.model) : $activeModel ? [$activeModel] : [];
    return models
      .map((model, i) => ({ model, color: models.length > 1 ? overlayColor(i) : null }))
      .filter((o) => !!o.model.roi);
  });

  /**
   * Showing the region alone is a crop, not an outline: the box takes the
   * region's own aspect ratio and the picture is scaled up inside it until the
   * region fills it exactly (the same window trick the stored thumbnails use, see
   * $lib/roi). It follows the selected model, the one that is driving the board —
   * several models with several regions cannot all fill one stage.
   */
  const cropRoi = $derived(roiMode === 'only' ? ($activeModel?.roi ?? null) : null);
  const frameAspect = $derived(
    cropRoi ? (videoAspect * cropRoi.w) / cropRoi.h : videoAspect,
  );
  // Positioned by the *displayed* region: the picture is flipped about its own
  // centre, so with a mirrored camera the region sits on the other side of it.
  const cropStyle = $derived(
    cropRoi ? roiCropStyle(displayRoi(cropRoi, $cameraMirror)) : '',
  );

  /**
   * The cover for `label`, preferring the one the model itself carries.
   *
   * A model's own covers are the right answer here: this view labels its output
   * from the model, and the project's live map has usually moved on — renamed
   * classes, deleted ones, a model imported from a ZIP whose classes the project
   * never had. The project map is the fallback for models recorded before covers
   * existed.
   */
  function thumbFor(model: TrainedModel | null, label: string): string | undefined {
    return (model ?? $activeModel)?.classThumbs?.[label] ?? $classThumbs[label];
  }

  // ---------- Fullscreen ----------
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stageWrap) await stageWrap.requestFullscreen();
    } catch (err) {
      // Refused by the browser (no user gesture, or blocked by policy). The
      // button is the only thing that was promised, so just say it didn't work.
      console.warn('[apply] Vollbild nicht möglich', err);
      showNotification('Vollbild ist in diesem Browser nicht möglich', { type: 'error' });
    }
  }

  function onFullscreenChange() {
    fullscreen = !!document.fullscreenElement;
  }

  onMount(async () => {
    const p = get(currentProject);
    if (!p) {
      goto('/');
      return;
    }
    resetStreamState();
    setVideoRef('webcamTryout', videoEl);
    videoEl?.addEventListener('loadedmetadata', () => {
      if (videoEl?.videoWidth && videoEl.videoHeight) {
        videoAspect = videoEl.videoWidth / videoEl.videoHeight;
      }
    });
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // The selection survives reloads on the project; the classifier itself does
    // not, so it may still need loading before the first prediction.
    void ensureActiveModelLoaded();
    await initSharedCamera(
      { webcamTryout: videoEl },
      get(selectedCameraId) ?? undefined,
    );
    // Streaming to a board is the whole purpose of this view, so let the
    // widget's banner offer a connection while it's open.
    setConnectionUiActive(true);
    void tick();
  });

  onDestroy(() => {
    disposed = true;
    if (tickTimer) clearTimeout(tickTimer);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    setConnectionUiActive(false);
    setLastPoseCanvas(null);
    setVideoRef('webcamTryout', null);
    // The compared heads hold GPU memory of their own — see $lib/compare.
    void releaseComparison();
  });
</script>

<div class="apply-view" bind:this={stageWrap} class:fullscreen>
  <div
    class="video-stage"
    class:pose-mode={mode === 'pose'}
    class:blurred={$applyView.blurCamera && mode === 'pose'}
    style="--thumb-scale: {THUMB_SCALE[$applyView.thumbSize]};"
  >
    <!-- The picture and everything that has to line up with it, in a box that is
         exactly the letterboxed video — so an overlay can be `inset: 0` instead of
         re-deriving where the black bars are. Cropped to the region it is the
         region's aspect ratio instead, and the video inside is the part that shows.
    -->
    <div class="frame" class:cropped={!!cropRoi} style="aspect-ratio: {frameAspect};">
      <video bind:this={videoEl} autoplay playsinline muted style={cropStyle}>
        <track kind="captions" />
      </video>

      <!-- The skeleton, over the camera picture. Nothing was drawn here before:
           the only skeleton canvas was the model's own input, rendered offscreen,
           so a pose project showed a bare camera picture and nothing of what the
           model sees. What this one draws is set in the sidebar; the model's input
           is a separate canvas and never changes. -->
      {#if mode === 'pose'}
        <canvas class="pose-overlay" bind:this={overlayCanvas}></canvas>
      {/if}

      <!-- The region each running model was trained on. Read-only here: Anwenden
           uses models, the region belongs to the model. Named once there is more
           than one, because four unlabelled boxes over one picture are a puzzle. -->
      {#each roiOutlines as o (o.model.id)}
        <RoiOverlay
          roi={o.model.roi}
          aspect={videoAspect}
          color={o.color}
          label={o.color ? modelLabel(o.model) : null}
          title={`Bildbereich von ${modelLabel(o.model)}`}
        />
      {/each}
    </div>

    <!-- Which model is running is chosen in the header. Only its name is repeated
         here, over the picture it is classifying — and only while it is the one
         model running, since the strip names every model itself. -->
    {#if $activeModel && !multiResults}
      <div class="hud hud-model">
        <span class="hud-model-caption">Modell</span>
        <span class="hud-model-name">{modelLabel($activeModel)}</span>
      </div>
    {/if}

    <ApplyResults
      detail={$applyView.resultDetail}
      order={$applyView.classOrder}
      {det}
      multi={multiResults}
      showThumbs={$applyView.classThumbs}
      activeModelId={$activeModel?.id ?? null}
      colorFor={multiResults && multiResults.length > 1 ? overlayColor : null}
      {thumbFor}
    />

    {#if $availableModels.length === 0}
      <!-- No model at all: offer both ways out right here instead of sending the
           user off to look for them. -->
      <div class="empty-stage">
        <NoModelNotice
          variant="panel"
          message="Zum Anwenden brauchst du ein Modell. Trainiere eines mit deinen Bildern oder importiere ein fertiges."
        />
      </div>
    {:else if !modelReady && !multiResults}
      <div class="hud hud-empty">Wähle oben rechts ein Modell aus.</div>
    {/if}
  </div>

  <ApplySidebar
    poseMode={mode === 'pose'}
    {fullscreen}
    modelCount={$availableModels.length}
    onToggleFullscreen={toggleFullscreen}
  />

  <!-- Never shown: this is the square frame the classifier reads. -->
  {#if mode === 'pose'}
    <canvas bind:this={skeletonCanvas} width="512" height="512" class="offscreen"></canvas>
  {/if}
</div>

<style lang="scss">
  // Stage and settings column side by side, so opening the column narrows the
  // picture instead of covering it.
  .apply-view {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
    display: flex;
    align-items: stretch;
  }
  // In fullscreen the element is the whole screen, and the browser gives it no
  // parent size to inherit from.
  .apply-view.fullscreen {
    width: 100vw;
    height: 100vh;
  }
  .video-stage {
    position: relative;
    flex: 1;
    min-width: 0;
    display: grid;
    place-items: center;
  }
  // Absolute, centred and given an aspect ratio: the largest box of that shape
  // that fits the stage, which is exactly where a `contain` video would be.
  .frame {
    position: absolute;
    inset: 0;
    margin: auto;
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
  }
  .video-stage video {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    background: #000;
    transform: scaleX(var(--cam-mirror));
  }
  // The crop is set inline by roiCropStyle: the element grows past the box and is
  // pushed so that only the region is inside it.
  .frame.cropped video {
    object-fit: fill;
    max-width: none;
  }
  // Pose projects only — see `blurCamera` in $lib/stores/applyView. An image model
  // classifies the picture itself, so there is nothing to be gained by hiding it.
  .video-stage.pose-mode.blurred video { filter: blur(18px) brightness(0.4) saturate(1.1); }

  // Matches the video's box exactly: drawPoseOverlay renders at the camera's
  // aspect ratio, so the same `contain` letterboxes both the same way. No
  // scaleX(-1) — the mirror is in the drawing, or the labels would read
  // backwards — and no blend mode, the canvas is transparent.
  .pose-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 2;
    pointer-events: none;
  }

  .hud {
    position: absolute;
    z-index: 6;
    backdrop-filter: blur(6px);
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    border-radius: 12px;
    padding: 14px 18px;
    font-size: 18px;
    line-height: 1.3;
  }
  .hud-empty {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    font-size: 16px;
    color: rgba(255, 255, 255, 0.78);
    text-align: center;
    max-width: 60vw;
  }
  // Sits where the detection readout would be, so an empty project reads as
  // "here is what's missing" rather than as a broken camera view.
  .empty-stage {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    z-index: 7;
  }
  .hud-model {
    top: 20px;
    left: 20px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    font-size: 13px;
  }
  .hud-model-caption {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.7);
  }
  .hud-model-name {
    font-weight: 500;
  }

  .offscreen {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
  }
</style>
