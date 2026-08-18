/**
 * Running several models over the same picture.
 *
 * The rest of the app has exactly one model loaded at a time: `classifierModel`
 * holds it, `predictFromVideo` reads it, and switching models replaces it. A
 * comparison needs the opposite — two to four heads alive at once, none of them
 * "the" model — so it keeps its own set of classifiers here and never touches
 * the runtime one. Closing the comparison frees them again.
 *
 * What makes this affordable: the expensive half of a prediction is the feature
 * extractor, not the classifier head. Models that were trained with the same
 * extractor on the same image region see the identical embedding, so it is
 * computed once per frame and handed to each of them. Three models on
 * MobileNet v1 therefore cost about as much as one, and only a model with a
 * different extractor or region adds a second pass.
 */

import {
  computeModelMetadataFromModel,
  createClassifierFromArtifacts,
  disposeCompareExtractors,
  embedForCompare
} from '$lib/machine';
import {
  resolveFeatureExtractor,
  type FeatureExtractor,
  type Roi,
  type TrainedModel
} from '$lib/stores/projects';

/**
 * One identity per compared model, used for the dot next to its name and for
 * its curve in the shared chart — the two places a column has to be
 * recognisable at a glance. Everything else in the view stays monochrome, so
 * these are the only colours that carry meaning. The dash patterns repeat the
 * same distinction for anyone who cannot rely on the hue.
 */
export const COMPARE_COLORS = [
  '#1B1C1D',
  '#0F9B9D',
  '#2563EB',
  '#B45309',
  '#7C3AED',
  '#15803D',
  '#BE123C',
  '#0E7490'
];
export const COMPARE_DASHES = ['', '', '7 5', '3 4', '', '7 5', '3 4', '10 4 2 4'];

/**
 * Fewer than two is not a comparison. The upper end is not about the screen —
 * the columns scroll sideways — but about what still costs nothing: every model
 * beyond the first shares the extractor pass and only adds its own head.
 */
export const MIN_COMPARED = 2;
export const MAX_COMPARED = 8;

export type CompareEntry = {
  model: TrainedModel;
  /** This model's own classifier head — never the app's runtime classifier. */
  classifier: any;
  extractor: FeatureExtractor;
  /** What the classifier head weighs; the extractor is shared and not counted. */
  sizeBytes: number;
};

export type ModelPrediction = {
  modelId: string;
  /**
   * Raw softmax output in the model's own class order. Deliberately raw: each
   * model carries its own per-class calibration windows, and mapping every
   * column through a different set of windows would compare the calibration
   * rather than the models.
   */
  probs: number[];
  topIndex: number;
  topLabel: string;
  topProb: number;
  /**
   * What one image costs this model on its own — its share of the embedding
   * plus its own head. Models that shared an embedding are each charged the
   * full amount, because that is what each would cost if it ran alone.
   */
  ms: number;
};

type Group = {
  extractor: FeatureExtractor;
  roi: Roi | null;
  entries: CompareEntry[];
};

function roiKey(roi: Roi | null | undefined): string {
  return roi && roi.w > 0 && roi.h > 0 ? `${roi.x},${roi.y},${roi.w},${roi.h}` : 'full';
}

/** Models that see the identical picture, so one embedding serves all of them. */
function groupBySource(entries: CompareEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    const roi = entry.model.roi ?? null;
    const key = `${entry.extractor}|${roiKey(roi)}`;
    const found = groups.get(key);
    if (found) found.entries.push(entry);
    else groups.set(key, { extractor: entry.extractor, roi, entries: [entry] });
  }
  return [...groups.values()];
}

/**
 * All classes any of the models knows, in the order they are first met. The
 * comparison lists them as rows, so a model missing one shows a gap instead of
 * a zero — a class it was never trained on has no probability, and printing
 * 0 % would read like "this model is sure it is not that".
 */
export function unionClasses(models: TrainedModel[]): string[] {
  const seen: string[] = [];
  for (const model of models) {
    for (const label of model.classes) {
      if (!seen.includes(label)) seen.push(label);
    }
  }
  return seen;
}

export async function loadComparison(models: TrainedModel[]): Promise<CompareEntry[]> {
  const entries: CompareEntry[] = [];
  try {
    for (const model of models) {
      const classifier = await createClassifierFromArtifacts(model.artifacts);
      entries.push({
        model,
        classifier,
        extractor: resolveFeatureExtractor(model.featureExtractor),
        sizeBytes: model.metadata?.sizeBytes || computeModelMetadataFromModel(classifier).sizeBytes
      });
    }
  } catch (err) {
    // Half a comparison is worse than none: the heads loaded so far would sit
    // in GPU memory with nothing left holding a reference to them.
    await disposeComparison(entries);
    throw err;
  }
  return entries;
}

export async function disposeComparison(entries: CompareEntry[]): Promise<void> {
  for (const entry of entries) {
    try {
      entry.classifier?.dispose?.();
    } catch {
      /* already gone */
    }
  }
  await disposeCompareExtractors();
}

function toPrediction(entry: CompareEntry, probs: number[], ms: number): ModelPrediction {
  let topIndex = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[topIndex]) topIndex = i;
  }
  return {
    modelId: entry.model.id,
    probs,
    topIndex,
    topLabel: entry.model.classes[topIndex] ?? `Klasse ${topIndex + 1}`,
    topProb: probs[topIndex] ?? 0,
    ms
  };
}

