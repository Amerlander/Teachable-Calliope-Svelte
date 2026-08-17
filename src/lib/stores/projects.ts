import { writable, derived, get } from 'svelte/store';
import { idbPut, idbGet, idbGetAll, idbDelete, STORES } from '$lib/db';
import { normalizeRange, type ClassRange } from '$lib/calibration';

export type TrainingHistory = {
  epochs: number[];
  accuracy: number[];
  loss: number[];
};

export type ModelMetadata = {
  name: string;
  date: string;
  version: string;
  classes: string[];
  params?: number;
  layers?: number;
  sizeBytes?: number;
};

export type ModelArtifacts = {
  topology: unknown;
  weightSpecs: unknown[];
  weightData: ArrayBuffer;
};

export type FeatureExtractor = 'mobilenet-v1' | 'mobilenet-v2' | 'mobilenet-v1-lite';

// Extractors that used to be offered but were served through tfhub.dev, which now
// redirects to Kaggle and no longer answers browser fetches (CORS/403). Old projects
// may still reference them, so map each onto a supported extractor. 'mobilenet-v2-lite'
// maps to 'mobilenet-v2' because both produce a 1280-dim embedding, which keeps
// already-trained classifier heads loadable.
const LEGACY_FEATURE_EXTRACTORS: Record<string, FeatureExtractor> = {
  'mobilenet-v2-lite': 'mobilenet-v2',
  'mobilenet-v3-small': 'mobilenet-v1',
  'efficientnet-lite0': 'mobilenet-v1'
};

const SUPPORTED_FEATURE_EXTRACTORS: FeatureExtractor[] = [
  'mobilenet-v1',
  'mobilenet-v2',
  'mobilenet-v1-lite'
];

/** Normalise a persisted/unknown extractor id onto one we can actually load. */
export function resolveFeatureExtractor(value: unknown): FeatureExtractor {
  if (typeof value !== 'string') return 'mobilenet-v1';
  if (SUPPORTED_FEATURE_EXTRACTORS.includes(value as FeatureExtractor)) {
    return value as FeatureExtractor;
  }
  return LEGACY_FEATURE_EXTRACTORS[value] ?? 'mobilenet-v1';
}

export type Optimizer = 'adam' | 'sgd' | 'rmsprop';

export type AugmentationSettings = {
  horizontalFlip: boolean;
  rotationDegrees: number;    // +/- deg
  brightnessJitter: number;   // +/- fraction
  zoomJitter: number;         // +/- fraction (random crop size)
  multiplier: number;         // extra copies per original (0..6)
};

export const DEFAULT_AUGMENTATION: AugmentationSettings = {
  horizontalFlip: false,
  rotationDegrees: 10,
  brightnessJitter: 0.15,
  zoomJitter: 0.1,
  multiplier: 2
};

export type TrainingOptions = {
  epochs: number;
  batchSize: number;
  learningRate: number;
  hiddenUnits: number;
  augmentation: boolean;
  augmentationSettings: AugmentationSettings;
  featureExtractor: FeatureExtractor;
  optimizer: Optimizer;
  dropout: number;           // 0..0.9
  validationSplit: number;   // 0..0.5
  earlyStopLoss: number;     // 0 = off
};

export const DEFAULT_TRAINING_OPTIONS: TrainingOptions = {
  epochs: 30,
  batchSize: 16,
  learningRate: 0.001,
  hiddenUnits: 64,
  augmentation: true,
  augmentationSettings: { ...DEFAULT_AUGMENTATION },
  featureExtractor: 'mobilenet-v1',
  optimizer: 'adam',
  dropout: 0.2,
  validationSplit: 0.15,
  earlyStopLoss: 0
};

export type ProjectMode = 'image' | 'pose';

export type Roi = { x: number; y: number; w: number; h: number };

/**
 * A model is self-describing: everything needed to run it, show it, and decide
 * what it can be used for is stored on the entry itself — the classes it can
 * tell apart (in wire order), the image region it was trained on, the feature
 * extractor its embeddings came from, and the project mode it belongs to. None
 * of that may be read off the project's live state, which keeps moving while
 * the user records new material.
 */
