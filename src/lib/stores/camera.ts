import { writable, get } from 'svelte/store';
import { videoRefs } from '$lib/stores';
import {
  getLastCameraFailure,
  getSharedStream,
  initSharedCamera,
  isCameraRunning
} from '$lib/machine';

const STORAGE_KEY = 'teachable-selected-camera';

function readInitial(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const selectedCameraId = writable<string | null>(readInitial());

selectedCameraId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
});

/** Video inputs known to the browser, refreshed by {@link refreshCameras}. */
export const cameras = writable<MediaDeviceInfo[]>([]);

/**
 * Why the camera is not available, in the terms the picker explains to the user.
 *
 *  'insecure'    — no secure context, so the browser hides `mediaDevices` entirely
 *  'unsupported' — the browser has no camera API at all
 *  'denied'      — blocked for this origin; only the user can undo it, see below
 *  'none'        — permission is fine, no device attached
 *  'busy'        — a device exists but another program holds it
 */
export type CameraProblem = 'insecure' | 'unsupported' | 'denied' | 'none' | 'busy' | 'unknown';

export const cameraProblem = writable<CameraProblem | null>(null);

/**
 * True after a switch landed on a different device than the one asked for,
 * because the chosen one was gone or busy and {@link initSharedCamera} fell back
 * to the default. Worth saying out loud: the tick in the picker would otherwise
 * be the only clue, and it moves silently.
 */
export const cameraFellBack = writable(false);

/**
 * The stream `enumerateDevices` needs before it hands out real ids and labels,
 * held only while the picker is open. Kept apart from the shared view stream in
 * $lib/machine so releasing it can never darken a live feed.
 */
let probeStream: MediaStream | null = null;

/**
 * The picker's preview element. Kept out of the shared `videoRefs` registry on
 * purpose: that one means "an app view needs the feed", and the preview must not
 * be mistaken for one — otherwise opening the picker on the overview would look
 * like a view to fill and start a stream nothing ever stops.
 */
let previewEl: HTMLVideoElement | null = null;

/** True while the preview is showing a picture, for the placeholder to step aside. */
export const cameraPreviewLive = writable(false);

/**
 * Point the preview at whatever is live: the view's stream where there is one,
 * the probe otherwise. Both are the same picture as the selected device, so there
 * is nothing to open here.
 */
function bindPreview(): void {
  const stream = getSharedStream() ?? probeStream;
  if (!previewEl || !stream) {
    cameraPreviewLive.set(false);
    if (previewEl) previewEl.srcObject = null;
    return;
  }
  if (previewEl.srcObject === stream) return;
  // Flipped only once there is a frame. Announcing the picture on assignment
  // trades the placeholder for a black rectangle for as long as the device takes
  // to wake up, which is exactly the moment the user is looking at it.
  cameraPreviewLive.set(false);
  previewEl.srcObject = stream;
  previewEl.onloadeddata = () => cameraPreviewLive.set(true);
  previewEl.play().catch(() => { /* autoplay is best-effort */ });
}

/** Called by the picker as its preview element comes and goes. */
export function setCameraPreview(el: HTMLVideoElement | null): void {
  previewEl = el;
  bindPreview();
}

/**
 * Map a `getUserMedia` rejection onto {@link CameraProblem}. The legacy aliases
 * are still what some Firefox and Safari versions throw.
 */
function classify(err: unknown): CameraProblem {
  const name = (err as DOMException | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
    return 'none';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return 'busy';
  return 'unknown';
}

/** What stands between us and a camera before we have even asked for one. */
function apiProblem(): CameraProblem | null {
  if (typeof navigator === 'undefined') return 'unsupported';
  // Browsers only expose the camera on https:// and localhost. Reaching a dev
  // server over a plain-http LAN address is the common way to land here, and it
  // looks exactly like "no camera" without this check.
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return null;
}

/**
 * A video input we can actually select. While permission is missing,
 * `enumerateDevices` answers with one placeholder per kind that carries an empty
 * `deviceId` and no label; those must not be counted as cameras.
 */
function selectable(d: MediaDeviceInfo): boolean {
  return d.kind === 'videoinput' && d.deviceId !== '';
}

/**
 * Whether a view with a feed is on screen. The refs are nulled on unmount, so a
 * live entry means "there is a picture to fill" — which is not the same as
 * {@link isCameraRunning}: a view whose camera start failed has its elements
 * registered and no stream, and that is precisely the case the picker repairs.
 */
function hasLiveVideoRef(): boolean {
  return Object.values(get(videoRefs)).some((el) => !!el);
}

/**
 * Re-read the list of video inputs. Enumeration never prompts, so this is safe
 * to call from anywhere — an empty result means "not permitted yet", which is
 * {@link ensureCameraAccess}'s job to resolve.
 */
export async function refreshCameras(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    cameras.set([]);
    return;
  }
  try {
    const found = (await navigator.mediaDevices.enumerateDevices()).filter(selectable);
    cameras.set(found);
    // A remembered camera that has since been unplugged must not keep the
    // selection pinned to a device that no longer exists. An empty list means
    // permission is still missing rather than "camera gone", so it must not
    // throw the selection away.
    const remembered = get(selectedCameraId);
    if (remembered && found.length > 0 && !found.some((c) => c.deviceId === remembered)) {
      selectedCameraId.set(null);
    }
  } catch {
    cameras.set([]);
  }
}

