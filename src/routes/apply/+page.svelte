<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
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
    isSerialCapable,
  } from '$lib/stores/streaming';
  import { calliopeState, setConnectionUiActive } from '@calliope-edu/mini-connection-widget';

  const TICK_MS = 100;
  const CLASS_THRESHOLD = 0.7;

  let videoEl: HTMLVideoElement | null = $state(null);
  let skeletonCanvas: HTMLCanvasElement | null = $state(null);

  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let tickInFlight = false;
  let disposed = false;

  const mode = $derived($currentProject?.mode ?? 'image');
  const modelReady = $derived(!!$classifierModel && !!$mobilenetModel);
  const det = $derived($currentDetection);
  // Matches what the streaming gate accepts, so the HUD can't claim a live
  // board while the lines go nowhere (mini 2 linked flash-only). `flashing` is
  // kept because a transport can briefly leave 'connected' during the transfer's
  // reboot and the HUD shouldn't flicker to "nicht verbunden" mid-flash.
  const connected = $derived(
    isSerialCapable($calliopeState) || $calliopeState.status === 'flashing',
  );

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
          /* retry next tick */
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
    const p = get(currentProject);
    if (!p) {
      goto('/');
      return;
    }
    resetStreamState();
    setVideoRef('webcamTryout', videoEl);
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
    setConnectionUiActive(false);
    setLastPoseCanvas(null);
  });
</script>

<div class="apply-view">
  <div class="video-stage">
    <video bind:this={videoEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>

    <!-- HUD: current detection -->
    {#if det}
      <div class="hud hud-detection" class:confident={det.confidence >= CLASS_THRESHOLD}>
        <div class="label">{det.label}</div>
        <div class="bar">
          <div class="bar-fill" style="width: {(det.confidence * 100).toFixed(0)}%"></div>
        </div>
        <div class="conf">{(det.confidence * 100).toFixed(0)}%</div>
      </div>
    {:else if !modelReady}
      <div class="hud hud-empty">Kein Modell geladen — bitte zuerst trainieren.</div>
    {/if}

    <!-- HUD: connection indicator -->
    <div class="hud hud-conn" class:live={connected}>
      <span class="dot"></span>
      {#if connected}Calliope verbunden{:else}Calliope nicht verbunden{/if}
    </div>
  </div>

  {#if mode === 'pose'}
    <canvas bind:this={skeletonCanvas} width="512" height="512" class="offscreen"></canvas>
  {/if}
</div>

<style lang="scss">
  .apply-view {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
  }
  .video-stage {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .video-stage video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    background: #000;
    transform: scaleX(-1);
  }

  .hud {
    position: absolute;
    backdrop-filter: blur(6px);
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    border-radius: 12px;
    padding: 14px 18px;
    font-size: 18px;
    line-height: 1.3;
  }
  .hud-detection {
    left: 50%;
    bottom: 36px;
    transform: translateX(-50%);
    min-width: min(560px, 80vw);
    display: flex;
    align-items: center;
    gap: 16px;

    .label {
      font-weight: 700;
      font-size: 22px;
      max-width: 40%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bar {
      flex: 1;
      height: 10px;
      background: rgba(255, 255, 255, 0.18);
      border-radius: 5px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: #9ca3af;
      transition: width 0.15s;
    }
    .conf {
      font-variant-numeric: tabular-nums;
      font-size: 16px;
      opacity: 0.9;
    }
    &.confident .bar-fill { background: #22c55e; }
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

  .hud-conn {
    top: 20px;
    right: 20px;
    font-size: 13px;
    padding: 8px 14px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.82);

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9ca3af;
    }
    &.live .dot {
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34, 197, 94, 0.7);
      animation: pulse 1.5s ease-in-out infinite;
    }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  .offscreen {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
  }
</style>
