/**
 * Working with models across views: selecting one, importing one, and naming
 * one for display. Training, Programmieren and Anwenden all pick models, and
 * picking one always means the same two steps — point the project at it and
 * load its weights into the runtime classifier — so that pair lives here
 * instead of in each view.
 */

import { get } from 'svelte/store';
import { importModelFromZip, loadClassifierFromArtifacts, scoreStoredExamples } from '$lib/machine';
import { reimportCurrentProgram } from '$lib/makecode';
import { classifierModel } from '$lib/stores';
import { modelTrained } from '$lib/stores/app';
import { resetStreamState } from '$lib/stores/streaming';
import { rangesFromScores, type ClassRange } from '$lib/calibration';
import {
  activeModel,
  currentProject,
  getModelById,
  setCurrentModel,
  setModelClassRanges,
  type TrainedModel
} from '$lib/stores/projects';

/** The runtime classifier belongs to this model id, or null when nothing is loaded. */
let loadedModelId: string | null = null;

/**
 * The project that classifier was loaded from, and the reset that goes with it.
 * Nothing this module loads is part of a project snapshot — the weights, the id
 * they came from, the "a model is ready" flag and the smoothing window measured
 * on that model's output all live in memory only — so the open project changing
 * has to drop all of it. Without this the previous project's model stays loaded,
 * and a project created right after opening another one comes up with a models
 * sidebar and a Modell-Info describing a model it does not have.
 *
 * Tied to the project id here instead of repeated at every call site: creating,
 * opening, importing, deleting and closing a project all swap `currentProject`,
 * and one of those paths would always end up being the one that forgets. Anything
 * that loads a model for the *new* project therefore has to run after the swap —
 * see `importModelAsNewProject`, which does exactly that.
 */
let loadedProjectId: string | null = get(currentProject)?.id ?? null;
currentProject.subscribe((p) => {
  const id = p?.id ?? null;
  if (id === loadedProjectId) return;
  loadedProjectId = id;
  loadedModelId = null;
  classifierModel.set(null);
  modelTrained.set(false);
  resetStreamState();
});

/**
 * Select `id` as the project's model and load its weights. Returns the model,
 * or null when the id is unknown. Loading failures propagate — a caller that
 * shows a picker needs to be able to tell the user the model didn't come up.
 */
export async function activateModel(id: string): Promise<TrainedModel | null> {
  const model = setCurrentModel(id);
  if (!model) return null;
  await loadClassifierFromArtifacts(model.artifacts);
  loadedModelId = id;
  // Whatever the previous model last detected says nothing about this one, and
  // the smoothing window is measured on its output distribution.
  resetStreamState();
  // The open program's class blocks are named after the loaded model, so a model
  // change is also a relabelling. Only Programmieren has an editor mounted;
  // everywhere else this does nothing.
  reimportCurrentProgram();
  return model;
}

/**
 * Load the project's selected model if the runtime classifier isn't already it.
 * Views that only consume predictions (Programmieren, Anwenden) call this on
 * mount: the project remembers its selection across reloads, but the classifier
 * lives in memory and starts out empty.
 */
export async function ensureActiveModelLoaded(): Promise<TrainedModel | null> {
  const id = get(currentProject)?.currentModelId ?? null;
  if (!id) return null;
  const model = getModelById(id);
  if (!model) return null;
  if (get(classifierModel) && loadedModelId === id) return model;
  await loadClassifierFromArtifacts(model.artifacts);
  loadedModelId = id;
  return model;
}

/** Import a model ZIP as a new model in the open project and select it. */
export async function importModelFile(file: File): Promise<TrainedModel | null> {
  const id = await importModelFromZip(file);
  if (!id) return null;
  loadedModelId = id;
  return getModelById(id);
}

/**
 * Set the selected model's per-class mapping from how it scores the recorded
 * examples, and store it on the model. Returns the windows it wrote, or null
 * when there is nothing to measure — an imported model brings no examples along,
 * so its mapping stays whatever came with it.
 */
export async function autoCalibrateActiveModel(): Promise<Record<string, ClassRange> | null> {
  const model = get(activeModel);
  if (!model) return null;
  const { classes, rows } = await scoreStoredExamples();
  if (!rows.length) return null;
  const ranges = rangesFromScores(classes, rows);
  setModelClassRanges(model.id, ranges);
  return ranges;
}

/** What to call a model in lists and on cards. */
export function modelLabel(model: TrainedModel): string {
  return model.label || new Date(model.trainedAt).toLocaleString('de-DE');
}
