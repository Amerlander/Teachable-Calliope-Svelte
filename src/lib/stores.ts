import { derived, writable, get } from 'svelte/store';
import { currentProject, scheduleSave, updateProject } from './stores/projects';
import type { ModelMetadata, TrainingHistory, TrainingOptions } from './stores/projects';

export type { ModelMetadata, TrainingHistory, TrainingOptions };

// --- Project-backed reactive views ---
// These are derived from the current project so the UI auto-updates on project switch.
export const classes = derived(currentProject, (p) => p?.classes ?? []);
export const examples = derived(currentProject, (p) => p?.examples ?? {});
export const activeClass = derived(currentProject, (p) => p?.activeClass ?? null);
export const trainingHistory = derived(
  currentProject,
  (p): TrainingHistory => p?.trainingHistory ?? { epochs: [], accuracy: [], loss: [] }
);
export const modelMetadata = derived(
  currentProject,
  (p): ModelMetadata =>
    p?.modelMetadata ?? { name: '', date: '', version: '', classes: [] }
);
export const trainingOptions = derived(
  currentProject,
  (p): TrainingOptions =>
    p?.trainingOptions ?? { epochs: 30, batchSize: 16, learningRate: 0.001, hiddenUnits: 64, augmentation: false }
);

// --- Runtime-only state (not persisted in project snapshot) ---
export const mobilenetModel = writable<any>(null);
export const classifierModel = writable<any>(null);

export const videoRefs = writable<{
  webcam?: HTMLVideoElement | null;
  webcamTest?: HTMLVideoElement | null;
  webcamTryout?: HTMLVideoElement | null;
}>({});

export function setVideoRef(
  key: 'webcam' | 'webcamTest' | 'webcamTryout',
  el: HTMLVideoElement | null
) {
  videoRefs.update((v) => {
    v[key] = el;
    return v;
  });
}

// --- Class mutation actions (route through currentProject) ---
export function addClass(name: string): void {
  if (!name) return;
  updateProject((p) => {
    if (p.classes.includes(name)) return;
    p.classes.push(name);
    if (!p.examples[name]) p.examples[name] = [];
    p.activeClass = name;
  });
}

export function setActiveClass(name: string | null): void {
  updateProject((p) => {
    p.activeClass = name;
  });
}

export function pushExample(name: string, data: string): void {
  if (!name) return;
  updateProject((p) => {
    if (!p.examples[name]) p.examples[name] = [];
    p.examples[name].push({ data });
  });
}

export function clearClass(name: string): void {
  updateProject((p) => {
    if (p.examples[name]) p.examples[name] = [];
  });
}

export function removeClass(name: string): void {
  updateProject((p) => {
    p.classes = p.classes.filter((c) => c !== name);
    delete p.examples[name];
    if (p.activeClass === name) p.activeClass = p.classes[0] ?? null;
  });
}

// --- Model/history mutation actions ---
export function setTrainingHistory(h: TrainingHistory): void {
  updateProject((p) => {
    p.trainingHistory = h;
  });
}

export function appendTrainingEpoch(epoch: number, accuracy: number, loss: number): void {
  updateProject((p) => {
    p.trainingHistory.epochs.push(epoch);
    p.trainingHistory.accuracy.push(accuracy);
    p.trainingHistory.loss.push(loss);
  });
}

export function updateModelMetadata(patch: Partial<ModelMetadata>): void {
  updateProject((p) => {
    p.modelMetadata = { ...p.modelMetadata, ...patch };
  });
}

export function setTrainingOptions(patch: Partial<TrainingOptions>): void {
  updateProject((p) => {
    p.trainingOptions = { ...p.trainingOptions, ...patch };
  });
}

export function setModelArtifacts(
  artifacts: { topology: unknown; weightSpecs: unknown[]; weightData: ArrayBuffer } | null
): void {
  updateProject((p) => {
    p.modelArtifacts = artifacts;
  });
}
