import { writable, type Readable } from 'svelte/store';
import {
  MakeCodeFrameDriver,
  createMakeCodeURL,
  type MakeCodeProject as MkcProject,
} from '@microbit/makecode-embed';
import {
  generateProject as generateProjectImpl,
  createCalliopeSeedProject,
  type GenerateOptions,
} from './makecode/generate';
import {
  addMakeCodeProgram,
  updateMakeCodeProgramFiles,
  getCurrentMakeCodeProgram,
} from './stores/projects';

export const MAKECODE_BASE_URL = 'https://makecode.calliope.cc';
export const CONTROLLER_ID = 'CalliopeTeachable';

export type MakeCodeProject = MkcProject;

export { createCalliopeSeedProject };
export type { GenerateOptions };

export function createMakeCodeIframeUrl(lang?: string): string {
  return createMakeCodeURL(MAKECODE_BASE_URL, undefined, lang, 2, {
    hidemenu: '1',
    nocookiebanner: '1',
  });
}

// ---- Driver lifecycle ----
// We maintain a single active driver for the currently-mounted MakeCode iframe.

type DownloadHandler = (d: { name: string; hex: string }) => void;

interface Active {
  iframe: HTMLIFrameElement;
  driver: MakeCodeFrameDriver;
  pending: MakeCodeProject | null;
  project: ReturnType<typeof writable<MakeCodeProject | null>>;
  ready: ReturnType<typeof writable<boolean>>;
  downloadHandlers: Set<DownloadHandler>;
}

let active: Active | null = null;

function disposeActive() {
  if (!active) return;
  try {
    active.driver.dispose();
  } catch {
    /* ignore */
  }
  active.ready.set(false);
  active = null;
}

export function setMakecodeIframe(iframe: HTMLIFrameElement | null) {
  if (!iframe) {
    disposeActive();
    return;
  }
  if (active && active.iframe === iframe) return;
  disposeActive();

  const project = writable<MakeCodeProject | null>(null);
  const ready = writable(false);
  const downloadHandlers = new Set<DownloadHandler>();

  const self: Active = {
    iframe,
    driver: undefined as unknown as MakeCodeFrameDriver,
    pending: null,
    project,
    ready,
    downloadHandlers,
  };

  const DBG = '[makecode]';
  // eslint-disable-next-line no-console
  console.log(DBG, 'initializing driver', {
    controllerId: CONTROLLER_ID,
    src: iframe.src,
  });

  const driver = new MakeCodeFrameDriver(
    {
      controllerId: CONTROLLER_ID,
      initialProjects: async () => {
        const p = self.pending;
        // eslint-disable-next-line no-console
        console.log(DBG, 'initialProjects requested by MakeCode', {
          hasPending: !!p,
        });
        if (p) return [p];
        return [createCalliopeSeedProject()];
      },
      onWorkspaceLoaded: () => {
        // eslint-disable-next-line no-console
        console.log(DBG, 'onWorkspaceLoaded — controller=2 sync complete');
      },
      onEditorContentLoaded: () => {
        // eslint-disable-next-line no-console
        console.log(DBG, 'onEditorContentLoaded');
        self.ready.set(true);
      },
      onWorkspaceSave: (ev) => {
        // eslint-disable-next-line no-console
        console.log(DBG, 'onWorkspaceSave', {
          name: ev.project?.header?.name,
          files: Object.keys(ev.project?.text ?? {}),
        });
        if (!ev.project) return;
        self.project.set(ev.project);
        // Persist into the current program so reloads don't lose work.
        const files = (ev.project.text ?? {}) as Record<string, string>;
        if (Object.keys(files).length === 0) return;
        const active = getCurrentMakeCodeProgram();
        if (active) {
          updateMakeCodeProgramFiles(active.id, files, ev.project.header);
        } else {
          // First-ever save with no program slot yet — create one so the user
          // doesn't lose their edits if they reload before clicking anywhere else.
          addMakeCodeProgram({
            name: 'Programm 1',
            files,
            header: ev.project.header,
          });
        }
      },
      onDownload: (d) => {
        // eslint-disable-next-line no-console
        console.log(DBG, 'onDownload', { name: d.name, hexLen: d.hex?.length });
        self.downloadHandlers.forEach((h) => {
          try {
            h(d);
          } catch {
            /* ignore */
          }
        });
      },
    },
    () => self.iframe,
  );
  self.driver = driver;
  driver.initialize();
  active = self;
}

/** Push a fully-formed MakeCode project into the editor. */
export function importProject(project: MakeCodeProject): boolean {
  if (!active) return false;
  active.pending = project;
  try {
    void active.driver.importProject({ project });
    return true;
  } catch {
    return false;
  }
}

/** Generate a Calliope-targeted project from Teachable app state and import it. */
export function importFromState(opts: GenerateOptions): boolean {
  return importProject(generateProjectImpl(opts));
}

/** Push a saved MakeCodeProgram's file map into the editor. */
export function importProgramFiles(
  files: Record<string, string>,
  header?: unknown,
): boolean {
  return importProject({
    header: header as MkcProject['header'],
    text: files,
  });
}

/** Expose the generator for callers that want to inspect/persist the project. */
export const generateProject = generateProjectImpl;

export type MakeCodeLang = 'blocks' | 'js' | 'python';

export async function switchMakeCodeLang(lang: MakeCodeLang): Promise<void> {
  if (!active) return;
  try {
    if (lang === 'blocks') await active.driver.switchBlocks();
    else if (lang === 'js') await active.driver.switchJavascript();
    else await active.driver.switchPython();
  } catch {
    /* driver not ready — user can try again */
  }
}

export function onMakeCodeDownload(cb: DownloadHandler): () => void {
  if (!active) return () => {};
  active.downloadHandlers.add(cb);
  return () => active?.downloadHandlers.delete(cb);
}

export function makeCodeProjectStore(): Readable<MakeCodeProject | null> {
  const s = writable<MakeCodeProject | null>(null);
  if (active) return { subscribe: active.project.subscribe };
  return s;
}

export function makeCodeReadyStore(): Readable<boolean> {
  const s = writable(false);
  if (active) return { subscribe: active.ready.subscribe };
  return s;
}

// ---- Back-compat shims for existing callers ----
// ModelTab.svelte still imports these — keep the signatures stable while the
// body now delegates to the mode-aware generator.

export function generateMakeCodeProject(
  name: string,
  classNames: string[],
  exs: Record<string, { data: string }[]>,
  mode: 'image' | 'pose' = 'image',
): MakeCodeProject {
  return generateProjectImpl({
    name,
    mode,
    classes: classNames,
    dataset: exs,
  });
}

export async function downloadMakeCodeProject(
  name: string,
  classNames: string[],
  exs: Record<string, { data: string }[]>,
  mode: 'image' | 'pose' = 'image',
) {
  const JSZip = (await import('jszip')).default;
  const { saveAs } = await import('file-saver');
  const project = generateMakeCodeProject(name, classNames, exs, mode);
  const zip = new JSZip();
  Object.entries(project.text ?? {}).forEach(([k, v]) => zip.file(k, v));
  const blob = await zip.generateAsync({ type: 'blob' });
  const safe = (project.header?.name ?? name).toString().replace(/\s+/g, '_');
  saveAs(blob, `${safe}_makecode_project_${Date.now()}.zip`);
}

export async function importProjectZip(file: File): Promise<boolean> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const text: Record<string, string> = {};
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;
    try {
      const name = path.split('/').pop() || path;
      text[name] = await entry.async('string');
    } catch {
      // skip binary
    }
  }
  return importProject({ header: undefined, text });
}
