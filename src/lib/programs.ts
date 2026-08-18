/**
 * Creating and opening MakeCode programs.
 *
 * A program used to belong to one model: its blocks were generated from that
 * model's classes and addressed them by label-derived identifiers, so opening a
 * program also meant loading its model, and pointing it at another one was only
 * allowed within the same class list. None of that holds now. Class identity is
 * the class index (see makecode/names.ts), the wire protocol was index-based all
 * along, and the class names a program shows are rewritten from whichever model
 * is loaded when it opens. So a program is just files, the model is chosen where
 * models are chosen, and what is left here is generating a starter and opening a
 * saved one.
 */

import { get } from 'svelte/store';
import { generateProject, importProgramFiles } from '$lib/makecode';
import { highestClassIndex } from '$lib/makecode/programFiles';
import {
  addMakeCodeProgram,
  currentProject,
  selectMakeCodeProgram,
  type MakeCodeProgram,
  type TrainedModel
} from '$lib/stores/projects';

/**
 * Generate a starter program from `model`'s classes, store it, and open it in
 * the editor. The new program becomes the project's active one. Nothing about
 * the model is kept: the classes only decide how many blocks the starter comes
 * with and what they are called to begin with.
 */
export function createProgramForModel(
  model: TrainedModel,
  opts?: { name?: string }
): MakeCodeProgram | null {
  const project = get(currentProject);
  const generated = generateProject({
    name: project?.name || 'Teachable Project',
    mode: model.mode,
    classes: [...model.classes]
  });
  const program = addMakeCodeProgram({
    name: opts?.name,
    files: (generated.text ?? {}) as Record<string, string>,
    header: generated.header
  });
  if (program) importProgramFiles(program.files, program.header);
  return program;
}

/**
 * Open a saved program: push its files into the editor, with the generated
 * class list rewritten from the model that is loaded. What the student built —
 * `main.blocks` and `main.ts` — is never touched.
 */
export function openProgram(program: MakeCodeProgram): void {
  selectMakeCodeProgram(program.id);
  importProgramFiles(program.files, program.header);
}

/**
 * How many class slots a program's blocks use, and how many the model has. The
 * blocks stay valid either way — a slot the model doesn't fill simply never
 * fires — so this is what a hint is built from, not a rule.
 */
export function classGap(
  program: MakeCodeProgram,
  model: TrainedModel | null
): { used: number; available: number } {
  return {
    used: highestClassIndex(program.files),
    available: model?.classes.length ?? 0
  };
}

/** True when the program addresses class slots the loaded model doesn't have. */
export function hasClassGap(program: MakeCodeProgram, model: TrainedModel | null): boolean {
  const { used, available } = classGap(program, model);
  return used > available;
}
