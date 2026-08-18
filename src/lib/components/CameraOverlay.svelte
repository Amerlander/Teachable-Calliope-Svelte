<script lang="ts">
  import { showCameraOverlay } from '$lib/stores/app';
  import CampusButton from '$lib/components/ui/CampusButton.svelte';
  import {
    cameraFellBack,
    cameraLabel,
    cameraPreviewLive,
    cameraProblem,
    cameras,
    ensureCameraAccess,
    releaseCameraProbe,
    selectedCameraId,
    setCameraPreview,
    switchCamera,
    type CameraProblem
  } from '$lib/stores/camera';

  let working = $state(false);
  let previewEl = $state<HTMLVideoElement | null>(null);

  // Falling back to the first device mirrors what getUserMedia does without a
  // deviceId, so the tick sits on the camera that is actually on screen.
  const currentId = $derived($selectedCameraId ?? $cameras[0]?.deviceId ?? '');

  // Opening the picker is what triggers the permission request. Nothing else in
  // the app prompts, which is why a view that never shows a feed stays quiet —
  // and why this is the reliable way back when the browser lost the camera.
  $effect(() => {
    if ($showCameraOverlay) void probe();
    else releaseCameraProbe();
  });

  // The store owns the binding rather than the markup: the picture can come from
  // the running view's stream or from the picker's own, and which one it is
  // changes under us as cameras are switched.
  $effect(() => {
    setCameraPreview(previewEl);
  });

  async function probe() {
    working = true;
    try {
      await ensureCameraAccess();
    } finally {
      working = false;
    }
  }

  // Picking deliberately leaves the box open. Closing on the click would take the
  // preview away in the same moment it becomes worth looking at, which is the one
  // thing the picker is for — the user closes it once the picture convinces them.
  async function pick(deviceId: string) {
    if (working) return;
    working = true;
    try {
      await switchCamera(deviceId);
    } finally {
      working = false;
    }
  }

  function close() {
    showCameraOverlay.set(false);
  }
  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  const MESSAGES: Record<CameraProblem, string> = {
    insecure:
      'Die Seite läuft nicht über eine sichere Verbindung. Browser geben die Kamera nur über https:// oder auf localhost frei.',
    unsupported:
      'Dieser Browser kann nicht auf Kameras zugreifen. Bitte eine aktuelle Version von Chrome, Edge, Firefox oder Safari verwenden.',
    denied:
      'Der Kamerazugriff ist für diese Seite blockiert. In der Adressleiste auf das Schloss-Symbol tippen, „Kamera“ auf „Zulassen“ stellen und die Seite neu laden.',
    none: 'Es wurde keine Kamera gefunden. Kamera anschließen und dann erneut suchen.',
    busy: 'Die Kamera wird von einem anderen Programm verwendet, zum Beispiel einer Videokonferenz. Dort schließen und erneut suchen.',
    unknown: 'Der Kamerazugriff hat nicht funktioniert. Bitte erneut versuchen.'
  };
</script>

{#if $showCameraOverlay}
  <div
    class="backdrop"
    onclick={onBackdrop}
    onkeydown={(e) => e.key === 'Escape' && close()}
    role="presentation"
  >
    <div class="box">
      <button class="close" onclick={close} aria-label="Schließen">&times;</button>
      <h2>Kamera auswählen</h2>

      <!-- Device labels are often unhelpful ("USB2.0 HD UVC WebCam"), so the
           picture is what actually answers "which one is this?". -->
      <div class="preview" class:live={$cameraPreviewLive}>
        <video bind:this={previewEl} autoplay playsinline muted>
          <track kind="captions" />
        </video>
        {#if !$cameraPreviewLive}
          <span class="preview-note">
            {working ? 'Kamera wird gestartet …' : 'Kein Kamerabild'}
          </span>
        {/if}
      </div>

      {#if working && $cameras.length === 0}
        <p class="hint">Kameras werden gesucht …</p>
      {:else if $cameras.length > 0}
        <div class="list">
          {#each $cameras as cam, i (cam.deviceId)}
            <button
              class="cam-option"
              class:active={cam.deviceId === currentId}
              disabled={working}
              title={cameraLabel(cam, i)}
              onclick={() => pick(cam.deviceId)}
            >
              {cameraLabel(cam, i)}
            </button>
          {/each}
        </div>
        {#if $cameraFellBack}
          <p class="problem">
            Diese Kamera war nicht verfügbar. Es wird die Standardkamera verwendet.
          </p>
        {:else if $cameraProblem}
          <p class="problem">{MESSAGES[$cameraProblem]}</p>
        {/if}
      {:else}
        <p class="problem">{MESSAGES[$cameraProblem ?? 'unknown']}</p>
      {/if}

      <div class="actions">
        <CampusButton variant="secondary" onclick={probe} disabled={working}>
          {working ? 'Suche läuft …' : 'Erneut suchen'}
        </CampusButton>
        <CampusButton variant="primary" onclick={close}>OK</CampusButton>
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  // Metrics and colours follow LanguageOverlay so the two picker boxes read as
  // the same thing.
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000000;
  }
  .box {
    position: relative;
    background: #fff;
    padding: 32px 40px;
    border-radius: 20px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    font-family: 'Inter', system-ui, sans-serif;
    h2 { font-size: 24px; font-weight: 600; color: #000; margin: 0 0 24px; text-align: center; }
  }
  .close {
    position: absolute;
    top: 16px; right: 16px;
    background: transparent;
    border: none;
    font-size: 28px;
    cursor: pointer;
    padding: 8px;
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    min-height: unset;
    box-shadow: none;
    color: #666;
    &:hover { background: #f5f5f5; }
  }

  // Fixed 4:3 frame. The box must not resize as the preview swaps between a 16:9
  // webcam and a 4:3 one, so the picture is cropped to fit rather than fitted.
  .preview {
    position: relative;
    aspect-ratio: 4 / 3;
    width: 100%;
    margin: 0 0 20px;
    border-radius: 12px;
    overflow: hidden;
    background: #1b1c1d;
    display: flex;
    align-items: center;
    justify-content: center;
    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      // Self-view, mirrored the way every other feed in the app is.
      transform: scaleX(-1);
      // Kept mounted while dark: binding a stream needs the element to exist.
      opacity: 0;
      transition: opacity 0.2s;
    }
    &.live video { opacity: 1; }
  }
  .preview-note {
    position: absolute;
    font-size: 14px;
    color: #bbb;
  }

  .list { display: flex; flex-direction: column; gap: 8px; }
  .cam-option {
    padding: 14px 20px;
    background: #f5f5f5;
    border: 2px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    color: #333;
    text-align: center;
    font-family: inherit;
    transition: all 0.2s;
    box-shadow: none;
    min-height: unset;
    // Device labels get long ("HD Pro Webcam C920 (046d:082d)"), and the box must
    // not grow with them.
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    &:hover:not(:disabled) { background: #e8e8e8; border-color: #1fb6ff; }
    &.active { background: #e3f5ff; border-color: #1fb6ff; color: #1fb6ff; font-weight: 600; }
    &:disabled { opacity: 0.6; cursor: default; }
  }
  .hint, .problem {
    margin: 12px 0 0;
    font-size: 15px;
    line-height: 1.5;
    color: #555;
    text-align: center;
  }
  .problem { color: #a33; }

  // OK on the right, as in the other dialogs. Both buttons wrap onto their own
  // rows on a narrow screen rather than shrinking their labels.
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 24px;
  }
</style>
