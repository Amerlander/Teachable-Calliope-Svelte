import { derived, writable, get } from 'svelte/store';
import { activeModel, currentProject, scheduleSave, updateProject } from './stores/projects';
import type { ModelMetadata, Roi, TrainingHistory, TrainingOptions } from './stores/projects';

export type { ModelMetadata, Roi, TrainingHistory, TrainingOptions };

// --- Project-backed reactive views ---
// These are derived from the current project so the UI auto-updates on project switch.
export const classes = derived(currentProject, (p) => p?.classes ?? []);
export const examples = derived(currentProject, (p) => p?.examples ?? {});
export const activeClass = derived(currentProject, (p) => p?.activeClass ?? null);
/**
 * Labels that belong to the classifier currently in memory: the class list the
 * selected model was trained on, not the classes the user has since added or
 * renamed. Falls back to the live list when no history entry backs the model
 * (imported ZIP, or nothing trained yet).
 */
export const predictionClasses = derived(
  [activeModel, classes],
  ([m, live]) => (m?.classes?.length ? m.classes : live)
);
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
/**
 * The region the *next* training run will crop to, in camera-frame coordinates
 * (see $lib/roi). Project-backed like the training options next to it, and for
 * the same reason: it describes the model being composed, and a framing the user
 * spent time on has to still be there after a run, after a model switch and
 * after a reload — see `Project.draftRoi`.
 *
 * null means "not picked yet", not "whole image": the camera panel fills it in
 * with the largest centred square as soon as it knows the camera's aspect. On a
 * *model* (see TrainedModel.roi) a null still does mean the whole frame, which is
 * what models trained before regions existed carry.
 */
export const draftRoi = derived(currentProject, (p): Roi | null => p?.draftRoi ?? null);

// --- Training readiness ---
// Training only makes sense once every class can actually carry an output: the
// classifier gets one unit per class, so a class left empty becomes a dead
// output that can never win a prediction. Both thresholds and the hint text
// live here so the sidebar CTA and the train button can never disagree about
// what "ready" means.
export const MIN_CLASSES_FOR_TRAINING = 3;
export const MIN_EXAMPLES_PER_CLASS = 10;

export type TrainingReadiness = {
  ready: boolean;
  /** Classes that already hold MIN_EXAMPLES_PER_CLASS examples. */
  readyClasses: number;
  /** Classes that exist but still have too few examples. */
  shortClasses: number;
  /** What is still missing, or null once ready. */
  hint: string | null;
};

export const trainingReadiness = derived(
  [classes, examples],
  ([cls, ex]): TrainingReadiness => {
    const short = cls.filter((c) => (ex[c]?.length ?? 0) < MIN_EXAMPLES_PER_CLASS).length;
    const readyClasses = cls.length - short;
    const ready = cls.length >= MIN_CLASSES_FOR_TRAINING && short === 0;
    let hint: string | null = null;
    if (!ready) {
      hint =
        cls.length < MIN_CLASSES_FOR_TRAINING
          ? `Mindestens ${MIN_CLASSES_FOR_TRAINING} Klassen mit je ${MIN_EXAMPLES_PER_CLASS} Bildern nötig (${readyClasses}/${MIN_CLASSES_FOR_TRAINING})`
          : short === 1
            ? `Noch eine Klasse braucht mindestens ${MIN_EXAMPLES_PER_CLASS} Bilder`
            : `Noch ${short} Klassen brauchen mindestens ${MIN_EXAMPLES_PER_CLASS} Bilder`;
    }
    return { ready, readyClasses, shortClasses: short, hint };
  }
);

// --- Runtime-only state (not persisted in project snapshot) ---
export const mobilenetModel = writable<any>(null);
export const classifierModel = writable<any>(null);

/**
 * Every video element that shows the live camera feed. All of them are
 * registered, including the blurred backdrops, so switching the camera from the
 * header rebinds the new stream everywhere instead of leaving stopped tracks
 * frozen in the views that happen to be hidden at that moment.
 */
export type VideoRefKey =
  | 'webcam'
  | 'webcamBg'
  | 'webcamTest'
  | 'webcamTestBg'
  | 'webcamPrep'
  | 'webcamPrepBg'
  | 'webcamTryout'
  | 'webcamCompare';

export type VideoRefs = Partial<Record<VideoRefKey, HTMLVideoElement | null>>;

export const videoRefs = writable<VideoRefs>({});

export function setVideoRef(key: VideoRefKey, el: HTMLVideoElement | null) {
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

/**
 * Drop examples of `name` by their index in the class' example list. Indices
 * refer to the list as it is right now — the caller must not batch calls, since
 * every removal re-indexes what follows.
 */
export function removeExamples(name: string, indices: number[]): void {
  if (!name || !indices.length) return;
  const drop = new Set(indices);
  updateProject((p) => {
    const list = p.examples[name];
    if (!list) return;
    p.examples[name] = list.filter((_, i) => !drop.has(i));
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

export function renameClass(oldName: string, newName: string): boolean {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return false;
  let ok = false;
  updateProject((p) => {
    if (!p.classes.includes(oldName)) return;
    if (p.classes.includes(trimmed)) return;
    p.classes = p.classes.map((c) => (c === oldName ? trimmed : c));
    if (p.examples[oldName]) {
      p.examples[trimmed] = p.examples[oldName];
      delete p.examples[oldName];
    }
    if (p.activeClass === oldName) p.activeClass = trimmed;
    ok = true;
  });
  return ok;
}

// --- Model/history mutation actions ---
export function setTrainingHistory(h: TrainingHistory): void {
  updateProject((p) => {
    p.trainingHistory = h;
  });
}

// The validation pair is only passed while a run has a validation split, so the
// arrays stay absent rather than filling up with zeros that would read as "0 %".
export function appendTrainingEpoch(
  epoch: number,
  accuracy: number,
  loss: number,
  valAccuracy?: number,
  valLoss?: number
): void {
  updateProject((p) => {
    const h = p.trainingHistory;
    const next: TrainingHistory = {
      epochs: [...h.epochs, epoch],
      accuracy: [...h.accuracy, accuracy],
      loss: [...h.loss, loss]
    };
    if (valAccuracy != null && valLoss != null) {
      next.valAccuracy = [...(h.valAccuracy ?? []), valAccuracy];
      next.valLoss = [...(h.valLoss ?? []), valLoss];
    }
    p.trainingHistory = next;
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

/**
 * Set the region for the next run. Called on every pointer move while the box is
 * being dragged, which is what the readout and the crop preview follow; the
 * project save behind it is debounced, so a drag ends in one write.
 */
export function setDraftRoi(roi: Roi | null): void {
  updateProject((p) => {
    p.draftRoi = roi;
  });
}

export function setModelArtifacts(
  artifacts: { topology: unknown; weightSpecs: unknown[]; weightData: ArrayBuffer } | null
): void {
  updateProject((p) => {
    p.modelArtifacts = artifacts;
  });
}