export type TrainedModel = {
  id: string;
  trainedAt: number;
  label?: string;
  artifacts: ModelArtifacts;
  metadata: ModelMetadata;
  history: TrainingHistory;
  options: TrainingOptions;
  /** Classes this model outputs, in the order its output units are in. */
  classes: string[];
  exampleCounts: Record<string, number>;
  /** Region of the camera frame the model was trained on; absent = whole image. */
  roi?: Roi;
  featureExtractor?: FeatureExtractor;
  mode: ProjectMode;
  /** Trained here, or brought in from a model ZIP. */
  source: 'trained' | 'imported';
  /**
   * Per-class output calibration, keyed by class label: which raw probability
   * reads as 0 % and which as 100 %. It belongs to the model because it
   * describes that model's output distribution — retraining shifts the
   * distribution, so carrying a window over would misrepresent the new model.
   * Absent or missing entries mean the neutral window (mapped = raw).
   */
  classRanges?: Record<string, ClassRange>;
};

/**
 * A saved MakeCode program within a Teachable project. Carries the full
 * MakeCode file map (`text`) so we can push it back into the editor on reload
 * or when the user switches between programs in the sidebar.
 */
export type MakeCodeProgram = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** The MakeCodeProject file map, e.g. { 'main.ts': '...', 'main.blocks': '...', ... } */
  files: Record<string, string>;
  /** Optional MakeCodeProject header carried over from workspace save. */
  header?: unknown;
  /**
   * The model this program is programmed against. Opening the program loads
   * that model, and it can be swapped for any other model with the same class
   * list (see {@link modelsForProgram}) — the program's blocks stay valid
   * because the embedded extension is generated from exactly these classes.
   */
  modelId: string | null;
  /**
   * The class list baked into the program's `autogenerated.ts`, in wire order:
   * class ids are 1-based indices into it. A model can only take this
   * program's place when its own class list matches.
   */
  classes: string[];
  /** Mode the embedded extension was generated for. */
  mode: ProjectMode;
};

export type Project = {
  id: string;
  name: string;
  mode: ProjectMode;
  createdAt: number;
  updatedAt: number;
  classes: string[];
  examples: Record<string, { data: string }[]>;
  activeClass: string | null;
  trainingOptions: TrainingOptions;
  trainingHistory: TrainingHistory;
  modelMetadata: ModelMetadata;
  modelArtifacts: ModelArtifacts | null;
  modelHistory: TrainedModel[];
  currentModelId: string | null;
  makeCodePrograms?: MakeCodeProgram[];
  currentProgramId?: string | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  mode: ProjectMode;
  createdAt: number;
  updatedAt: number;
  classCount: number;
  hasModel: boolean;
};

const LAST_PROJECT_KEY = 'teachable-last-project-id';

