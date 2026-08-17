/**
 * Per-class output calibration.
 *
 * A model's raw output for a class is a probability the training data happens to
 * produce — with five classes a well-recognised object may sit at 45 %, and a
 * class the model is unsure about may never pass 30 %. Comparing that number
 * against a per-class threshold means one control does two jobs at once: it sets
 * where the scale starts *and* where the decision falls.
 *
 * Here those two are separated. Each class carries a {@link ClassRange}: the raw
 * value that should read as 0 % and the one that should read as 100 %. Everything
 * the user and the Calliope see is the mapped value — the raw probability only
 * shows up in the mapping editor. The decision is then one fixed rule for every
 * class: mapped >= {@link CLASS_THRESHOLD} counts as detected, and among the
 * classes that clear it the highest wins.
 *
 * Mapped values are computed unclamped so two saturated classes can still be
 * ordered, and clamped to 0–100 % only where they are shown or sent.
 */

/** Raw-probability window that maps onto 0–100 %. Both ends are 0–1. */
export type ClassRange = { lo: number; hi: number };

/** Mapped equals raw — the neutral starting point for every model. */
export const DEFAULT_CLASS_RANGE: ClassRange = { lo: 0, hi: 1 };

/** Narrowest window we allow, so the mapping's gain stays finite. */
export const MIN_RANGE_SPAN = 0.05;

/** A class counts as detected from this mapped value up. Fixed for every class. */
export const CLASS_THRESHOLD = 0.6;

/**
 * Once detected, a class stays detected until it drops below this. The gap to
 * {@link CLASS_THRESHOLD} keeps a value hovering around the threshold from
 * flapping the detection on and off frame by frame.
 */
export const CLASS_THRESHOLD_RELEASE = 0.55;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Force a stored or user-supplied window into a usable one. */
export function normalizeRange(r: Partial<ClassRange> | undefined | null): ClassRange {
  let lo = clamp01(typeof r?.lo === 'number' ? r.lo : DEFAULT_CLASS_RANGE.lo);
  let hi = clamp01(typeof r?.hi === 'number' ? r.hi : DEFAULT_CLASS_RANGE.hi);
  if (hi - lo < MIN_RANGE_SPAN) {
    // Open the window upwards, and only push the lower end down when the upper
    // one has no room left.
    hi = lo + MIN_RANGE_SPAN;
    if (hi > 1) {
      hi = 1;
      lo = 1 - MIN_RANGE_SPAN;
    }
  }
  return { lo, hi };
}

/** The window for one class, falling back to the neutral one. */
export function rangeFor(
  ranges: Record<string, ClassRange> | undefined | null,
  cls: string,
): ClassRange {
  return normalizeRange(ranges?.[cls]);
}

/**
 * Map a raw probability onto the 0–1 scale the window describes. Not clamped:
 * a value above the window reads over 1, one below it reads negative. Callers
 * that show or transmit the number pass it through {@link displayScore}.
 */
export function mapScore(p: number, range: ClassRange): number {
  const r = normalizeRange(range);
  return (p - r.lo) / (r.hi - r.lo);
}

/** Map every class's probability in `labels` order. Unclamped, see {@link mapScore}. */
export function mapScores(
  labels: string[],
  probabilities: number[],
  ranges: Record<string, ClassRange> | undefined | null,
): number[] {
  return labels.map((cls, i) => mapScore(probabilities[i] ?? 0, rangeFor(ranges, cls)));
}

/** The 0–1 value to show or send for a mapped score. */
export function displayScore(mapped: number): number {
  return clamp01(mapped);
}

/** The 0–100 integer the Calliope receives for a mapped score. */
export function wireScore(mapped: number): number {
  return Math.round(displayScore(mapped) * 100);
}

/**
 * The raw probability at which a class starts to count as detected — the fixed
 * threshold read back through the mapping. Shown in the editor so the effect of
 * moving a handle stays traceable.
 */
export function rawTriggerPoint(range: ClassRange): number {
  const r = normalizeRange(range);
  return r.lo + CLASS_THRESHOLD * (r.hi - r.lo);
}

/**
 * The detected class among mapped scores, or -1 when none qualifies. The highest
 * score wins as long as it clears {@link CLASS_THRESHOLD}; `previous` (the class
 * detected on the last frame) holds on down to {@link CLASS_THRESHOLD_RELEASE}
 * while nothing else clears the threshold.
 */
export function pickWinnerIndex(mapped: number[], previous = -1): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < mapped.length; i++) {
    const v = mapped[i] ?? -Infinity;
    if (v > bestScore) {
      bestScore = v;
      best = i;
    }
  }
  if (best < 0) return -1;
  if (bestScore >= CLASS_THRESHOLD) return best;
  const held = mapped[previous] ?? -Infinity;
  if (previous >= 0 && held >= CLASS_THRESHOLD_RELEASE) return previous;
  return -1;
}

/** Linear-interpolated quantile of an unsorted sample. */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.max(0, Math.min(1, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** One scored example: the class it belongs to, and the model's output vector. */
export type ScoredExample = { trueIndex: number; probs: number[] };

/**
 * Derive a window per class from the model's behaviour on the recorded examples.
 *
 * 0 % is put where examples of *other* classes top out (their 90th percentile),
 * 100 % where the class's *own* examples typically sit (their median). A typical
 * own example therefore reads full scale and clears the threshold with room to
 * spare, while confusion from other classes stays near zero. Classes the model
 * separates badly leave those two ends crossed; there the class's own spread
 * (10th to 90th percentile) is used instead, which at least stretches whatever
 * range the class does produce.
 */
export function rangesFromScores(
  labels: string[],
  rows: ScoredExample[],
): Record<string, ClassRange> {
  const out: Record<string, ClassRange> = {};
  for (let i = 0; i < labels.length; i++) {
    const positives: number[] = [];
    const negatives: number[] = [];
    for (const row of rows) {
      const p = row.probs[i] ?? 0;
      if (row.trueIndex === i) positives.push(p);
      else negatives.push(p);
    }
    if (positives.length === 0) {
      out[labels[i]] = { ...DEFAULT_CLASS_RANGE };
      continue;
    }
    let lo = negatives.length ? quantile(negatives, 0.9) : 0;
    let hi = quantile(positives, 0.5);
    if (hi - lo < MIN_RANGE_SPAN) {
      lo = quantile(positives, 0.1);
      hi = quantile(positives, 0.9);
    }
    out[labels[i]] = normalizeRange({ lo, hi });
  }
  return out;
}
