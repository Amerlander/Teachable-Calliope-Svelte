/**
 * What Anwenden shows over the camera picture.
 *
 * App-wide in localStorage rather than per project, the same way the camera
 * choice is: this describes how someone wants to *watch* a running model — on a
 * projector at the front of a room, or in a window next to the editor — and that
 * does not change when they open a different project.
 *
 * None of it touches inference. Every setting here is display only, so a
 * misremembered value can make the view unhelpful but never change what the
 * model reports or what is streamed to a Calliope.
 */

import { writable, get } from 'svelte/store';

/**
 * What is done with the image region the running model was trained on.
 *
 *  'show' — outline it over the full picture
 *  'hide' — full picture, no outline
 *  'only' — show the region alone, filling the stage
 *
 * Image projects only: a pose model reads a skeleton, not a part of the frame.
 */
export type RoiDisplay = 'show' | 'hide' | 'only';

/** How big the class covers are drawn. A projector at the back of a room wants large. */
export type ThumbSize = 'small' | 'medium' | 'large';

/** The factor the cover sizes in ApplyResults are multiplied by. */
export const THUMB_SCALE: Record<ThumbSize, number> = {
  small: 0.8,
  medium: 1.15,
  large: 1.7
};

/** How much of the classification result is on screen. */
export type ResultDetail =
  /** Every class with its bar. */
  | 'all'
  /** Only the leading class and its confidence. */
  | 'top'
  /** Nothing — the camera picture alone. */
  | 'none';

export type ApplyViewSettings = {
  resultDetail: ResultDetail;
  /**
   * Run every model in the project side by side instead of only the selected
   * one. Costs almost nothing beyond the first model — the feature extractor
   * pass is shared (see $lib/compare) — but only the selected model streams to
   * the board, so the others are strictly there to be compared by eye.
   */
  allModels: boolean;
  /** Draw the detected skeleton. Pose projects only. */
  poseSkeleton: boolean;
  /** Name each keypoint in the picture (Nase, linkes Handgelenk, …). */
  poseLabels: boolean;
  /** Write the joint angles at the joints. */
  poseAngles: boolean;
  /**
   * Blur the camera picture, as Trainieren does in pose mode. It makes the
   * skeleton the thing you look at, and shows that the skeleton is all the model
   * is given.
   */
  blurCamera: boolean;
  /** Show the class cover next to the detected class name. */
  classThumbs: boolean;
  thumbSize: ThumbSize;
  roiDisplay: RoiDisplay;
  /** Whether the settings column is open. */
  sidebarOpen: boolean;
};

export const DEFAULT_APPLY_VIEW: ApplyViewSettings = {
  resultDetail: 'all',
  allModels: false,
  poseSkeleton: true,
  // Off by default: seventeen names over one body is a lot of picture to cover,
  // and it is a thing to turn on when it is the subject, not a resting state.
  poseLabels: false,
  poseAngles: false,
  blurCamera: true,
  classThumbs: true,
  thumbSize: 'medium',
  roiDisplay: 'show',
  sidebarOpen: true
};

const STORAGE_KEY = 'teachable-apply-view';

/**
 * Merge stored settings over the defaults, field by field.
 *
 * Deliberately not `{...DEFAULT, ...parsed}`: the stored object comes from an
 * older version of this app as often as not, and a spread would let a key that
 * has since changed meaning — or a hand-edited localStorage entry — through with
 * the wrong type. A missing or unusable field falls back to its default instead.
 */
function readInitial(): ApplyViewSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_APPLY_VIEW };
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPLY_VIEW };
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_APPLY_VIEW };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_APPLY_VIEW };
  const stored = parsed as Record<string, unknown>;
  const bool = (key: keyof ApplyViewSettings) =>
    typeof stored[key] === 'boolean' ? (stored[key] as boolean) : (DEFAULT_APPLY_VIEW[key] as boolean);
  const detail = stored.resultDetail;
  const size = stored.thumbSize;
  const roi = stored.roiDisplay;
  return {
    resultDetail:
      detail === 'all' || detail === 'top' || detail === 'none'
        ? detail
        : DEFAULT_APPLY_VIEW.resultDetail,
    allModels: bool('allModels'),
    poseSkeleton: bool('poseSkeleton'),
    poseLabels: bool('poseLabels'),
    poseAngles: bool('poseAngles'),
    blurCamera: bool('blurCamera'),
    classThumbs: bool('classThumbs'),
    thumbSize:
      size === 'small' || size === 'medium' || size === 'large'
        ? size
        : DEFAULT_APPLY_VIEW.thumbSize,
    roiDisplay:
      roi === 'show' || roi === 'hide' || roi === 'only' ? roi : DEFAULT_APPLY_VIEW.roiDisplay,
    sidebarOpen: bool('sidebarOpen')
  };
}

export const applyView = writable<ApplyViewSettings>(readInitial());

applyView.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* a full or blocked storage must not break the view */
  }
});

/** The settings that are simple on/off switches — everything but `resultDetail`. */
export type BooleanViewKey = {
  [K in keyof ApplyViewSettings]: ApplyViewSettings[K] extends boolean ? K : never;
}[keyof ApplyViewSettings];

/** Flip one boolean setting. */
export function toggleApplyView(key: BooleanViewKey): void {
  applyView.update((v) => ({ ...v, [key]: !v[key] }));
}

export function setResultDetail(detail: ResultDetail): void {
  applyView.update((v) => ({ ...v, resultDetail: detail }));
}

export function setRoiDisplay(roiDisplay: RoiDisplay): void {
  applyView.update((v) => ({ ...v, roiDisplay }));
}

export function setThumbSize(thumbSize: ThumbSize): void {
  applyView.update((v) => ({ ...v, thumbSize }));
}

export function resetApplyView(): void {
  applyView.set({ ...DEFAULT_APPLY_VIEW, sidebarOpen: get(applyView).sidebarOpen });
}
