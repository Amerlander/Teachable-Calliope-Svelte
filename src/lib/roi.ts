/**
 * Region-of-interest maths. A ROI is stored in the camera frame's own
 * coordinates (0..1, origin top-left, unmirrored) because that is what the
 * training and inference crop uses — see `drawWithRoi` in machine.ts.
 *
 * Every camera view in the app shows the feed mirrored, the way a mirror shows
 * you to yourself, so a ROI drawn or displayed on screen is horizontally
 * flipped against the stored one. {@link mirrorRoi} is the only place that
 * conversion happens; forget it and the box a user draws around their left hand
 * trains on whatever sits on the other side of the frame.
 */

import type { Roi } from '$lib/stores/projects';

/**
 * The region a project starts on: the largest centred square that fits the frame,
 * given its aspect (width / height). As much of the picture as possible, without
 * the distortion the full frame would bring.
 *
 * Squareness is worth the aspect argument because `drawWithRoi` squashes the
 * region into the model's square input without preserving its proportions. The
 * whole frame of a 4:3 camera therefore reaches the model stretched by a third —
 * not a training/inference mismatch, both paths squash identically, but a
 * distorted world handed to the feature extractor for no reason.
 */
export function defaultRoi(aspect: number): Roi {
  const landscape = aspect >= 1;
  const w = landscape ? 1 / aspect : 1;
  const h = landscape ? 1 : aspect;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/**
 * Convert between stored (camera-frame) and displayed (mirrored) coordinates.
 * The mapping is its own inverse, so the same call works in both directions.
 */
export function mirrorRoi(roi: Roi): Roi {
  return { x: 1 - roi.x - roi.w, y: roi.y, w: roi.w, h: roi.h };
}

/** "70×70 %" — the size of the region as a share of the frame. */
export function roiSizeLabel(roi: Roi): string {
  return `${Math.round(roi.w * 100)}×${Math.round(roi.h * 100)} %`;
}

/** Which edge or corner a resize drag moves; 'move' resizes nothing. */
export type RoiHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Snap a freshly-dragged box back to a pixel-square, leaving the edge or corner
 * the drag is anchored against where it was. `aspect` is the frame's
 * width / height, so a square in pixels is `h = w * aspect` in these normalized
 * coordinates.
 *
 * The point is not correctness — see {@link defaultRoi} — but keeping the region
 * undistorted by default without locking it: the caller skips this when the user
 * asks for a free aspect.
 */
export function squareRoi(
  roi: Roi,
  start: Roi,
  handle: RoiHandle,
  aspect: number,
  min = 0.05
): Roi {
  if (handle === 'move' || aspect <= 0) return roi;

  // On a corner, whichever side the pointer moved further follows the pointer and
  // the other one follows it — otherwise a diagonal drag would feel like it
  // snapped to one axis. Edge handles have only one candidate to begin with.
  const widthDrives =
    handle === 'e' || handle === 'w' ? true
    : handle === 'n' || handle === 's' ? false
    : Math.abs(roi.w - start.w) * aspect >= Math.abs(roi.h - start.h);

  let w = widthDrives ? roi.w : roi.h / aspect;
  let h = widthDrives ? roi.w * aspect : roi.h;

  // The floor belongs here rather than on the caller: a caller that clamps the
  // axis being dragged still derives the other one from it, and that one can come
  // out smaller — or, for a box handed in already collapsed, not positive at all.
  if (!(w > 0) || !(h > 0)) {
    w = min;
    h = min * aspect;
  }
  const grow = Math.max(1, min / w, min / h);
  w *= grow;
  h *= grow;

  // A square grown past an edge of the frame shrinks on both axes at once, so it
  // stays square instead of being clipped into a rectangle.
  const fit = Math.min(1 / w, 1 / h, 1);
  w *= fit;
  h *= fit;

  // The anchor is the side the drag is *not* moving. An axis the handle never
  // touched has no anchor, so it grows around where its centre was.
  const west = handle === 'w' || handle === 'nw' || handle === 'sw';
  const east = handle === 'e' || handle === 'ne' || handle === 'se';
  const north = handle === 'n' || handle === 'nw' || handle === 'ne';
  const south = handle === 's' || handle === 'sw' || handle === 'se';

  const x = west ? start.x + start.w - w : east ? start.x : start.x + (start.w - w) / 2;
  const y = north ? start.y + start.h - h : south ? start.y : start.y + (start.h - h) / 2;

  return {
    x: Math.max(0, Math.min(1 - w, x)),
    y: Math.max(0, Math.min(1 - h, y)),
    w,
    h
  };
}

/**
 * Pixel size the region ends up with inside a stored capture whose short side is
 * `short`. Below the model's input size the crop is upscaled on the way in — not
 * wrong, since training and inference upscale the same way, but worth saying out
 * loud in the editor.
 */
export function roiPixelSize(
  roi: Roi | null | undefined,
  aspect: number,
  short: number
): { w: number; h: number } {
  const frameW = short * Math.max(aspect, 1);
  const frameH = short * Math.max(1 / aspect, 1);
  const r = roi && roi.w > 0 && roi.h > 0 ? roi : { w: 1, h: 1 };
  return { w: Math.round(frameW * r.w), h: Math.round(frameH * r.h) };
}

/**
 * Inline style for an absolutely-positioned `<img>` inside an `overflow: hidden`
 * box, so that only the ROI is visible and fills the box. The region is
 * stretched to the box rather than letterboxed, which is exactly what training
 * does — `drawWithRoi` squashes the region into a 224² input without preserving
 * its aspect — so a cropped thumbnail shows the pixels the model really sees.
 *
 * The coordinates are the stored, unmirrored ones. Mirror the *box*, never the
 * image: flipping the image would move the crop window to the other side of the
 * frame and show the wrong region.
 */
export function roiCropStyle(roi: Roi | null | undefined): string {
  if (!roi || roi.w <= 0 || roi.h <= 0) return 'left:0; top:0; width:100%; height:100%;';
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
  return `left:${pct(-roi.x / roi.w)}; top:${pct(-roi.y / roi.h)};`
    + ` width:${pct(1 / roi.w)}; height:${pct(1 / roi.h)};`;
}
