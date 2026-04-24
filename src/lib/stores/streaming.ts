// Shared inference → Calliope streaming helpers. Any page that runs
// predictions (tryout, training test mode, apply view) can call these; they
// are safe no-ops when no board is connected.

import { writable, get, type Readable } from 'svelte/store';
import { sendSerialLine, calliopeState } from './connection';

export interface CurrentDetection {
  /** Label of the current top class (after smoothing). */
  label: string;
  /** Confidence of the top class (0–1, already smoothed). */
  confidence: number;
  /** 1-based id matching the generated MakeCode project's `classRegistry`. */
  id: number;
  /** Class labels in order. */
  labels: string[];
  /** Smoothed probability per class (0–1) in `labels` order. */
  all: number[];
  at: number;
}

const detection = writable<CurrentDetection | null>(null);
export const currentDetection: Readable<CurrentDetection | null> = {
  subscribe: detection.subscribe,
};

/** Smoothing window size (number of recent frames to median-aggregate). */
export const smoothingWindow = writable<number>(5);

// Rolling ring buffer of recent probability vectors for median smoothing.
let history: number[][] = [];
let lastLabelsKey = '';

function medianOfWindow(classCount: number): number[] {
  if (history.length === 0) return new Array(classCount).fill(0);
  const out = new Array(classCount).fill(0);
  const col: number[] = [];
  for (let c = 0; c < classCount; c++) {
    col.length = 0;
    for (const frame of history) col.push(frame[c] ?? 0);
    col.sort((a, b) => a - b);
    const mid = col.length >> 1;
    out[c] = col.length % 2 ? col[mid] : (col[mid - 1] + col[mid]) / 2;
  }
  return out;
}

/** Reset smoothing state — call when the project or class list changes. */
export function resetStreamState() {
  history = [];
  lastLabelsKey = '';
  detection.set(null);
}

/**
 * Push raw classification probabilities for ALL classes. Internally smooths
 * with a rolling-median window and emits a single `C <c1> <c2> … <cN>` line
 * (0–100 per class) over serial. The Calliope-side extension decides when a
 * class event fires based on its per-class thresholds.
 */
export function streamClassProbabilities(
  labels: string[],
  probabilities: number[],
) {
  // Reset the window when the label set changes (model reloaded / classes edited).
  const key = labels.join('');
  if (key !== lastLabelsKey) {
    history = [];
    lastLabelsKey = key;
  }

  const windowSize = Math.max(1, Math.floor(get(smoothingWindow)));
  history.push(probabilities.slice());
  while (history.length > windowSize) history.shift();

  const smoothed = medianOfWindow(probabilities.length);
  let topIdx = 0;
  let topVal = -1;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] > topVal) {
      topVal = smoothed[i];
      topIdx = i;
    }
  }

  detection.set({
    label: labels[topIdx] ?? '',
    confidence: topVal,
    id: topIdx + 1,
    labels: labels.slice(),
    all: smoothed,
    at: Date.now(),
  });

  if (get(calliopeState).status !== 'connected') return;
  if (!smoothed.length) return;
  const encoded = smoothed
    .map((p) => Math.round(Math.max(0, Math.min(1, p)) * 100))
    .join(' ');
  void sendSerialLine(`C ${encoded}`);
}

// Pose overlay is drawn at render framerate (~60 Hz) but the Calliope mini's
// serial link can't keep up with a ~500-byte frame that often. Throttle emits
// to a reasonable rate for downstream block handlers.
const POSE_MIN_INTERVAL_MS = 100;
let lastPoseEmitAt = 0;

/** Emit a `P x0 y0 v0 … x16 y16 v16` frame. No-op when not connected. */
export function streamPoseKeypoints(
  keypoints: { x: number; y: number; score?: number }[],
  srcW: number,
  srcH: number,
) {
  if (get(calliopeState).status !== 'connected') return;
  if (!srcW || !srcH) return;
  const now = Date.now();
  if (now - lastPoseEmitAt < POSE_MIN_INTERVAL_MS) return;
  lastPoseEmitAt = now;
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