function genId(): string {
  return `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultName(): string {
  const now = new Date();
  const d = now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `Neues Projekt ${d}`;
}

export function createBlankProject(name?: string, mode: ProjectMode = 'image'): Project {
  const now = Date.now();
  return {
    id: genId(),
    name: name || defaultName(),
    mode,
    createdAt: now,
    updatedAt: now,
    classes: [],
    examples: {},
    activeClass: null,
    trainingOptions: { ...DEFAULT_TRAINING_OPTIONS },
    trainingHistory: { epochs: [], accuracy: [], loss: [] },
    modelMetadata: { name: 'Teachable Machine Model', date: new Date().toISOString(), version: '1.0', classes: [] },
    modelArtifacts: null,
    modelHistory: [],
    currentModelId: null
  };
}

// Backfill fields introduced after earlier projects were saved
function hydrate(p: Project): Project {
  if (!p.modelHistory) p.modelHistory = [];
  if (p.currentModelId === undefined) p.currentModelId = null;
  if (!p.makeCodePrograms) p.makeCodePrograms = [];
  // Projects used to hold one threshold per class for the whole project. Class
  // scores are now mapped per model (see TrainedModel.classRanges) and the
  // threshold itself is a constant, so the old values have nothing to migrate
  // onto: they were project-wide, the windows are per model, and every model
  // starts out neutral.
  delete (p as Project & { classThresholds?: unknown }).classThresholds;
  if (p.currentProgramId === undefined) p.currentProgramId = null;
  if (p.trainingOptions) {
    p.trainingOptions.featureExtractor = resolveFeatureExtractor(p.trainingOptions.featureExtractor);
  }
  const mode: ProjectMode = p.mode ?? 'image';
  // Models used to keep their class list under `classesSnapshot` and to inherit
  // mode from the project. Both now live on the model itself so it can be used
  // outside the project state it was trained in.
  p.modelHistory = p.modelHistory.map((m) => {
    const legacy = m as TrainedModel & { classesSnapshot?: string[] };
    return {
      ...m,
      classes: m.classes ?? legacy.classesSnapshot ?? [],
      mode: m.mode ?? mode,
      source: m.source ?? 'trained'
    };
  });
  // Programs used to carry a `{ classes, thresholds, mode }` snapshot compared
  // against the project to flag them "outdated". They now name their model
  // instead: the class list stays (it is what the embedded extension knows), the
  // thresholds snapshot is dropped — the class scale lives on the model and is
  // applied in the app, so nothing about it can invalidate a program.
  p.makeCodePrograms = p.makeCodePrograms.map((prog) => {
    const legacy = prog as MakeCodeProgram & {
      classesSnapshot?: string[];
      modeSnapshot?: ProjectMode;
      thresholdsSnapshot?: Record<string, number>;
    };
    const classes = prog.classes ?? legacy.classesSnapshot ?? [];
    const progMode = prog.mode ?? legacy.modeSnapshot ?? mode;
    const next: MakeCodeProgram = {
      id: prog.id,
      name: prog.name,
      createdAt: prog.createdAt,
      updatedAt: prog.updatedAt,
      files: prog.files,
      header: prog.header,
      // No model was recorded before; adopt the newest one that fits so the
      // program keeps working instead of showing up as model-less.
      modelId:
        prog.modelId ??
        newestModelFor(p.modelHistory, classes, progMode)?.id ??
        null,
      classes,
      mode: progMode
    };
    return next;
  });
  return p;
}

/** True when two class lists hold the same labels in the same order. */
export function classListsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function newestModelFor(
  models: TrainedModel[],
  classes: string[],
  mode: ProjectMode
): TrainedModel | null {
  if (!classes.length) return null;
  return (
    [...models]
      .filter((m) => m.mode === mode && classListsMatch(m.classes ?? [], classes))
      .sort((a, b) => b.trainedAt - a.trainedAt)[0] ?? null
  );
}

function genProgramId(): string {
  return `pgm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Add a new MakeCode program to the current project and make it active. The
 * model it was generated against is recorded with it, together with the class
 * list and mode that model brought — those are what the program's embedded
 * extension knows, and what limits which other models can replace it later.
 */
export function addMakeCodeProgram(init: {
  name?: string;
  files: Record<string, string>;
  header?: unknown;
  /**
   * The model the program is built for. May be null only for a program the
   * editor produced on its own before any model existed — it then has no
   * classes to offer and stays unbound until one is trained.
   */
  model: TrainedModel | null;
}): MakeCodeProgram | null {
  const p = get(currentProject);
  if (!p) return null;
  const now = Date.now();
  const program: MakeCodeProgram = {
    id: genProgramId(),
    name: init.name || `Programm ${(p.makeCodePrograms?.length ?? 0) + 1}`,
    createdAt: now,
    updatedAt: now,
    files: init.files,
    header: init.header,
    modelId: init.model?.id ?? null,
    classes: init.model ? [...init.model.classes] : [],
    mode: init.model?.mode ?? p.mode ?? 'image',
  };
  updateProject((proj) => {
    if (!proj.makeCodePrograms) proj.makeCodePrograms = [];
    proj.makeCodePrograms.push(program);
    proj.currentProgramId = program.id;
  });
  return program;
}

export function selectMakeCodeProgram(id: string): MakeCodeProgram | null {
  const p = get(currentProject);
  if (!p) return null;
  const found = (p.makeCodePrograms ?? []).find((x) => x.id === id);
  if (!found) return null;
  updateProject((proj) => {
    proj.currentProgramId = id;
  });
  return found;
}

export function renameMakeCodeProgram(id: string, name: string): void {
  updateProject((proj) => {
    if (!proj.makeCodePrograms) return;
    proj.makeCodePrograms = proj.makeCodePrograms.map((x) =>
      x.id === id ? { ...x, name, updatedAt: Date.now() } : x,
    );
  });
}

export function deleteMakeCodeProgram(id: string): void {
  updateProject((proj) => {
    const list = (proj.makeCodePrograms ?? []).filter((x) => x.id !== id);
    proj.makeCodePrograms = list;
    if (proj.currentProgramId === id) {
      proj.currentProgramId = list[list.length - 1]?.id ?? null;
    }
  });
}

/** Update the content of a specific program. Used from the MakeCode onWorkspaceSave hook. */
export function updateMakeCodeProgramFiles(
  id: string,
  files: Record<string, string>,
  header?: unknown,
): void {
  updateProject((proj) => {
    if (!proj.makeCodePrograms) return;
    proj.makeCodePrograms = proj.makeCodePrograms.map((x) =>
      x.id === id
        ? { ...x, files, header: header ?? x.header, updatedAt: Date.now() }
        : x,
    );
  });
}

export function getCurrentMakeCodeProgram(): MakeCodeProgram | null {
  const p = get(currentProject);
  if (!p || !p.currentProgramId) return null;
  return (p.makeCodePrograms ?? []).find((x) => x.id === p.currentProgramId) ?? null;
}

/**
 * Models a program can run on: same classes in the same order, same mode. Its
 * blocks address classes by 1-based index into that list, so anything else
 * would silently map a block onto a different class. Training with new classes
 * therefore needs a new program — there is nothing to migrate.
 */
export function modelsForProgram(
  program: MakeCodeProgram,
  models?: TrainedModel[]
): TrainedModel[] {
  // Callers in markup pass the list explicitly so the result recomputes when a
  // model is trained, imported or deleted.
  const all = models ?? get(currentProject)?.modelHistory ?? [];
  return all
    .filter((m) => m.mode === program.mode && classListsMatch(m.classes ?? [], program.classes))
    .sort((a, b) => b.trainedAt - a.trainedAt);
}

/** Point a program at another model. Rejected when the classes don't line up. */
export function setProgramModel(programId: string, modelId: string): TrainedModel | null {
  const p = get(currentProject);
  if (!p) return null;
  const program = (p.makeCodePrograms ?? []).find((x) => x.id === programId);
  const model = (p.modelHistory ?? []).find((m) => m.id === modelId);
  if (!program || !model) return null;
  if (!classListsMatch(model.classes ?? [], program.classes)) return null;
  updateProject((proj) => {
    proj.makeCodePrograms = (proj.makeCodePrograms ?? []).map((x) =>
      x.id === programId ? { ...x, modelId, updatedAt: Date.now() } : x
    );
  });
  return model;
}

export function getModelById(id: string | null | undefined): TrainedModel | null {
  if (!id) return null;
  const p = get(currentProject);
  return (p?.modelHistory ?? []).find((m) => m.id === id) ?? null;
}

/**
 * Set one class's mapping window on a model. Windows live on the model, so this
 * names the model explicitly — a caller that means "the one being tested" passes
 * `get(activeModel)?.id`.
 */
export function setModelClassRange(
  modelId: string | null | undefined,
  cls: string,
  range: ClassRange
): void {
  if (!modelId) return;
  const next = normalizeRange(range);
  updateProject((p) => {
    p.modelHistory = p.modelHistory.map((m) =>
      m.id === modelId ? { ...m, classRanges: { ...(m.classRanges ?? {}), [cls]: next } } : m
    );
  });
}

/** Replace every window on a model at once — what auto-calibration writes. */
export function setModelClassRanges(
  modelId: string | null | undefined,
  ranges: Record<string, ClassRange>
): void {
  if (!modelId) return;
  const next: Record<string, ClassRange> = {};
  for (const [cls, r] of Object.entries(ranges)) next[cls] = normalizeRange(r);
  updateProject((p) => {
    p.modelHistory = p.modelHistory.map((m) => (m.id === modelId ? { ...m, classRanges: next } : m));
  });
}

/** Back to mapped = raw for every class of a model. */
export function resetModelClassRanges(modelId: string | null | undefined): void {
  if (!modelId) return;
  updateProject((p) => {
    p.modelHistory = p.modelHistory.map((m) =>
      m.id === modelId ? { ...m, classRanges: {} } : m
    );
  });
}

function summarize(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    mode: p.mode ?? 'image',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    classCount: p.classes.length,
    hasModel: !!p.modelArtifacts
  };
}

