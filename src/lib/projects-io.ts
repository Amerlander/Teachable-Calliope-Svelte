import { get } from 'svelte/store';
import {
  currentProject,
  createBlankProject,
  newProject,
  saveCurrentProject,
  refreshProjectList,
  type Project,
  type ModelArtifacts
} from '$lib/stores/projects';
import { idbPut, STORES } from '$lib/db';
import { loadClassifierFromArtifacts } from '$lib/machine';

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

export async function exportCurrentProject(): Promise<void> {
  const p = get(currentProject);
  if (!p) throw new Error('Kein Projekt offen');
  const JSZip = (await import('jszip')).default;
  const saveAs = (await import('file-saver')).saveAs;
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(serializeProject(p), null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const safeName = p.name.replace(/[^a-z0-9_\- ]/gi, '_');
  saveAs(blob, `${safeName}.tcproj.zip`);
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

export async function importModelAsNewProject(file: File): Promise<Project> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const topologyEntry = zip.file('model.json');
  const specsEntry = zip.file('weights.json');
  const weightsEntry = zip.file('weights.bin');
  if (!topologyEntry || !specsEntry || !weightsEntry) {
    throw new Error('Ungültiges Modell-ZIP: model.json, weights.json oder weights.bin fehlt');
  }
  const topology = JSON.parse(await topologyEntry.async('string'));
  const weightSpecs = JSON.parse(await specsEntry.async('string'));
  const weightData = await weightsEntry.async('arraybuffer');
  let meta: Partial<Project['modelMetadata']> = {};
  const metaEntry = zip.file('metadata.json');
  if (metaEntry) {
    try {
      meta = JSON.parse(await metaEntry.async('string'));
    } catch {
      /* ignore */
    }
  }
  const artifacts: ModelArtifacts = { topology, weightSpecs, weightData };
  const p = createBlankProject(meta.name || file.name.replace(/\.zip$/i, ''));
  p.classes = meta.classes || [];
  for (const c of p.classes) p.examples[c] = [];
  p.modelArtifacts = artifacts;
  p.modelMetadata = {
    ...p.modelMetadata,
    ...(meta as Project['modelMetadata'])
  };
  await idbPut(STORES.projects, p);
  currentProject.set(p);
  localStorage.setItem('teachable-last-project-id', p.id);
  await refreshProjectList();
  try {
    await loadClassifierFromArtifacts(artifacts);
  } catch (err) {
    console.warn('Could not load imported classifier', err);
  }
  return p;
}

export { newProject, saveCurrentProject };