/**
 * One picture through every model. The result keeps the order of `entries`, so
 * the columns never reshuffle between frames.
 */
export async function predictAll(
  entries: CompareEntry[],
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<ModelPrediction[]> {
  const byId = new Map<string, ModelPrediction>();

  for (const group of groupBySource(entries)) {
    const embedStarted = performance.now();
    const embedding = await embedForCompare(source, group.roi, group.extractor);
    const embedMs = performance.now() - embedStarted;
    const batched = embedding.expandDims(0);
    try {
      for (const entry of group.entries) {
        const started = performance.now();
        const output: any = entry.classifier.predict(batched);
        const probs = Array.from((await output.data()) as Float32Array, Number);
        const ms = embedMs + (performance.now() - started);
        try {
          output.dispose?.();
        } catch {
          /* ignore */
        }
        byId.set(entry.model.id, toPrediction(entry, probs, ms));
      }
    } finally {
      batched.dispose();
      embedding.dispose();
    }
  }

  return entries.map((entry) => byId.get(entry.model.id)).filter(Boolean) as ModelPrediction[];
}

export type ModelTestResult = {
  modelId: string;
  /** The model's own classes — the rows and columns of its matrix. */
  classes: string[];
  /** matrix[actual][predicted], counted only over images of classes it knows. */
  matrix: number[][];
  /** Images whose class this model was trained on; the rest it cannot get right. */
  total: number;
  correct: number;
  /** Of the correct ones, how many it was actually sure about. */
  confident: number;
  perClass: { label: string; total: number; correct: number }[];
};

export type Disagreement = {
  src: string;
  trueLabel: string;
  verdicts: { modelId: string; label: string; prob: number }[];
};

export type TestRunResult = {
  perModel: ModelTestResult[];
  /** Images where the models did not all name the same class. */
  disagreements: Disagreement[];
  images: number;
  agreed: number;
};

/**
 * Every recorded example through every model — the fair comparison, because all
 * of them get the same pictures. A model is only scored on images of classes it
 * knows, but it predicts all of them: a class it never learnt still produces an
 * answer, and that answer is exactly what the disagreement list is for.
 *
 * These are the project's own training images, so the numbers come out
 * friendlier than the camera will be. The view says so.
 */
export async function runOverExamples(
  entries: CompareEntry[],
  examples: Record<string, { data: string }[]>,
  opts: {
    confidenceThreshold?: number;
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean;
    maxDisagreements?: number;
  } = {}
): Promise<TestRunResult> {
  const threshold = opts.confidenceThreshold ?? 0.6;
  const maxDisagreements = opts.maxDisagreements ?? 60;

  const results = new Map<string, ModelTestResult>();
  for (const entry of entries) {
    const n = entry.model.classes.length;
    results.set(entry.model.id, {
      modelId: entry.model.id,
      classes: entry.model.classes,
      matrix: Array.from({ length: n }, () => Array.from({ length: n }, () => 0)),
      total: 0,
      correct: 0,
      confident: 0,
      perClass: entry.model.classes.map((label) => ({ label, total: 0, correct: 0 }))
    });
  }

  const work: { label: string; src: string }[] = [];
  for (const [label, images] of Object.entries(examples)) {
    for (const image of images) work.push({ label, src: image.data });
  }

  const disagreements: Disagreement[] = [];
  let done = 0;
  let agreed = 0;
  opts.onProgress?.(0, work.length);

  for (const item of work) {
    if (opts.shouldStop?.()) break;

    const img = new Image();
    img.src = item.src;
    try {
      await img.decode();
    } catch {
      // A stored capture that no longer decodes is skipped rather than aborting
      // a run over hundreds of images.
      done++;
      continue;
    }

    const predictions = await predictAll(entries, img);
    const verdicts = predictions.map((p) => ({
      modelId: p.modelId,
      label: p.topLabel,
      prob: p.topProb
    }));

    for (const prediction of predictions) {
      const result = results.get(prediction.modelId);
      const entry = entries.find((e) => e.model.id === prediction.modelId);
      if (!result || !entry) continue;
      const trueIndex = entry.model.classes.indexOf(item.label);
      if (trueIndex < 0) continue;
      result.total++;
      result.perClass[trueIndex].total++;
      result.matrix[trueIndex][prediction.topIndex]++;
      if (prediction.topIndex === trueIndex) {
        result.correct++;
        result.perClass[trueIndex].correct++;
        if (prediction.topProb >= threshold) result.confident++;
      }
    }

    const allAgree = verdicts.every((v) => v.label === verdicts[0]?.label);
    if (allAgree) agreed++;
    else if (disagreements.length < maxDisagreements) {
      disagreements.push({ src: item.src, trueLabel: item.label, verdicts });
    }

    done++;
    opts.onProgress?.(done, work.length);
    // Hundreds of images would otherwise hold the main thread for the whole run
    // and freeze the progress it is reporting.
    if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  return {
    perModel: entries.map((e) => results.get(e.model.id)!).filter(Boolean),
    disagreements,
    images: done,
    agreed
  };
}
