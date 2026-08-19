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

/** Side of a stored cover, in pixels. Big enough for a 64 px slot on a 2× screen. */
export const CLASS_THUMB_SIZE = 160;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
    img.src = src;
  });
}

/**
 * A square cover from an example image, centre-cropped.
 *
 * Cropped rather than letterboxed: these are shown in small square slots, and a
 * letterboxed thumbnail spends a third of an already tiny box on black bars.
 * The encoding follows the source — camera captures are JPEG, pose captures are
 * flat-coloured line art on black where JPEG rings around every bone.
 */
export async function makeClassThumb(
  dataUrl: string,
  size = CLASS_THUMB_SIZE
): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('Bild hat keine Größe');
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kein 2D-Kontext');
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
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
