/**
 * Drawing a detected pose *for the user to look at*.
 *
 * Deliberately not the same renderer as `drawPoseSkeleton` in $lib/machine, and
 * the split matters. That one produces the picture the model is fed: a square,
 * black-backed, letterboxed frame whose every pixel is training input, drawn
 * identically at capture time and at inference time. Nothing may be added to it
 * — a keypoint label painted onto that canvas would be a feature the classifier
 * learns from, and would not match the images any existing model was trained on.
 *
 * So everything meant for the eye lives here instead:
 *
 *  - The target is the *camera's* aspect ratio, not a square. A square canvas
 *    stretched over a 4:3 video with `object-fit: contain` only lines up while
 *    the container is narrower than the camera; in a wide container the skeleton
 *    ends up concentrically shrunk against the person it belongs to.
 *  - The background stays transparent, so this composites over the video without
 *    `mix-blend-mode` tricks and text keeps its own contrast.
 *  - Mirroring happens in the coordinates, not in CSS. A canvas flipped with
 *    `scaleX(-1)` renders every label back to front.
 */

import type { Pose } from '$lib/machine';

/** MoveNet's 17 COCO keypoints, in output order. */
export const KEYPOINT_LABELS = [
  'Nase',
  'linkes Auge',
  'rechtes Auge',
  'linkes Ohr',
  'rechtes Ohr',
  'linke Schulter',
  'rechte Schulter',
  'linker Ellbogen',
  'rechter Ellbogen',
  'linkes Handgelenk',
  'rechtes Handgelenk',
  'linke Hüfte',
  'rechte Hüfte',
  'linkes Knie',
  'rechtes Knie',
  'linker Knöchel',
  'rechter Knöchel'
];

/** Bones of the MoveNet skeleton — the same pairs $lib/machine draws. */
const SKELETON_EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [5, 6],
  [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16]
];

/**
 * The joints worth a number. `vertex` is where the angle is measured and where
 * it is written; `a` and `c` are the keypoints the two arms of the angle run to.
 */
export const ANGLE_JOINTS: { name: string; a: number; vertex: number; c: number }[] = [
  { name: 'linker Ellbogen', a: 5, vertex: 7, c: 9 },
  { name: 'rechter Ellbogen', a: 6, vertex: 8, c: 10 },
  { name: 'linke Schulter', a: 7, vertex: 5, c: 11 },
  { name: 'rechte Schulter', a: 8, vertex: 6, c: 12 },
  { name: 'linke Hüfte', a: 5, vertex: 11, c: 13 },
  { name: 'rechte Hüfte', a: 6, vertex: 12, c: 14 },
  { name: 'linkes Knie', a: 11, vertex: 13, c: 15 },
  { name: 'rechtes Knie', a: 12, vertex: 14, c: 16 }
];

/** Bone and joint colours, matching the picture the model is fed. */
const BONE_COLOR = '#adf54c';
const JOINT_COLOR = '#ff5c8a';

export type PoseOverlayOptions = {
  /** Bones and joints. Off leaves only the labels and angles that are enabled. */
  skeleton?: boolean;
  /** Body-part names beside their keypoints. */
  labels?: boolean;
  /** Joint angles in degrees, written at the joint. */
  angles?: boolean;
  /** Keypoints scoring below this are treated as not found. */
  scoreThreshold?: number;
  /** Flip horizontally, for a camera picture shown mirrored. */
  mirror?: boolean;
  /** Long side of the render target, in pixels. Bounds the text's resolution. */
  maxSide?: number;
};

/** Interior angle at `vertex` in degrees, or null if a point is missing. */
export function jointAngle(
  kp: Pose['keypoints'],
  a: number,
  vertex: number,
  c: number,
  scoreThreshold = 0.3
): number | null {
  const p = kp[a], v = kp[vertex], q = kp[c];
  if (!p || !v || !q) return null;
  if ((p.score ?? 1) < scoreThreshold) return null;
  if ((v.score ?? 1) < scoreThreshold) return null;
  if ((q.score ?? 1) < scoreThreshold) return null;
  const ax = p.x - v.x, ay = p.y - v.y;
  const cx = q.x - v.x, cy = q.y - v.y;
  const na = Math.hypot(ax, ay), nc = Math.hypot(cx, cy);
  if (!na || !nc) return null;
  const cos = Math.max(-1, Math.min(1, (ax * cx + ay * cy) / (na * nc)));
  return Math.round((Math.acos(cos) * 180) / Math.PI);
}

