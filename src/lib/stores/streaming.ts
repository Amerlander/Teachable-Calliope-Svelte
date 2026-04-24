// Shared inference → Calliope streaming helpers. Any page that runs
// predictions (tryout, training test mode, apply view) can call these; they
// are safe no-ops when no board is connected.

import { writable, get, type Readable } from 'svelte/store';
import { sendSerialLine, calliopeState } from './connection';

export interface CurrentDetection {
  label: string;
  confidence: number;
  /** 1-based id matching the generated MakeCode project's `classRegistry`. */
  id: number;
  at: number;
}

const detection = writable<CurrentDetection | null>(null);
export const currentDetection: Readable<CurrentDetection | null> = {
  subscribe: detection.subscribe,
};

const CLASS_THRESHOLD = 0.7;
let lastSentClassId = -1;

/** Reset dedup state — call when the project or class list changes. */
export function resetStreamState() {
  lastSentClassId = -1;
  detection.set(null);
}

/**
 * Push a classification result to the UI detection store and (if the board is
 * connected and we cross the threshold) emit a `C <id> <conf>` line. Only
 * emits when the top class actually changes, so the board doesn't get spammed
 * with duplicate events.
 */
export function streamClassification(
  label: string,
  index: number,
  probability: number,
) {
  const id = index + 1;
  detection.set({ label, confidence: probability, id, at: Date.now() });

  if (get(calliopeState).status !== 'connected') return;
  if (probability < CLASS_THRESHOLD) return;
  if (id === lastSentClassId) return;

  lastSentClassId = id;
  const conf = Math.round(Math.max(0, Math.min(1, probability)) * 100);
  void sendSerialLine(`C ${id} ${conf}`);
}

/** Emit a `P x0 y0 v0 … x16 y16 v16` frame. No-op when not connected. */
export function streamPoseKeypoints(
  keypoints: { x: number; y: number; score?: number }[],
  srcW: number,
  srcH: number,
) {
  if (get(calliopeState).status !== 'connected') return;
  if (!srcW || !srcH) return;
  const parts: string[] = ['P'];
  for (let i = 0; i < 17; i++) {
    const kp = keypoints[i];
    if (!kp) {
      parts.push('0', '0', '0');
    } else {
      const x = Math.max(0, Math.min(100, Math.round((kp.x / srcW) * 100)));
      const y = Math.max(0, Math.min(100, Math.round((kp.y / srcH) * 100)));
      const v = (kp.score ?? 0) > 0.3 ? 1 : 0;
      parts.push(String(x), String(y), String(v));
    }
  }
  void sendSerialLine(parts.join(' '));
}
