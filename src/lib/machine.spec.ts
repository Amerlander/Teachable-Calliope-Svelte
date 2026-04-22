import { describe, expect, test, beforeEach } from 'vitest';
import { computeModelMetadataFromModel, updateModelMetadata } from './machine';
import { get } from 'svelte/store';
import { modelMetadata } from './stores';
import { currentProject, createBlankProject } from './stores/projects';

describe('computeModelMetadataFromModel', () => {
  test('computes params, layers, and sizeBytes from getWeights', () => {
    const model = {
      getWeights: () => [ { shape: [2, 3] }, { shape: [3] } ],
      layers: [ {}, {} ]
    } as any;

    const meta = computeModelMetadataFromModel(model);
    expect(meta.params).toBe(9); // 2*3 + 3
    expect(meta.layers).toBe(2);
    expect(meta.sizeBytes).toBe(9 * 4);
  });

  test('computes params from model.weights shape and handles missing shapes', () => {
    const model = {
      weights: [ { shape: [4, 4] }, { shape: [4] } ],
      layers: [ {}, {}, {} ]
    } as any;

    const meta = computeModelMetadataFromModel(model);
    expect(meta.params).toBe(4*4 + 4); // 20
    expect(meta.layers).toBe(3);
    expect(meta.sizeBytes).toBe(20 * 4);
  });

  test('returns zeros for null/undefined model', () => {
    expect(computeModelMetadataFromModel(null as any)).toEqual({ params: 0, layers: 0, sizeBytes: 0 });
    expect(computeModelMetadataFromModel(undefined as any)).toEqual({ params: 0, layers: 0, sizeBytes: 0 });
  });
});


describe('updateModelMetadata', () => {
  beforeEach(() => {
    const p = createBlankProject('Test');
    p.modelMetadata = { name: 'Test', date: '2020-01-01', version: '1.0', classes: [] };
    currentProject.set(p);
  });

  test('merges metadata fields into the store', () => {
    updateModelMetadata({ params: 1000, layers: 2 });
    const value = get(modelMetadata);
    expect(value.params).toBe(1000);
    expect(value.layers).toBe(2);
    // other fields remain
    expect(value.name).toBe('Test');
    expect(value.version).toBe('1.0');
  });
});