/**
 * Every angle measurable on this pose, for a readout that wants the numbers as
 * text rather than drawn onto the picture.
 */
export function poseAngles(
  pose: Pose | null,
  scoreThreshold = 0.3
): { name: string; degrees: number }[] {
  if (!pose?.keypoints?.length) return [];
  const out: { name: string; degrees: number }[] = [];
  for (const j of ANGLE_JOINTS) {
    const deg = jointAngle(pose.keypoints, j.a, j.vertex, j.c, scoreThreshold);
    if (deg !== null) out.push({ name: j.name, degrees: deg });
  }
  return out;
}

/** A label with a backdrop, so it stays readable over any camera picture. */
function drawTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontPx: number,
  color: string
) {
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const padX = fontPx * 0.35;
  const padY = fontPx * 0.22;
  const w = ctx.measureText(text).width + padX * 2;
  const h = fontPx + padY * 2;
  // Kept inside the frame rather than allowed to run off the edge.
  const left = Math.max(0, Math.min(ctx.canvas.width - w, x));
  const top = Math.max(0, Math.min(ctx.canvas.height - h, y - h / 2));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, fontPx * 0.3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, top + h / 2);
}

/**
 * Render `pose` into `canvas` at the camera's aspect ratio.
 *
 * The canvas is resized to match `srcW`/`srcH` (capped by `maxSide`), so an
 * element sized `width:100%; height:100%; object-fit:contain` letterboxes to
 * exactly the same box as the `<video>` underneath it.
 */
export function drawPoseOverlay(
  canvas: HTMLCanvasElement,
  pose: Pose | null,
  srcW: number,
  srcH: number,
  opts: PoseOverlayOptions = {}
) {
  const {
    skeleton = true,
    labels = false,
    angles = false,
    scoreThreshold = 0.3,
    mirror = false,
    maxSide = 960
  } = opts;

  if (!srcW || !srcH) return;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!pose?.keypoints?.length) return;

  // Mirrored here rather than by a CSS transform: a flipped canvas would render
  // every label and angle back to front.
  const toX = (x: number) => (mirror ? w - x * scale : x * scale);
  const toY = (y: number) => y * scale;
  const kp = pose.keypoints;
  const visible = (i: number) => {
    const p = kp[i];
    return !!p && (p.score ?? 1) >= scoreThreshold;
  };

  // Bone thickness and text size follow the frame, so the overlay reads the same
  // in a narrow pane and on a projector.
  const unit = Math.max(w, h);

  if (skeleton) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, Math.round(unit / 120));
    ctx.strokeStyle = BONE_COLOR;
    for (const [a, b] of SKELETON_EDGES) {
      if (!visible(a) || !visible(b)) continue;
      ctx.beginPath();
      ctx.moveTo(toX(kp[a].x), toY(kp[a].y));
      ctx.lineTo(toX(kp[b].x), toY(kp[b].y));
      ctx.stroke();
    }
    ctx.fillStyle = JOINT_COLOR;
    const r = Math.max(3.5, unit / 180);
    for (let i = 0; i < kp.length; i++) {
      if (!visible(i)) continue;
      ctx.beginPath();
      ctx.arc(toX(kp[i].x), toY(kp[i].y), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const fontPx = Math.max(10, Math.round(unit / 52));

  if (labels) {
    const gap = Math.max(6, unit / 90);
    for (let i = 0; i < KEYPOINT_LABELS.length; i++) {
      if (!visible(i)) continue;
      drawTag(ctx, KEYPOINT_LABELS[i], toX(kp[i].x) + gap, toY(kp[i].y), fontPx, '#ffffff');
    }
  }

  if (angles) {
    const gap = Math.max(6, unit / 90);
    for (const j of ANGLE_JOINTS) {
      const deg = jointAngle(kp, j.a, j.vertex, j.c, scoreThreshold);
      if (deg === null) continue;
      // Below the joint when the labels already occupy the space beside it.
      const y = toY(kp[j.vertex].y) + (labels ? fontPx * 1.5 : 0);
      drawTag(ctx, `${deg}°`, toX(kp[j.vertex].x) + gap, y, fontPx, BONE_COLOR);
    }
  }
}
