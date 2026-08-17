/**
 * Working with models across views: selecting one, importing one, and naming
 * one for display. Training, Programmieren and Anwenden all pick models, and
 * picking one always means the same two steps — point the project at it and
 * load its weights into the runtime classifier — so that pair lives here
 * instead of in each view.
 */

import { get } from 'svelte/store';
import { importModelFromZip, loadClassifierFromArtifacts } from '$lib/machine';
import { classifierModel } from '$lib/stores';
import {
  currentProject,
  getModelById,
  setCurrentModel,
  type TrainedModel
} from '$lib/stores/projects';

/** The runtime classifier belongs to this model id, or null when nothing is loaded. */
let loadedModelId: string | null = null;

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

/** What to call a model in lists and on cards. */
export function modelLabel(model: TrainedModel): string {
  return model.label || new Date(model.trainedAt).toLocaleString('de-DE');
}
