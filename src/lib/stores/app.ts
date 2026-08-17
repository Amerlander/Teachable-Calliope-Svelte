import { writable, derived } from 'svelte/store';
import { loadLocale } from 'wuchale/load-utils';
import { currentProject, type Roi } from './projects';
// Importing the loaders is what registers them with wuchale's global registry,
// so `loadLocale` below has something to load. Nothing else uses these exports.
import '../../locales/main.loader.svelte.js';
import '../../locales/js.loader.js';

// --- App mode (derived from current project — fixed per project) ---
export type AppMode = 'image' | 'pose';
export const appMode = derived(currentProject, (p): AppMode | null => p?.mode ?? null);

// --- Language ---
// `de` is wuchale's source locale (see wuchale.config.js), so its catalog is the
// source text itself and can never be missing.
export type Lang = 'de' | 'en';
export const SOURCE_LANG: Lang = 'de';
export const currentLang = writable<Lang>(SOURCE_LANG);

/**
 * Switch the UI language. The catalog has to be in place *before* the store
 * updates, otherwise the components re-render against a catalog that isn't
 * there yet and fall back to wuchale's placeholders for a frame.
 */
export async function setLang(lang: Lang): Promise<void> {
  await loadLocale(lang);
  currentLang.set(lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

// --- UI overlays ---
export const showLanguageOverlay = writable(false);
export const showAIInfoOverlay = writable(false);

// --- Training UI state ---
export const trainStatus = writable<string>('Bereit');
export const isTraining = writable(false);
export const isTesting = writable(false);
export const modelTrained = writable(false);

/**
 * `localStorage`-backed writable. Reads the initial value once on construction
 * and writes back on every change. Falls back to the default when storage is
 * unavailable (SSR, private mode, etc.).
 */
function persisted<T>(key: string, initial: T): ReturnType<typeof writable<T>> {
  let start: T = initial;
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) start = JSON.parse(raw) as T;
    } catch { /* ignore */ }
  }
  const store = writable<T>(start);
  if (typeof window !== 'undefined') {
    store.subscribe((v) => {
      try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
    });
  }
  return store;
}

// --- Workspace sidebar tab: drives the camera panel mode ---
export type WorkspaceTab = 'classes' | 'model';
export const workspaceTab = persisted<WorkspaceTab>('teachable-workspace-tab', 'model');

// --- Model tab sub-view: 'model' shows stats, 'new' shows training-prep UI ---
export type ModelTabView = 'model' | 'new';
export const modelTabView = persisted<ModelTabView>('teachable-model-tab-view', 'new');

/**
 * The region the next training run will use, in camera-frame coordinates
 * (see $lib/roi); null means the whole image. It is set in the camera panel and
 * kept for the session so a second run can use the same framing. Once a run
 * finishes, the region it used belongs to that model and is read-only there —
 * this draft only ever describes the *next* model.
 */
export const draftRoi = writable<Roi | null>(null);

// --- When true, the camera shows the draft ROI with drag handles ---
export const roiEditing = writable(false);

// --- Training phase indicator: what's happening right now ---
export type TrainPhase = 'idle' | 'preparing' | 'training' | 'done' | 'error';
export const trainPhase = writable<TrainPhase>('idle');

// Epoch counter of the running training. The run is started from the sidebar
// but its progress is shown under the video, so the two numbers have to live
// outside both components.
export const trainEpoch = writable(0);
export const trainTotalEpochs = writable(0);
export const trainProgress = derived(
  [trainEpoch, trainTotalEpochs],
  ([ep, total]) => (total ? Math.min(100, Math.round((ep / total) * 100)) : 0)
);

// --- Bluetooth ---
export const btConnected = writable(false);
export const btStatusText = writable('Nicht verbunden');
export const sendEveryPrediction = writable(false);

