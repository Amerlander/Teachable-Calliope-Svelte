import { writable, get } from 'svelte/store';
import { videoRefs } from '$lib/stores';
import { initSharedCamera, isCameraRunning } from '$lib/machine';

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
 * Re-read the list of video inputs. Enumeration is skipped while no stream is
 * live: without granted permission the browser hands back label-less dummy
 * entries, and asking for permission is the camera view's job — the header must
 * not prompt for a camera on views that never use one.
 */
export async function refreshCameras(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !isCameraRunning()) {
    cameras.set([]);
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const found = devices.filter((d) => d.kind === 'videoinput');
    cameras.set(found);
    // A remembered camera that has since been unplugged must not keep the
    // selection pinned to a device that no longer exists.
    const remembered = get(selectedCameraId);
    if (remembered && !found.some((c) => c.deviceId === remembered)) {
      selectedCameraId.set(null);
    }
  } catch {
    cameras.set([]);
  }
}

/** Browsers leave the label empty until permission is granted for that device. */
export function cameraLabel(cam: MediaDeviceInfo, index: number): string {
  return cam.label || `Kamera ${index + 1}`;
}

export async function switchCamera(deviceId: string): Promise<void> {
  selectedCameraId.set(deviceId);
  const refs = get(videoRefs);
  await initSharedCamera(refs, deviceId);
}
