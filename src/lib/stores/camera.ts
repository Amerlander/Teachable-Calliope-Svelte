import { writable, get } from 'svelte/store';
import { videoRefs } from '$lib/stores';
import { initSharedCamera } from '$lib/machine';

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

export async function switchCamera(deviceId: string): Promise<void> {
  selectedCameraId.set(deviceId);
  const refs = get(videoRefs);
  await initSharedCamera(refs, deviceId);
}
