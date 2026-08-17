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
  import { setVideoRef, mobilenetModel, classifierModel, predictionClasses } from '$lib/stores';
  import { selectedCameraId } from '$lib/stores/camera';
  import { activeModel, availableModels, currentProject } from '$lib/stores/projects';
  import { activateModel, ensureActiveModelLoaded, modelLabel } from '$lib/models';
  import { showNotification } from '$lib/stores/notifications';
  import ModelPicker from '$lib/components/ModelPicker.svelte';
  import NoModelNotice from '$lib/components/NoModelNotice.svelte';
  import RoiOverlay from '$lib/components/RoiOverlay.svelte';
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
  let videoAspect = $state(4 / 3);

  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let tickInFlight = false;
  let disposed = false;

  const mode = $derived($currentProject?.mode ?? 'image');
  const modelReady = $derived(!!$classifierModel && !!$mobilenetModel);
  const det = $derived($currentDetection);

  // Anwenden is the one view where every model is on offer: it runs a model, it
  // isn't bound to a program's class list.
  async function pickModel(id: string) {
    try {
      const model = await activateModel(id);
      resetStreamState();
      if (model) showNotification(`Modell „${modelLabel(model)}“ aktiv`, { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
    }
  }
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
    setConnectionUiActive(false);
    setLastPoseCanvas(null);
    setVideoRef('webcamTryout', null);
  });
</script>

<div class="apply-view">
  <div class="video-stage">
    <video bind:this={videoEl} autoplay playsinline muted>
      <track kind="captions" />
    </video>

    <!-- The region the running model was trained on. Read-only here: Anwenden
         uses models, the region belongs to the model. -->
    {#if mode !== 'pose'}
      <RoiOverlay roi={$activeModel?.roi} aspect={videoAspect} />
    {/if}

    <!-- Model chooser: every model of the project is selectable here. -->
    {#if $availableModels.length}
      <div class="hud hud-model">
        <span class="hud-model-caption">Modell</span>
        <ModelPicker
          models={$availableModels}
          selectedId={$activeModel?.id ?? null}
          onselect={pickModel}
          placeholder="Modell wählen"
        />
      </div>
    {/if}

    <!-- HUD: current detection -->
    {#if det}
      <div class="hud hud-detection" class:confident={det.confidence >= CLASS_THRESHOLD}>
        <div class="label">{det.label}</div>
        <div class="bar">
          <div class="bar-fill" style="width: {(det.confidence * 100).toFixed(0)}%"></div>
        </div>
        <div class="conf">{(det.confidence * 100).toFixed(0)}%</div>
      </div>
    {:else if $availableModels.length === 0}
      <!-- No model at all: offer both ways out right here instead of sending the
           user off to look for them. -->
      <div class="empty-stage">
        <NoModelNotice
          variant="panel"
          message="Zum Anwenden brauchst du ein Modell. Trainiere eines mit deinen Bildern oder importiere ein fertiges."
        />
      </div>
    {:else if !modelReady}
      <div class="hud hud-empty">Wähle oben rechts ein Modell aus.</div>
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
  // Sits where the detection HUD would be, so an empty project reads as "here is
  // what's missing" rather than as a broken camera view.
  .empty-stage {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    z-index: 6;
  }
  .hud-model {
    top: 20px;
    left: 20px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    font-size: 13px;
    z-index: 6;
  }
  .hud-model-caption {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.7);
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
