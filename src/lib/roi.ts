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

/** Starting box when the user first defines a region. */
export const DEFAULT_ROI: Roi = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };

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