export const currentProject = writable<Project | null>(null);
export const projectList = writable<ProjectSummary[]>([]);

export const hasProject = derived(currentProject, (p) => p !== null);

/**
 * Every model the project can offer, newest first — trained runs and imported
 * ZIPs alike. This is the one list the model pickers in Programmieren and
 * Anwenden read from.
 */
export const availableModels = derived(currentProject, (p): TrainedModel[] =>
  [...(p?.modelHistory ?? [])].sort((a, b) => b.trainedAt - a.trainedAt)
);


/**
 * The training run the project currently points at, or null when nothing is
 * selected (or the loaded classifier came from an imported ZIP, which has no
 * history entry). Everything a selected model should describe — its classes,
 * example counts, accuracy, ROI — lives on this snapshot, not on the project's
 * live class list, which keeps changing while the user records new material.
 */
export const activeModel = derived(currentProject, (p): TrainedModel | null => {
  if (!p?.currentModelId) return null;
  return p.modelHistory?.find((m) => m.id === p.currentModelId) ?? null;
});

export async function refreshProjectList(): Promise<void> {
  const all = await idbGetAll<Project>(STORES.projects);
  const summaries = all.map((p) => summarize(hydrate(p))).sort((a, b) => b.updatedAt - a.updatedAt);
  projectList.set(summaries);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveCurrentProject();
  }, 400);
}

