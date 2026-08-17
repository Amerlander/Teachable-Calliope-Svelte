// Shared inference → Calliope streaming helpers. Any page that runs
// predictions (tryout, training test mode, apply view) can call these; they
// are safe no-ops when no board is connected.

import { writable, get, type Readable } from 'svelte/store';
import {
  sendSerialLine,
  calliopeState,
  type CalliopeState,
} from '@calliope-edu/mini-connection-widget';
import { sendLineToMakeCode } from '$lib/makecode';
import { activeModel } from './projects';
import { mapScores, displayScore, wireScore, pickWinnerIndex } from '$lib/calibration';

/**
 * Whether a transport that actually carries serial is up.
 *
 * Not the same as the widget's rolled-up `status`: that also reads
 * `'connected'` for a Calliope mini 2 linked flash-only (`jlinkUsbStatus`, the
 * J-Link WebUSB flash path, without the CDC port). Flashing works in that
 * state, serial does not — every `sendSerialLine` would be silently dropped
 * while the UI claimed a live connection. These three are exactly the
 * transports `sendSerialLine` routes over.
 */
export function isSerialCapable(s: CalliopeState): boolean {
  return (
    s.usbStatus === 'connected' ||
    s.jlinkSerialStatus === 'connected' ||
    s.bleStatus === 'connected'
  );
}

/**
 * What one frame of inference amounts to, in the mapped scale.
 *
 * Everything here except {@link CurrentDetection.raw} is already run through the
 * selected model's per-class mapping (see $lib/calibration) and clamped to 0–1:
 * consumers show these numbers as they are and never re-derive a threshold. The
 * raw model output is carried alongside for the mapping editor only.
 */
export interface CurrentDetection {
  /** Label of the leading class — highest mapped score. */
  label: string;
  /** The leading class's mapped score (0–1). */
  confidence: number;
  /** 1-based id matching the generated MakeCode project's `classRegistry`. */
  id: number;
  /**
   * Whether the leading class actually counts as detected, i.e. clears the fixed
   * threshold. False means "nothing recognised" — the leading class is still
   * named so its bar can be shown, it just hasn't been picked.
   */
  detected: boolean;
  /** Class labels in order. */
  labels: string[];
  /** Mapped score per class (0–1) in `labels` order. */
  all: number[];
  /** Smoothed raw model probability per class (0–1), for the mapping editor. */
  raw: number[];
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

// Index of the class detected on the previous frame, or -1. Held so a score
// hovering at the threshold can't flap the detection on and off — see
// pickWinnerIndex's release threshold.
let lastWinnerIdx = -1;

/** Reset smoothing state — call when the project or class list changes. */
export function resetStreamState() {
  history = [];
  lastLabelsKey = '';
  lastWinnerIdx = -1;
  detection.set(null);
}

/**
 * Push raw classification probabilities for ALL classes, and return what the
 * frame amounts to so a caller that also renders the prediction doesn't have to
 * repeat the mapping.
 *
 * The values are smoothed with a rolling-median window, mapped through the
 * selected model's per-class windows, and emitted as two lines: `C <c1> … <cN>`
 * carries the mapped scores (0–100) that back the `confidence` block, `W <id>`
 * names the detected class (0 = none). The winner is decided here, not on the
 * board: the mapping belongs to a model, and a program can be pointed at another
 * model at any time, so a threshold baked into the program would go stale.
 */
export function streamClassProbabilities(
  labels: string[],
  probabilities: number[],
): CurrentDetection {
  // Reset the window when the label set changes (model reloaded / classes edited).
  const key = labels.join('');
  if (key !== lastLabelsKey) {
    history = [];
    lastWinnerIdx = -1;
    lastLabelsKey = key;
  }

  const windowSize = Math.max(1, Math.floor(get(smoothingWindow)));
  history.push(probabilities.slice());
  while (history.length > windowSize) history.shift();

  const smoothed = medianOfWindow(probabilities.length);
  // Map each class's raw probability through the selected model's own window.
  // Unclamped on purpose: two classes mapped past 100% would tie once clamped,
  // and the winner rule has to be able to tell them apart.
  const mapped = mapScores(labels, smoothed, get(activeModel)?.classRanges);

  const winnerIdx = pickWinnerIndex(mapped, lastWinnerIdx);
  lastWinnerIdx = winnerIdx;
  // With nothing detected the leading class is still reported so its bar can be
  // drawn — `detected` is what says whether it counts.
  let leadIdx = winnerIdx;
  if (leadIdx < 0) {
    leadIdx = 0;
    for (let i = 1; i < mapped.length; i++) {
      if (mapped[i] > mapped[leadIdx]) leadIdx = i;
    }
  }

  const next: CurrentDetection = {
    label: labels[leadIdx] ?? '',
    confidence: displayScore(mapped[leadIdx] ?? 0),
    id: leadIdx + 1,
    detected: winnerIdx >= 0,
    labels: labels.slice(),
    all: mapped.map(displayScore),
    raw: smoothed,
    at: Date.now(),
  };
  detection.set(next);

  if (mapped.length) {
    // Scores first, then the winner: a handler running on the class event reads
    // the scores of the same frame.
    emitToCalliope(`C ${mapped.map(wireScore).join(' ')}`);
    emitToCalliope(`W ${winnerIdx >= 0 ? winnerIdx + 1 : 0}`);
  }
  return next;
}

/**
 * Send one line to both consumers of the prediction stream: the connected board
 * over serial, and the embedded MakeCode editor.
 *
 * The editor gets it regardless of whether a board is attached — it shows up in
 * the serial monitor, and a running simulator reads it as `serial.readLine()`
 * input, so a program can be tried out without hardware. (That second half
 * needs a pxt carrying the simdriver fix that forwards host serial into the
 * simulator frames; against an unpatched editor only the monitor fills up.)
 */
function emitToCalliope(line: string): void {
  if (isSerialCapable(get(calliopeState))) void sendSerialLine(line);
  sendLineToMakeCode(line);
}

// Pose overlay is drawn at render framerate (~60 Hz) but the Calliope mini's
// serial link can't keep up with a ~500-byte frame that often. Throttle emits
// to a reasonable rate for downstream block handlers.
const POSE_MIN_INTERVAL_MS = 100;
let lastPoseEmitAt = 0;

/** Emit a `P x0 y0 v0 … x16 y16 v16` frame to the board and the editor. */
export function streamPoseKeypoints(
  keypoints: { x: number; y: number; score?: number }[],
  srcW: number,
  srcH: number,
) {
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
  emitToCalliope(parts.join(' '));
}