/**
 * Pull the selection onto the device a stream actually landed on, and say whether
 * it had to move. A stream opened without an `exact` constraint — or one that fell
 * back to the default — can be on a different camera than the one asked for, and
 * the tick in the picker would follow silently.
 */
function alignSelection(stream: MediaStream | null, requested?: string): boolean {
  const actual = stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
  if (!actual || !requested || actual === requested) return false;
  selectedCameraId.set(actual);
  return true;
}

/**
 * Open the picker's own stream on `deviceId`, or on the default without one.
 *
 * `allowFallback` is the difference between opening the picker and picking a
 * camera in it: a remembered device that has gone missing should not stop the
 * preview from showing *something*, but answering an explicit pick with a
 * different camera than the one tapped would be a lie.
 */
async function openProbe(deviceId?: string, allowFallback = true): Promise<CameraProblem | null> {
  releaseCameraProbe();
  try {
    probeStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true
    });
  } catch (err) {
    if (!deviceId || !allowFallback) return classify(err);
    try {
      probeStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (fallbackErr) {
      return classify(fallbackErr);
    }
  }
  if (alignSelection(probeStream, deviceId)) cameraFellBack.set(true);
  return null;
}

/**
 * Get the picker a device list and a picture, asking for permission if that is
 * what is missing. This is the one place allowed to prompt: everything else only
 * enumerates, so views without a feed never trigger a camera dialog.
 *
 * Note what this deliberately cannot do: once the user has blocked the camera,
 * `getUserMedia` rejects immediately without showing a dialog and no API can
 * re-open it. 'denied' is the cue to point at the browser's own switch instead.
 */
export async function ensureCameraAccess(): Promise<CameraProblem | null> {
  cameraFellBack.set(false);
  const blocked = apiProblem();
  if (blocked) {
    cameras.set([]);
    cameraProblem.set(blocked);
    bindPreview();
    return blocked;
  }
  await refreshCameras();
  // The picker wants a picture as well as a list, and while permission is missing
  // the list is empty anyway — one stream covers both. A view that already has one
  // is watched instead of opened again: a second stream on the same device fails
  // outright on some Windows drivers.
  if (!isCameraRunning()) {
    const problem = await openProbe(get(selectedCameraId) ?? undefined);
    if (problem) {
      cameraProblem.set(problem);
      bindPreview();
      return problem;
    }
    // Real ids and labels only exist now that permission has been granted.
    await refreshCameras();
  }
  const problem = get(cameras).length === 0 ? 'none' : null;
  cameraProblem.set(problem);
  // A view whose camera start failed before permission existed is still sitting
  // there black, and closing the picker without picking anything would leave it
  // that way. The probe is handed over rather than run alongside the new stream,
  // for the same one-stream-per-device reason.
  if (!problem && hasLiveVideoRef() && !isCameraRunning()) {
    releaseCameraProbe();
    await initSharedCamera(get(videoRefs), get(selectedCameraId) ?? undefined);
  }
  bindPreview();
  return problem;
}

/**
 * Drop the picker's stream. Must run when it closes, otherwise the camera light
 * stays on over a view that shows no picture at all.
 */
export function releaseCameraProbe(): void {
  probeStream?.getTracks().forEach((t) => t.stop());
  probeStream = null;
  bindPreview();
}

/** Browsers leave the label empty until permission is granted for that device. */
export function cameraLabel(cam: MediaDeviceInfo, index: number): string {
  return cam.label || `Kamera ${index + 1}`;
}

/**
 * Remember a camera and, where a feed is on screen, restart it on that device.
 * Resolves to the reason it did not work, or `null` on success.
 */
export async function switchCamera(deviceId: string): Promise<CameraProblem | null> {
  selectedCameraId.set(deviceId);
  cameraFellBack.set(false);
  // Outside the camera views there is nothing to fill, so remembering the choice
  // for the next start is the whole job — except that the preview has to follow
  // it, which is the point of picking with a picture in front of you.
  if (!isCameraRunning() && !hasLiveVideoRef()) {
    const problem = await openProbe(deviceId, false);
    cameraProblem.set(problem);
    bindPreview();
    return problem;
  }
  releaseCameraProbe();
  const stream = await initSharedCamera(get(videoRefs), deviceId);
  if (!stream) {
    const problem = classify(getLastCameraFailure());
    cameraProblem.set(problem);
    bindPreview();
    return problem;
  }
  // initSharedCamera falls back to the default when the chosen device is gone or
  // busy, so the selection may have to move with it.
  if (alignSelection(stream, deviceId)) cameraFellBack.set(true);
  cameraProblem.set(null);
  await refreshCameras();
  bindPreview();
  return null;
}

// Cameras get plugged in and unplugged mid-session. Without this the list is
// only ever as fresh as the last time the picker was opened.
if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    void refreshCameras();
  });
}
