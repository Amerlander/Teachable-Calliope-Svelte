<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    initSharedCamera,
    predictFromVideo,
    estimatePose,
    drawPoseSkeleton,
    setLastPoseCanvas,
  } from '$lib/machine';
  import { setVideoRef, mobilenetModel, classifierModel, predictionClasses } from '$lib/stores';
  import { selectedCameraId } from '$lib/stores/camera';
  import { activeModel, currentProject } from '$lib/stores/projects';
  import { modelLabel } from '$lib/models';
  import RoiOverlay from '$lib/components/RoiOverlay.svelte';
  import {
    streamClassProbabilities,
    streamPoseKeypoints,
    currentDetection,
    resetStreamState,
  } from '$lib/stores/streaming';

  const TICK_MS = 100;

  let videoEl: HTMLVideoElement | null = $state(null);
  let skeletonCanvas: HTMLCanvasElement | null = $state(null);
  let videoAspect = $state(4 / 3);

  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let tickInFlight = false;
  let disposed = false;

  const mode = $derived($currentProject?.mode ?? 'image');
  const modelReady = $derived(!!$classifierModel && !!$mobilenetModel);
  const det = $derived($currentDetection);

  async function tick() {
    if (disposed || tickInFlight) return;
    tickInFlight = true;
    try {
      if (!videoEl || !videoEl.videoWidth) return;

      if (mode === 'pose') {
        try {
          const pose = await estimatePose(videoEl);
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
          if (pose?.keypoints?.length) {
            streamPoseKeypoints(pose.keypoints, videoEl.videoWidth, videoEl.videoHeight);
          }
        } catch {
          /* next tick will retry */
        }
      }

      if (modelReady) {
        const p = await predictFromVideo(videoEl);
        if (p) {
          // The loaded model's own classes — the project's live list may have
          // moved on since it was trained, and the board's class ids follow the
          // model, not the project.
          streamClassProbabilities($predictionClasses, p.allProbs);
        }
      }
    } finally {
      tickInFlight = false;
      if (!disposed) tickTimer = setTimeout(() => void tick(), TICK_MS);
    }
  }

  onMount(async () => {
    resetStreamState();
    setVideoRef('webcamTryout', videoEl);
    videoEl?.addEventListener('loadedmetadata', () => {
      if (videoEl?.videoWidth && videoEl.videoHeight) {
        videoAspect = videoEl.videoWidth / videoEl.videoHeight;
      }
    });
    await initSharedCamera(
      { webcamTryout: videoEl },
      get(selectedCameraId) ?? undefined,
    );
    void tick();
  });

  onDestroy(() => {
    disposed = true;
    if (tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
    setLastPoseCanvas(null);
    setVideoRef('webcamTryout', null);
  });
</script>

<div class="tryout-camera">
  <div class="video-wrap">
    <video bind:this={videoEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>
    <!-- The region the running model was trained on, shown as it is: this view
         uses a model, it does not define one. -->
    {#if mode !== 'pose'}
      <RoiOverlay roi={$activeModel?.roi} aspect={videoAspect} />
    {/if}

    {#if det}
      <div class="prediction-overlay" class:confident={det.detected}>
        <div class="pred-label">{det.label}</div>
        <div class="pred-bar">
          <div class="pred-bar-fill" style="width: {(det.confidence * 100).toFixed(0)}%"></div>
        </div>
        <div class="pred-confidence">{(det.confidence * 100).toFixed(0)}%</div>
      </div>
    {:else if !modelReady}
      <div class="hint">Kein Modell geladen — wähle oben ein Programm mit Modell.</div>
    {/if}
  </div>

  {#if $activeModel}
    <!-- Names the model the prediction above comes from; which model a program
         uses is chosen on its card in the list. -->
    <div class="model-line">
      <span class="model-name" title={modelLabel($activeModel)}>{modelLabel($activeModel)}</span>
      <span class="model-meta">
        {$activeModel.classes.length} Klassen
        {#if $activeModel.roi}· Bereich{:else}· Ganzes Bild{/if}
      </span>
    </div>
  {/if}

  {#if mode === 'pose'}
    <canvas bind:this={skeletonCanvas} width="512" height="512" class="offscreen"></canvas>
  {/if}
</div>

<style lang="scss">
  .tryout-camera {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    width: 100%;
  }
  .video-wrap {
    position: relative;
    width: 100%;
    background: #000;
    border-radius: 10px;
    overflow: hidden;
    line-height: 0;

    video {
      display: block;
      width: 100%;
      height: auto;
      max-height: 60vh;
      object-fit: contain;
      transform: scaleX(-1);
    }
  }
  .prediction-overlay {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 10px;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    border-radius: 8px;
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    gap: 10px;
    line-height: 1.2;

    .pred-label {
      font-weight: 600;
      flex: 0 0 auto;
      max-width: 55%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pred-bar {
      flex: 1 1 auto;
      height: 6px;
      background: rgba(255, 255, 255, 0.18);
      border-radius: 3px;
      overflow: hidden;
    }
    .pred-bar-fill {
      height: 100%;
      background: #9ca3af;
      transition: width 0.15s;
    }
    .pred-confidence {
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      opacity: 0.85;
      flex: 0 0 auto;
    }
    &.confident .pred-bar-fill {
      background: #22c55e;
    }
  }
  .hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.65);
    font-size: 13px;
    text-align: center;
    padding: 20px;
  }
  .model-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    font-size: 12px;
    color: #555;
  }
  .model-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .model-meta {
    color: #888;
    flex-shrink: 0;
  }
  .offscreen {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
  }
</style>
