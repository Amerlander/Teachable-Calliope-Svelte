/**
 * Creating, opening and re-pointing MakeCode programs.
 *
 * A program is always programmed against one model: the blocks it offers are
 * generated from that model's classes, and its class ids are indices into that
 * list. So generating a program, remembering which model it belongs to, and
 * loading that model are one operation — they happen together after training,
 * from the program list, and when Programmieren opens. That sequence lives here
 * so the three callers can't drift apart on what a program is bound to.
 */

import { get } from 'svelte/store';
import { generateProject, importProgramFiles } from '$lib/makecode';
import { activateModel } from '$lib/models';
import {
  addMakeCodeProgram,
  currentProject,
  getModelById,
  selectMakeCodeProgram,
  setProgramModel,
  type MakeCodeProgram,
  type TrainedModel
} from '$lib/stores/projects';

/**
 * Freshly generated program files for `model`. Nothing about the class scale is
 * baked in: the app maps and thresholds the scores and sends the detected class,
 * so a program keeps working when the mapping is retuned or its model swapped.
 */
function filesForModel(model: TrainedModel) {
  const project = get(currentProject);
  return generateProject({
    name: project?.name || 'Teachable Project',
    mode: model.mode,
    classes: [...model.classes]
  });
}

/**
 * Generate a starter program for `model`, store it, and open it in the editor.
 * The new program becomes the project's active one.
 */
export function createProgramForModel(
  model: TrainedModel,
  opts?: { name?: string }
): MakeCodeProgram | null {
  const generated = filesForModel(model);
  const program = addMakeCodeProgram({
    name: opts?.name,
    files: (generated.text ?? {}) as Record<string, string>,
    header: generated.header,
    model
  });
  if (program) importProgramFiles(program.files, program.header);
  return program;
}

/**
 * Open a saved program: push its files into the editor and load the model it
 * runs on, so the live prediction feeding the board is that program's model.
 * Its files are never regenerated — what the student built stays untouched.
 */
export async function openProgram(program: MakeCodeProgram): Promise<TrainedModel | null> {
  selectMakeCodeProgram(program.id);
  importProgramFiles(program.files, program.header);
  return loadProgramModel(program);
}

/** Load the model a program runs on, if it still has one. */
export async function loadProgramModel(program: MakeCodeProgram): Promise<TrainedModel | null> {
  if (!program.modelId || !getModelById(program.modelId)) return null;
  return activateModel(program.modelId);
}

/**
 * Swap the model a program runs on. Only models with the same classes are
 * accepted (see `modelsForProgram`), so the program's blocks keep meaning what
 * they meant — this is the "retrain and use the better run" path, not a way to
 * bend a program onto a different class set.
 */
export async function switchProgramModel(
  programId: string,
  modelId: string
): Promise<TrainedModel | null> {
  const model = setProgramModel(programId, modelId);
  if (!model) return null;
  return activateModel(model.id);
}
