import { derived, writable, get } from 'svelte/store';
import { activeModel, currentProject, scheduleSave, updateProject } from './stores/projects';
import type {
  ModelMetadata,
  Project,
  Roi,
  TrainingHistory,
  TrainingOptions
} from './stores/projects';
import { makeClassThumb } from './classThumb';

export type { ModelMetadata, Roi, TrainingHistory, TrainingOptions };

// --- Project-backed reactive views ---
// These are derived from the current project so the UI auto-updates on project switch.
export const classes = derived(currentProject, (p) => p?.classes ?? []);
export const examples = derived(currentProject, (p) => p?.examples ?? {});
/** The cover image per class name — see $lib/classThumb. */
export const classThumbs = derived(currentProject, (p) => p?.classThumbs ?? {});
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
// Training only makes sense once enough classes can actually carry an output:
// the classifier gets one unit per trained class, and a class with too few
// images would become an output the model can never learn to pick. Classes that
// stay under the threshold are left out of the run instead of blocking it —
// see `trainableClasses`. Both thresholds and the hint text live here so the
// sidebar CTA and the train button can never disagree about what "ready" means.
export const MIN_CLASSES_FOR_TRAINING = 3;
export const MIN_EXAMPLES_PER_CLASS = 3;

/**
 * The classes a training run will actually use: everything that holds at least
 * MIN_EXAMPLES_PER_CLASS examples, in project order. Training reads this rather
 * than `classes`, so a half-filled class the user is still working on neither
 * blocks the run nor turns into a dead output on the model.
 */
export const trainableClasses = derived([classes, examples], ([cls, ex]): string[] =>
  cls.filter((c) => (ex[c]?.length ?? 0) >= MIN_EXAMPLES_PER_CLASS)
);

export type TrainingReadiness = {
  ready: boolean;
  /** Classes that already hold MIN_EXAMPLES_PER_CLASS examples. */
  readyClasses: number;
  /** Classes that exist but hold too few examples to be trained. */
  shortClasses: number;
  /** What is still missing, or null once ready. */
  hint: string | null;
  /** That short classes sit this run out, or null when none do. */
  ignoredHint: string | null;
};

export const trainingReadiness = derived(
  [classes, examples],
  ([cls, ex]): TrainingReadiness => {
    const short = cls.filter((c) => (ex[c]?.length ?? 0) < MIN_EXAMPLES_PER_CLASS).length;
    const readyClasses = cls.length - short;
    const ready = readyClasses >= MIN_CLASSES_FOR_TRAINING;
    const hint = ready
      ? null
      : `Mindestens ${MIN_CLASSES_FOR_TRAINING} Klassen mit je ${MIN_EXAMPLES_PER_CLASS} Bildern nötig (${readyClasses}/${MIN_CLASSES_FOR_TRAINING})`;
    const ignoredHint =
      short === 0
        ? null
        : short === 1
          ? `Eine Klasse mit weniger als ${MIN_EXAMPLES_PER_CLASS} Bildern wird nicht trainiert`
          : `${short} Klassen mit weniger als ${MIN_EXAMPLES_PER_CLASS} Bildern werden nicht trainiert`;
    return { ready, readyClasses, shortClasses: short, hint, ignoredHint };
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
  // The first image recorded for a class becomes its cover. Not awaited: the
  // capture must not wait on a decode, and a cover that arrives a frame later is
  // invisible to the user. Downscaling is why it cannot happen inside the
  // synchronous update above.
  void ensureClassThumb(name, data);
}

// Classes whose cover is being built right now. Without this, a burst capture
// would start a dozen decodes for the same class, all of which passed the
// "has no cover yet" check before the first one finished.
const thumbInFlight = new Set<string>();

/**
 * Give `name` a cover from `data` unless it already has one. Called for every
 * recorded example, so it is a no-op after the first.
 */
export async function ensureClassThumb(name: string, data: string): Promise<void> {
  if (!name || !data) return;
  if (get(currentProject)?.classThumbs?.[name]) return;
  if (thumbInFlight.has(name)) return;
  thumbInFlight.add(name);
  try {
    const thumb = await makeClassThumb(data);
    // Re-checked: the user may have picked one by hand while this was decoding,
    // and an explicit choice outranks the automatic first-image default.
    if (get(currentProject)?.classThumbs?.[name]) return;
    setClassThumb(name, thumb);
  } catch (err) {
    console.warn('Klassenbild konnte nicht erstellt werden', err);
  } finally {
    thumbInFlight.delete(name);
  }
}

/**
 * Set the cover for `name` from an already-sized data URL.
 *
 * Callers that hand over a full-size example image should go through
 * {@link chooseClassThumb} instead, which downscales first.
 */
export function setClassThumb(name: string, thumb: string): void {
  if (!name || !thumb) return;
  updateProject((p) => {
    if (!p.classThumbs) p.classThumbs = {};
    p.classThumbs[name] = thumb;
  });
}

/** Make `image` the cover of `name`, downscaling it first. */
export async function chooseClassThumb(name: string, image: string): Promise<void> {
  if (!name || !image) return;
  try {
    setClassThumb(name, await makeClassThumb(image));
  } catch (err) {
    console.warn('Klassenbild konnte nicht gesetzt werden', err);
  }
}

// ---- Covers for classes that were recorded before covers existed ----
// A cover is only built when an example is added (see pushExample), so a project
// whose classes were all recorded earlier would never get one: nothing captures
// into them again, and the class list stays blank except where a cover was picked
// by hand. Which is exactly what it looked like.
//
// Not done in `hydrate`, which is synchronous — building a cover means decoding
// and downscaling an image. Instead every project that becomes current gets one
// pass over its classes.
let backfilledProjectId: string | null = null;

async function backfillClassThumbs(p: Project): Promise<void> {
  for (const cls of p.classes) {
    // The user can switch projects while this is decoding, and setClassThumb
    // writes to whatever is current — not to `p`. Without this, a cover from the
    // project being left would land on a same-named class in the new one.
    if (get(currentProject)?.id !== p.id) return;
    if (p.classThumbs?.[cls]) continue;
    const first = p.examples?.[cls]?.[0]?.data;
    if (!first) continue;
    // Sequential: a whole class list's worth of decodes at once would compete
    // with the camera and the feature extractor for the same main thread.
    await ensureClassThumb(cls, first);
  }
}

// Every way into a project ends in `currentProject.set` — loading, creating,
// importing a project ZIP, importing a model as a new project. Watching the store
// covers all of them at once, instead of each caller having to remember.
if (typeof document !== 'undefined') {
  currentProject.subscribe((p) => {
    // Only on a change of project. Every capture writes the project too, and
    // those already fill their own cover.
    if (!p || p.id === backfilledProjectId) return;
    backfilledProjectId = p.id;
    void backfillClassThumbs(p);
  });
}

/**
 * Drop the cover of `name` and fall back to the first example still recorded, so
 * "reset" lands back on the default rather than on nothing.
 */
export function resetClassThumb(name: string): void {
  if (!name) return;
  updateProject((p) => {
    if (p.classThumbs) delete p.classThumbs[name];
  });
  const first = get(currentProject)?.examples?.[name]?.[0]?.data;
  if (first) void ensureClassThumb(name, first);
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
    if (p.classThumbs) delete p.classThumbs[name];
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
    if (p.classThumbs?.[oldName]) {
      p.classThumbs[trimmed] = p.classThumbs[oldName];
      delete p.classThumbs[oldName];
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