export async function saveCurrentProject(): Promise<void> {
  const p = get(currentProject);
  if (!p) return;
  p.updatedAt = Date.now();
  await idbPut(STORES.projects, p);
  await refreshProjectList();
}

export async function loadProject(id: string): Promise<Project | null> {
  const raw = await idbGet<Project>(STORES.projects, id);
  if (!raw) return null;
  const p = hydrate(raw);
  currentProject.set(p);
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    /* ignore */
  }
  return p;
}

export async function newProject(name?: string, mode: ProjectMode = 'image'): Promise<Project> {
  const p = createBlankProject(name, mode);
  await idbPut(STORES.projects, p);
  currentProject.set(p);
  try {
    localStorage.setItem(LAST_PROJECT_KEY, p.id);
  } catch {
    /* ignore */
  }
  await refreshProjectList();
  return p;
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete(STORES.projects, id);
  const curr = get(currentProject);
  if (curr?.id === id) {
    closeCurrentProject();
  }
  await refreshProjectList();
}

export function closeCurrentProject(): void {
  currentProject.set(null);
  try {
    localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    /* ignore */
  }
}

export async function renameCurrentProject(name: string): Promise<void> {
  currentProject.update((p) => (p ? { ...p, name } : p));
  await saveCurrentProject();
}

export function getLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

