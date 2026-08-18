/**
 * The confusion matrix, computed once per model and kept on it.
 *
 * Measuring it means running every example image through MobileNet and the
 * model's head again, which takes seconds. Three places want the numbers — the
 * curves' second tab, the classes pane and the confusion pane of the details
 * dialog — so this module owns them:
 *
 *  - a finished matrix is stored on the model together with a fingerprint of the
 *    images it was measured on, so reopening a view costs nothing
 *  - a running measurement is shared: whoever asks while it runs joins it
 *    instead of starting a second one
 *  - it is not tied to a component. Closing the dialog or switching panes leaves
 *    the run going, and its result lands on the model when it finishes
 */

import { get, writable, type Readable } from 'svelte/store';
import { examples } from '$lib/stores';
import { setModelConfusion, type TrainedModel } from '$lib/stores/projects';
import { createClassifierFromArtifacts, scoreExamplesWith } from '$lib/machine';

export type ConfusionResult = NonNullable<TrainedModel['confusion']>;

/**
 * Bumped when the fingerprint's own recipe changes, which invalidates every
 * stored matrix rather than comparing keys that mean different things.
 */
const FINGERPRINT_VERSION = 'c1';

/**
 * A cheap fingerprint of the images a matrix was measured on: class names and
 * counts, plus each image's length and every 64th character. Enough to notice
 * added, removed, retaken or reordered images without walking megabytes of
 * base64 on every dialog open. It is a cache key, not a checksum — two
 * different images of exactly equal length whose sampled characters all match
 * would collide, which does not happen with camera captures.
 */
export function examplesFingerprint(
  model: TrainedModel,
  ex?: Record<string, { data: string }[]>
): string {
  const map = ex ?? get(examples);
  // FNV-1a, 32 bit. Small, no dependency, good enough to key a cache on.
  let hash = 0x811c9dc5;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  feed(FINGERPRINT_VERSION);
  for (const className of model.classes) {
    const list = map[className] ?? [];
    feed(`|${className}:${list.length}`);
    for (const item of list) {
      const data = item?.data ?? '';
      feed(`#${data.length}`);
      for (let i = 0; i < data.length; i += 64) {
        hash ^= data.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
    }
  }
  return (hash >>> 0).toString(36);
}

/**
 * The stored matrix when it still describes the current images, else null.
 *
 * Pass the example map from a component (`$examples`) so the reading `$derived`
 * re-runs when images are recorded or deleted.
 */
export function cachedConfusion(
  model: TrainedModel | null,
  ex?: Record<string, { data: string }[]>
): ConfusionResult | null {
  if (!model?.confusion) return null;
  return model.confusion.key === examplesFingerprint(model, ex) ? model.confusion : null;
}

// Model ids with a measurement in flight. A store so the views can say so, a
// map so a second asker joins the first one's promise.
const runningIds = writable<string[]>([]);
export const confusionRunning: Readable<string[]> = { subscribe: runningIds.subscribe };
const inFlight = new Map<string, Promise<ConfusionResult | null>>();

/**
 * The matrix for this model: from the cache, from a run already going, or from a
 * new run. Rejects when scoring fails, so callers can show that.
 */
export function ensureConfusion(model: TrainedModel): Promise<ConfusionResult | null> {
  const cached = cachedConfusion(model);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(model.id);
  if (existing) return existing;

  const run = compute(model).finally(() => {
    inFlight.delete(model.id);
    runningIds.update((ids) => ids.filter((id) => id !== model.id));
  });
  inFlight.set(model.id, run);
  runningIds.update((ids) => (ids.includes(model.id) ? ids : [...ids, model.id]));
  return run;
}

async function compute(model: TrainedModel): Promise<ConfusionResult | null> {
  // Taken before scoring. If images change while this runs, the stored key
  // describes the state that was measured, so the next read sees a mismatch and
  // measures again rather than showing numbers for images that are gone.
  const key = examplesFingerprint(model);

  // A head of this model's own, so the run stays correct even if the app loads
  // another model in the meantime.
  const head = await createClassifierFromArtifacts(model.artifacts);
  try {
    const { classes, rows } = await scoreExamplesWith(model, head);
    const n = classes.length;
    const matrix: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
    for (const row of rows) {
      let best = 0;
      for (let k = 1; k < row.probs.length; k++) if (row.probs[k] > row.probs[best]) best = k;
      if (matrix[row.trueIndex]) matrix[row.trueIndex][best]++;
    }
    const result: ConfusionResult = {
      matrix,
      classes,
      key,
      computedAt: Date.now(),
      samples: rows.length
    };
    setModelConfusion(model.id, result);
    return result;
  } finally {
    try {
      head.dispose?.();
    } catch {
      /* a head that is already gone needs no disposing */
    }
  }
}
