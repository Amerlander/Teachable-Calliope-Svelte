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
  import { setVideoRef, mobilenetModel, classifierModel } from '$lib/stores';
  import { selectedCameraId } from '$lib/stores/camera';
  import { currentProject } from '$lib/stores/projects';
  import {
    streamClassProbabilities,
    streamPoseKeypoints,
    currentDetection,
    resetStreamState,
  } from '$lib/stores/streaming';
  import CameraSelect from '$lib/components/CameraSelect.svelte';

  const TICK_MS = 100;

  let videoEl: HTMLVideoElement | null = $state(null);
  let skeletonCanvas: HTMLCanvasElement | null = $state(null);

  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let tickInFlight = false;
  let disposed = false;

  const mode = $derived($currentProject?.mode ?? 'image');
  const modelReady = $derived(!!$classifierModel && !!$mobilenetModel);
  const det = $derived($currentDetection);
  const confidentThreshold = 0.7;

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
          const labels = $currentProject?.classes ?? [];
          streamClassProbabilities(labels, p.allProbs);
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
  });
</script>

<div class="tryout-camera">
  <div class="camera-tools">
    <CameraSelect />
  </div>

  <div class="video-wrap">
    <video bind:this={videoEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>
    {#if det}
      <div class="prediction-overlay" class:confident={det.confidence >= confidentThreshold}>
        <div class="pred-label">{det.label}</div>
        <div class="pred-bar">
          <div class="pred-bar-fill" style="width: {(det.confidence * 100).toFixed(0)}%"></div>
        </div>
        <div class="pred-confidence">{(det.confidence * 100).toFixed(0)}%</div>
      </div>
    {:else if !modelReady}
      <div class="hint">Kein Modell geladen — bitte zuerst trainieren.</div>
    {/if}
  </div>

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
  .camera-tools {
    flex: 0 0 auto;
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
  .offscreen {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
  }
</style>
