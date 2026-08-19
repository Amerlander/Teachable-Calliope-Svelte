/**
 * The one picture that stands for a class.
 *
 * A class is a name and a pile of examples, and every list that shows classes —
 * the class list in Trainieren, the model menu, the detection readout in
 * Anwenden — had only the name to show. This is the cover: by default the first
 * example that was recorded, replaceable by any other one the user picks.
 *
 * It is stored as its own downscaled copy rather than as a reference into the
 * example list, and that is the point of it. Examples get deleted, re-recorded
 * and cleared; a model keeps its classes long after the project's list has moved
 * on. A cover that pointed at `examples[cls][0]` would go blank in all of those
 * cases, which is exactly when it is still wanted.
 */

import type { Roi } from '$lib/stores/projects';

/**
 * A stored cover, together with the region it may be cut down to.
 *
 * `roi` is null whenever nothing can be cut: a cover from before COVER_VERSION, a
 * pose project, a model trained on the whole picture. Whoever looks the cover up
 * decides that — it is the one that knows which map it came out of.
 */
export type ClassCover = { src: string; roi: Roi | null };

/**
 * Short side of a stored cover, in pixels.
 *
 * Large enough that a *part* of it still holds up where covers are drawn biggest
 * — the picture row in Anwenden, on a 2× screen — since a view may cut the frame
 * down to the model's region before showing it.
 */
export const CLASS_THUMB_SHORT = 400;

/**
 * What a stored cover contains. Kept beside every map of them (see
 * `classThumbsVersion` on Project and TrainedModel) because the two cannot be
 * told apart by looking at them, and cutting a region out of one that has already
 * been cut is how a cover ends up showing a corner of itself.
 *
 *  1 — a square, already cut out of the frame: centred, or to whatever region was
 *      set when it was made. Nothing further can be cut from it.
 *  2 — the whole camera frame, downscaled. A view cuts what it wants.
 */
export const COVER_VERSION = 2;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
    img.src = src;
  });
}

/**
 * A cover from an example image: the whole frame, downscaled.
 *
 * Uncut on purpose. A cover is shown in several places that want different
 * framings — the class list wants a picture of the class, and Anwenden showing
 * nothing but the model's region wants the cover to agree with what is on the
 * stage. Cutting at this point would fix one of those and lose the other, and the
 * region can still be moved afterwards, which would leave every cover stale.
 *
 * So the crop lives at the display end (`roiCropStyle` in $lib/roi) and this
 * keeps the picture it was given. A square slot showing the frame with
 * `object-fit: cover` lands on the same centre square that used to be stored,
 * which is why nothing that shows a cover had to change.
 *
 * The encoding follows the source — camera captures are JPEG, pose captures are
 * flat-coloured line art on black where JPEG rings around every bone.
 */
export async function makeClassThumb(
  dataUrl: string,
  short = CLASS_THUMB_SHORT
): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('Bild hat keine Größe');
  // Never upscaled: a capture is already small, and a cover twice its size is
  // twice the bytes in the project for no more detail.
  const scale = Math.min(1, short / Math.min(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kein 2D-Kontext');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return dataUrl.startsWith('data:image/png')
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * The covers belonging to `classes`, or undefined if none of them has one.
 *
 * Used when a model is recorded: it copies the covers for its own classes off
 * the project, so it stays as self-describing about them as it is about the
 * class list itself.
 */
export function pickClassThumbs(
  thumbs: Record<string, string> | undefined,
  classes: string[]
): Record<string, string> | undefined {
  if (!thumbs) return undefined;
  const out: Record<string, string> = {};
  for (const cls of classes) {
    if (thumbs[cls]) out[cls] = thumbs[cls];
  }
  return Object.keys(out).length ? out : undefined;
}
