import { writable } from 'svelte/store';

export const classes = writable<string[]>([]);
export const examples = writable<Record<string, { data: string }[]>>({});
export const activeClass = writable<string | null>(null);

export const mobilenetModel = writable<any>(null);
export const classifierModel = writable<any>(null);

export const trainingHistory = writable<{ epochs: number[]; accuracy: number[]; loss: number[] }>({ epochs: [], accuracy: [], loss: [] });
export type ModelMetadata = {
  name: string;
  date: string;
  version: string;
  classes: string[];
  params?: number;
  layers?: number;
  sizeBytes?: number;
};

export const modelMetadata = writable<ModelMetadata>(
  { name: 'Teachable Machine Model', date: new Date().toISOString(), version: '1.0', classes: [] }
);

export function addClass(name: string) {
  if (!name) return;
  classes.update(c => {
    if (c.includes(name)) return c;
    c.push(name);
    return c;
  });
  examples.update(e => {
    if (!e[name]) e[name] = [];
    return e;
  });
  activeClass.set(name);
}

export function setActiveClass(name: string | null) {
  if (!name) return activeClass.set(null);
  activeClass.set(name);
}

export function pushExample(name: string, data: string) {
  if (!name) return;
  examples.update(e => {
    if (!e[name]) e[name] = [];
    e[name].push({ data });
    return e;
  });
}

export function clearClass(name: string) {
  examples.update(e => {
    if (!e[name]) return e;
    e[name] = [];
    return e;
  });
}

export function removeClass(name: string) {
  classes.update(c => c.filter(s => s !== name));
  examples.update(e => {
    delete e[name];
    return e;
  });
  activeClass.set(null);
}

// video element refs for shared camera usage
export const videoRefs = writable<{ webcam?: HTMLVideoElement | null; webcamTest?: HTMLVideoElement | null; webcamTryout?: HTMLVideoElement | null }>({});

export function setVideoRef(key: 'webcam' | 'webcamTest' | 'webcamTryout', el: HTMLVideoElement | null) {
  videoRefs.update(v => {
    v[key] = el;
    return v;
  });
}
