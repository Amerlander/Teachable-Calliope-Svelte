import { describe, expect, test } from 'vitest';
import {
  CLASS_THRESHOLD,
  DEFAULT_SMOOTHING,
  MAX_SMOOTHING,
  MIN_RANGE_SPAN,
  MIN_SMOOTHING,
  normalizeSmoothing,
  displayScore,
  mapScore,
  normalizeRange,
  pickWinnerIndex,
  rangesFromScores,
  rawTriggerPoint,
  wireScore
} from './calibration';

describe('normalizeRange', () => {
  test('keeps a usable window as it is', () => {
    expect(normalizeRange({ lo: 0.2, hi: 0.8 })).toEqual({ lo: 0.2, hi: 0.8 });
  });

  test('falls back to the neutral window', () => {
    expect(normalizeRange(undefined)).toEqual({ lo: 0, hi: 1 });
  });

  test('opens a collapsed window upwards so the mapping stays finite', () => {
    expect(normalizeRange({ lo: 0.5, hi: 0.5 })).toEqual({ lo: 0.5, hi: 0.5 + MIN_RANGE_SPAN });
  });

  test('pushes the lower end down when there is no room above', () => {
    expect(normalizeRange({ lo: 1, hi: 1 })).toEqual({ lo: 1 - MIN_RANGE_SPAN, hi: 1 });
  });
});

describe('normalizeSmoothing', () => {
  test('falls back to the default for anything unusable', () => {
    expect(normalizeSmoothing(undefined)).toBe(DEFAULT_SMOOTHING);
    expect(normalizeSmoothing(NaN)).toBe(DEFAULT_SMOOTHING);
    expect(normalizeSmoothing('7' as unknown)).toBe(DEFAULT_SMOOTHING);
  });

  test('rounds and holds the slider bounds', () => {
    expect(normalizeSmoothing(3.4)).toBe(3);
    expect(normalizeSmoothing(0)).toBe(MIN_SMOOTHING);
    expect(normalizeSmoothing(999)).toBe(MAX_SMOOTHING);
  });
});

describe('mapScore', () => {
  test('maps the window ends onto 0 and 1', () => {
    const range = { lo: 0.2, hi: 0.6 };
    expect(mapScore(0.2, range)).toBeCloseTo(0);
    expect(mapScore(0.6, range)).toBeCloseTo(1);
    expect(mapScore(0.4, range)).toBeCloseTo(0.5);
  });

  test('runs past the window instead of clamping', () => {
    const range = { lo: 0.2, hi: 0.6 };
    expect(mapScore(0.8, range)).toBeCloseTo(1.5);
    expect(mapScore(0.1, range)).toBeCloseTo(-0.25);
  });

  test('the neutral window leaves the value untouched', () => {
    expect(mapScore(0.37, { lo: 0, hi: 1 })).toBeCloseTo(0.37);
  });
});

describe('displayScore / wireScore', () => {
  test('clamp what is shown and sent', () => {
    expect(displayScore(1.5)).toBe(1);
    expect(displayScore(-0.25)).toBe(0);
    expect(wireScore(1.5)).toBe(100);
    expect(wireScore(-0.25)).toBe(0);
    expect(wireScore(0.615)).toBe(62);
  });
});

describe('rawTriggerPoint', () => {
  test('reads the fixed threshold back through the window', () => {
    expect(rawTriggerPoint({ lo: 0.2, hi: 0.7 })).toBeCloseTo(0.2 + 0.5 * CLASS_THRESHOLD);
    // With the neutral window the trigger sits at the threshold itself.
    expect(rawTriggerPoint({ lo: 0, hi: 1 })).toBeCloseTo(CLASS_THRESHOLD);
  });
});

describe('pickWinnerIndex', () => {
  test('nothing wins below the threshold', () => {
    expect(pickWinnerIndex([0.3, 0.59])).toBe(-1);
  });

  test('the highest score above the threshold wins', () => {
    expect(pickWinnerIndex([0.65, 0.9, 0.2])).toBe(1);
  });

  test('two saturated classes are still ordered', () => {
    // Both would read 100% once clamped — the unclamped values break the tie.
    expect(pickWinnerIndex([1.2, 1.9])).toBe(1);
  });

  test('the previous winner holds down to the release threshold', () => {
    expect(pickWinnerIndex([0.57, 0.3], 0)).toBe(0);
    expect(pickWinnerIndex([0.54, 0.3], 0)).toBe(-1);
  });

  test('another class above the threshold takes over from the held one', () => {
    expect(pickWinnerIndex([0.57, 0.8], 0)).toBe(1);
  });

  test('a previous index that no longer exists is ignored', () => {
    expect(pickWinnerIndex([0.4, 0.4], 7)).toBe(-1);
  });
});

describe('rangesFromScores', () => {
  test('puts 0% where other classes top out and 100% at the class median', () => {
    const labels = ['a', 'b'];
    const rows = [
      { trueIndex: 0, probs: [0.7, 0.3] },
      { trueIndex: 0, probs: [0.8, 0.2] },
      { trueIndex: 1, probs: [0.2, 0.8] },
      { trueIndex: 1, probs: [0.1, 0.9] }
    ];
    const ranges = rangesFromScores(labels, rows);
    // Class a: negatives 0.2/0.1 → p90 = 0.19; positives 0.7/0.8 → median 0.75.
    expect(ranges.a.lo).toBeCloseTo(0.19);
    expect(ranges.a.hi).toBeCloseTo(0.75);
    // A typical own example lands at full scale, so it clears the threshold.
    expect(mapScore(0.75, ranges.a)).toBeGreaterThanOrEqual(CLASS_THRESHOLD);
    // Confusion from the other class stays well below it.
    expect(mapScore(0.2, ranges.a)).toBeLessThan(CLASS_THRESHOLD);
  });

  test('falls back to the class own spread when the ends would cross', () => {
    const labels = ['a', 'b'];
    // Class a never separates: its own examples score lower than b's do on a.
    const rows = [
      { trueIndex: 0, probs: [0.3, 0.7] },
      { trueIndex: 0, probs: [0.4, 0.6] },
      { trueIndex: 1, probs: [0.9, 0.1] }
    ];
    const ranges = rangesFromScores(labels, rows);
    expect(ranges.a.hi - ranges.a.lo).toBeGreaterThanOrEqual(MIN_RANGE_SPAN);
    expect(ranges.a.lo).toBeCloseTo(0.31);
    expect(ranges.a.hi).toBeCloseTo(0.39);
  });

  test('a class without examples keeps the neutral window', () => {
    const ranges = rangesFromScores(['a', 'b'], [{ trueIndex: 0, probs: [0.9, 0.1] }]);
    expect(ranges.b).toEqual({ lo: 0, hi: 1 });
  });
});
