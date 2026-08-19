import { get } from 'svelte/store';
import {
  currentProject,
  createBlankProject,
  newProject,
  recordImportedModel,
  saveCurrentProject,
  refreshProjectList,
  type Project
} from '$lib/stores/projects';
import { idbPut, idbGet, STORES } from '$lib/db';
import { loadClassifierFromArtifacts, readModelZip } from '$lib/machine';

type SerializedProject = Omit<Project, 'modelArtifacts'> & {
  modelArtifacts: {
    topology: unknown;
    weightSpecs: unknown[];
    weightDataBase64: string;
  } | null;
};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function serializeProject(p: Project): SerializedProject {
  return {
    ...p,
    modelArtifacts: p.modelArtifacts
      ? {
          topology: p.modelArtifacts.topology,
          weightSpecs: p.modelArtifacts.weightSpecs,
          weightDataBase64: arrayBufferToBase64(p.modelArtifacts.weightData)
        }
      : null
  };
}

function deserializeProject(s: SerializedProject): Project {
  return {
    ...s,
    modelArtifacts: s.modelArtifacts
      ? {
          topology: s.modelArtifacts.topology,
          weightSpecs: s.modelArtifacts.weightSpecs,
          weightData: base64ToArrayBuffer(s.modelArtifacts.weightDataBase64)
        }
      : null
  };
}

async function downloadProjectZip(p: Project): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const saveAs = (await import('file-saver')).saveAs;
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(serializeProject(p), null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const safeName = p.name.replace(/[^a-z0-9_\- ]/gi, '_');
  saveAs(blob, `${safeName}.tcproj.zip`);
}

export async function exportCurrentProject(): Promise<void> {
  const p = get(currentProject);
  if (!p) throw new Error('Kein Projekt offen');
  await downloadProjectZip(p);
}

/**
 * Export any stored project without opening it — the overview list offers the
 * same download entry as the header menu, and reading straight from IndexedDB
 * keeps `currentProject` (and the loaded classifier) untouched.
 */
export async function exportProjectById(id: string): Promise<void> {
  const p = await idbGet<Project>(STORES.projects, id);
  if (!p) throw new Error('Projekt nicht gefunden');
  await downloadProjectZip(p);
}

export async function importProjectFromFile(file: File): Promise<Project> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entry = zip.file('project.json');
  if (!entry) throw new Error('Ungültiges Projekt-ZIP: project.json fehlt');
  const serialized = JSON.parse(await entry.async('string')) as SerializedProject;
  const restored = deserializeProject(serialized);
  // Regenerate id so we don't overwrite an existing project with the same id
  const now = Date.now();
  const p: Project = {
    ...restored,
    // Projects exported before class covers existed carry no map at all.
    classThumbs: restored.classThumbs ?? {},
    id: `prj_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now
  };
  await idbPut(STORES.projects, p);
  currentProject.set(p);
  localStorage.setItem('teachable-last-project-id', p.id);
  await refreshProjectList();
  if (p.modelArtifacts) {
    try {
      await loadClassifierFromArtifacts(p.modelArtifacts);
    } catch (err) {
      console.warn('Could not restore classifier from project', err);
    }
  }
  return p;
}

/**
 * Turn a model ZIP into a fresh project whose only model is the imported one.
 * The model keeps everything the ZIP described (classes, ROI, extractor), and
 * the project's class list is seeded from it so recording more material and
 * retraining picks up where the import left off.
 */
export async function importModelAsNewProject(file: File): Promise<Project> {
  const contents = await readModelZip(file);
  const p = createBlankProject(
    contents.label || contents.metadata.name || file.name.replace(/\.zip$/i, ''),
    contents.mode ?? 'image'
  );
  p.classes = [...contents.classes];
  for (const c of p.classes) p.examples[c] = [];
  // The covers the ZIP carried seed the project too, so the class list shows them
  // straight away — without this they would only appear on the imported model and
  // the classes it was seeded from would look like they had never been recorded.
  if (contents.classThumbs) p.classThumbs = { ...contents.classThumbs };
  // Same reasoning as the class list: material recorded here is meant to extend
  // what the imported model already knows, so the next run should crop the way
  // that model was trained. A ZIP without a region leaves it unpicked.
  if (contents.roi) p.draftRoi = contents.roi;
  await idbPut(STORES.projects, p);
  currentProject.set(p);
  localStorage.setItem('teachable-last-project-id', p.id);
  // Has to run against the now-current project: this is what puts the model in
  // the list the pickers read, selects it, and stores its artifacts.
  recordImportedModel({
    artifacts: contents.artifacts,
    metadata: contents.metadata,
    classes: contents.classes,
    label: contents.label || contents.metadata.name,
    roi: contents.roi,
    featureExtractor: contents.featureExtractor,
    mode: contents.mode ?? 'image',
    classThumbs: contents.classThumbs,
    classThumbsVersion: contents.classThumbsVersion
  });
  await saveCurrentProject();
  await refreshProjectList();
  return get(currentProject) ?? p;
}

export { newProject, saveCurrentProject };
