import { writable, derived, get } from 'svelte/store';
import { idbPut, idbGet, idbGetAll, idbDelete, STORES } from '$lib/db';

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

export type TrainingOptions = {
  epochs: number;
  batchSize: number;
  learningRate: number;
  hiddenUnits: number;
  augmentation: boolean;
};

export const DEFAULT_TRAINING_OPTIONS: TrainingOptions = {
  epochs: 30,
  batchSize: 16,
  learningRate: 0.001,
  hiddenUnits: 64,
  augmentation: false
};

export type ProjectMode = 'image' | 'pose';

export type Roi = { x: number; y: number; w: number; h: number };

export type TrainedModel = {
  id: string;
  trainedAt: number;
  label?: string;
  artifacts: ModelArtifacts;
  metadata: ModelMetadata;
  history: TrainingHistory;
  options: TrainingOptions;
  classesSnapshot: string[];
  exampleCounts: Record<string, number>;
  roi?: Roi;
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
  classThresholds?: Record<string, number>;
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
    currentModelId: null,
    classThresholds: {}
  };
}

// Backfill fields introduced after earlier projects were saved
function hydrate(p: Project): Project {
  if (!p.modelHistory) p.modelHistory = [];
  if (p.currentModelId === undefined) p.currentModelId = null;
  if (!p.classThresholds) p.classThresholds = {};
  return p;
}

export function setClassThreshold(cls: string, threshold: number): void {
  updateProject((p) => {
    p.classThresholds = { ...(p.classThresholds || {}), [cls]: threshold };
  });
}

export function setTrainedModelRoi(id: string, roi: Roi | null): void {
  updateProject((p) => {
    p.modelHistory = p.modelHistory.map((m) =>
      m.id === id ? { ...m, roi: roi ?? undefined } : m
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

export function recordTrainedModel(
  artifacts: ModelArtifacts,
  metadata: ModelMetadata,
  history: TrainingHistory,
  options: TrainingOptions,
  classesSnapshot: string[],
  exampleCounts: Record<string, number>
): string | null {
  const id = `mdl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  let created: string | null = null;
  updateProject((p) => {
    const next = [
      ...p.modelHistory,
      {
        id,
        trainedAt: Date.now(),
        artifacts,
        metadata,
        history,
        options,
        classesSnapshot,
        exampleCounts
      }
    ];
    // Cap history at 20 most recent runs to keep storage bounded
    p.modelHistory = next.length > 20 ? next.slice(-20) : next;
    p.currentModelId = id;
    created = id;
  });
  return created;
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
    if (p.currentModelId === id) {
      const last = p.modelHistory[p.modelHistory.length - 1];
      if (last) {
        p.currentModelId = last.id;
        p.modelArtifacts = last.artifacts;
        p.modelMetadata = last.metadata;
        p.trainingHistory = last.history;
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
  const p: Project = {
    ...createBlankProject(data.name, data.mode ?? 'image'),
    classes: data.classes || [],
    examples: data.examples || {},
    activeClass: data.activeClass || null,
    trainingOptions: { ...DEFAULT_TRAINING_OPTIONS, ...(data.trainingOptions || {}) },
    trainingHistory: data.trainingHistory || { epochs: [], accuracy: [], loss: [] },
    modelMetadata: data.modelMetadata || {
      name: data.name,
      date: new Date().toISOString(),
      version: '1.0',
      classes: data.classes || []
    },
    modelArtifacts: data.modelArtifacts || null,
    modelHistory: data.modelHistory || [],
    currentModelId: data.currentModelId ?? null
  };
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