function genModelId(): string {
  return `mdl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Append a model to the project's list and select it. Selecting means the
 * project's model-shaped fields describe this model and nothing else — an
 * imported model with no training curve must not leave the previous run's
 * accuracy on screen.
 */
function appendModel(model: TrainedModel): string | null {
  let created: string | null = null;
  updateProject((p) => {
    const next = [...p.modelHistory, model];
    // Cap history at 20 most recent runs to keep storage bounded
    p.modelHistory = next.length > 20 ? next.slice(-20) : next;
    p.currentModelId = model.id;
    p.modelArtifacts = model.artifacts;
    p.modelMetadata = model.metadata;
    p.trainingHistory = model.history;
    p.trainingOptions = model.options;
    created = model.id;
  });
  return created;
}

export function recordTrainedModel(
  artifacts: ModelArtifacts,
  metadata: ModelMetadata,
  history: TrainingHistory,
  options: TrainingOptions,
  classes: string[],
  exampleCounts: Record<string, number>,
  extras?: { roi?: Roi; featureExtractor?: FeatureExtractor; mode?: ProjectMode }
): string | null {
  return appendModel({
    id: genModelId(),
    trainedAt: Date.now(),
    artifacts,
    metadata,
    history,
    options,
    classes,
    exampleCounts,
    mode: extras?.mode ?? get(currentProject)?.mode ?? 'image',
    source: 'trained',
    ...(extras?.roi ? { roi: extras.roi } : {}),
    ...(extras?.featureExtractor ? { featureExtractor: extras.featureExtractor } : {})
  });
}

/**
 * Record a model that came in from a ZIP. It lands in the same list as trained
 * runs so it can be picked in Programmieren and Anwenden like any other — an
 * imported model has no training curve or example counts, everything else it
 * needs (classes, extractor, ROI when the ZIP carried one) comes along.
 */
export function recordImportedModel(init: {
  artifacts: ModelArtifacts;
  metadata: ModelMetadata;
  classes: string[];
  label?: string;
  roi?: Roi;
  featureExtractor?: FeatureExtractor;
  mode?: ProjectMode;
  classRanges?: Record<string, ClassRange>;
}): string | null {
  const exampleCounts: Record<string, number> = {};
  for (const c of init.classes) exampleCounts[c] = 0;
  return appendModel({
    id: genModelId(),
    trainedAt: Date.now(),
    label: init.label,
    artifacts: init.artifacts,
    metadata: init.metadata,
    history: { epochs: [], accuracy: [], loss: [] },
    options: { ...DEFAULT_TRAINING_OPTIONS, featureExtractor: resolveFeatureExtractor(init.featureExtractor) },
    classes: init.classes,
    exampleCounts,
    mode: init.mode ?? get(currentProject)?.mode ?? 'image',
    source: 'imported',
    ...(init.roi ? { roi: init.roi } : {}),
    ...(init.classRanges ? { classRanges: init.classRanges } : {}),
    featureExtractor: resolveFeatureExtractor(init.featureExtractor)
  });
}

export function setCurrentModel(id: string): TrainedModel | null {
  let chosen: TrainedModel | null = null;
  updateProject((p) => {
    const m = p.modelHistory.find((x) => x.id === id);
    if (!m) return;
    p.currentModelId = id;
    p.modelArtifacts = m.artifacts;
    p.modelMetadata = m.metadata;
    p.trainingHistory = m.history;
    p.trainingOptions = m.options;
    chosen = m;
  });
  return chosen;
}

export function deleteTrainedModel(id: string): void {
  updateProject((p) => {
    p.modelHistory = p.modelHistory.filter((m) => m.id !== id);
    // Programs that ran on it move to the newest model that still fits their
    // classes, or end up model-less and say so on their card.
    p.makeCodePrograms = (p.makeCodePrograms ?? []).map((prog) =>
      prog.modelId === id
        ? { ...prog, modelId: newestModelFor(p.modelHistory, prog.classes, prog.mode)?.id ?? null }
        : prog
    );
    if (p.currentModelId === id) {
      const last = p.modelHistory[p.modelHistory.length - 1];
      if (last) {
        p.currentModelId = last.id;
        p.modelArtifacts = last.artifacts;
        p.modelMetadata = last.metadata;
        p.trainingHistory = last.history;
        p.trainingOptions = last.options;
      } else {
        p.currentModelId = null;
        p.modelArtifacts = null;
        p.trainingHistory = { epochs: [], accuracy: [], loss: [] };
      }
    }
  });
}

export function renameTrainedModel(id: string, label: string): void {
  updateProject((p) => {
    const trimmed = label.trim();
    p.modelHistory = p.modelHistory.map((m) =>
      m.id === id ? { ...m, label: trimmed || undefined } : m
    );
  });
}

export function updateProject(mutator: (p: Project) => void): void {
  currentProject.update((p) => {
    if (!p) return p;
    mutator(p);
    return p;
  });
  scheduleSave();
}

export async function importProjectFromJson(data: Project): Promise<Project> {
  const p: Project = hydrate({
    ...createBlankProject(data.name, data.mode ?? 'image'),
    classes: data.classes || [],
    examples: data.examples || {},
    activeClass: data.activeClass || null,
    trainingOptions: {
      ...DEFAULT_TRAINING_OPTIONS,
      ...(data.trainingOptions || {}),
      featureExtractor: resolveFeatureExtractor(data.trainingOptions?.featureExtractor)
    },
    trainingHistory: data.trainingHistory || { epochs: [], accuracy: [], loss: [] },
    modelMetadata: data.modelMetadata || {
      name: data.name,
      date: new Date().toISOString(),
      version: '1.0',
      classes: data.classes || []
    },
    modelArtifacts: data.modelArtifacts || null,
    modelHistory: data.modelHistory || [],
    currentModelId: data.currentModelId ?? null,
    makeCodePrograms: data.makeCodePrograms || [],
    currentProgramId: data.currentProgramId ?? null
  });
  await idbPut(STORES.projects, p);
  currentProject.set(p);
  try {
    localStorage.setItem(LAST_PROJECT_KEY, p.id);
  } catch {
    /* ignore */
  }
  await refreshProjectList();
  return p;
}
