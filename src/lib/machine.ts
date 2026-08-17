import { get } from 'svelte/store';
import { dev } from '$app/environment';
import { base } from '$app/paths';
import {
  examples,
  classes,
  mobilenetModel,
  classifierModel,
  setTrainingHistory,
  appendTrainingEpoch,
  updateModelMetadata as storeUpdateMeta,
  setModelArtifacts,
  trainingHistory,
  modelMetadata,
  trainingOptions,
  type VideoRefs
} from './stores';
import {
  recordTrainedModel,
  recordImportedModel,
  currentProject,
  resolveFeatureExtractor,
  type ModelArtifacts,
  type ProjectMode,
  type Roi,
  type TrainedModel,
  type FeatureExtractor,
  type Optimizer,
  type AugmentationSettings
} from './stores/projects';
import type { ModelMetadata } from './stores';

// We will dynamically import TensorFlow and other libs on the client side

let currentStream: MediaStream | null = null;

export async function initSharedCamera(
  videoElements: VideoRefs = {},
  deviceId?: string
): Promise<MediaStream | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return null;
  try {
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }
    const constraints: MediaStreamConstraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    for (const vid of Object.values(videoElements)) {
      if (!vid) continue;
      try {
        vid.srcObject = stream;
        vid.onloadedmetadata = () => vid.play().catch(console.warn);
      } catch (err) {
        console.warn('Failed to bind video element', err);
      }
    }
    return stream;
  } catch (err) {
    console.error('Could not start camera', err);
    return null;
  }
}

/**
 * True while a shared stream is live. Device enumeration only yields usable
 * labels once permission has been granted, so the camera picker uses this to
 * enumerate off the back of a running view instead of prompting on its own.
 */
export function isCameraRunning(): boolean {
  return currentStream !== null;
}

// ---------- Feature extractor abstraction ----------
// Every model is served from our own origin out of `static/models/`. We deliberately
// do NOT go through @tensorflow-models/mobilenet or tfhub.dev: tfhub.dev now 302s to
// kaggle.com, and that redirect chain fails in the browser (403, no
// Access-Control-Allow-Origin), so every extractor loaded that way was broken.
// Self-hosting also keeps the app working in filtered school networks and offline.
// See scripts/vendor-models.mjs for where the weights come from.
const MODEL_ROOT = `${base}/models`;

type ExtractorConfig = {
  /**
   * 'graph'  -> converted TF SavedModel; the embedding is read from a named node.
   * 'layers' -> Keras model; we truncate at a layer and global-average-pool it.
   */
  kind: 'graph' | 'layers';
  url: string;
  /** Node ('graph') or layer ('layers') the embedding is taken from. */
  outputName: string;
  inputSize: number;
  /**
   * How raw 0..255 pixels must be scaled for this model.
   *  '01' -> x/255        (the tfhub-converted MobileNets)
   *  'tf' -> x/127.5 - 1  (keras.applications MobileNet)
   */
  preprocess: '01' | 'tf';
  /** Embedding length, used only for diagnostics/labelling. */
  featureCount: number;
};

const EXTRACTOR_CONFIGS: Record<FeatureExtractor, ExtractorConfig> = {
  'mobilenet-v1': {
    kind: 'graph',
    url: `${MODEL_ROOT}/mobilenet-v1/model.json`,
    outputName: 'module_apply_default/MobilenetV1/Logits/global_pool',
    inputSize: 224,
    preprocess: '01',
    featureCount: 1024
  },
  'mobilenet-v2': {
    kind: 'graph',
    url: `${MODEL_ROOT}/mobilenet-v2/model.json`,
    outputName: 'module_apply_default/MobilenetV2/Logits/AvgPool',
    inputSize: 224,
    preprocess: '01',
    featureCount: 1280
  },
  'mobilenet-v1-lite': {
    kind: 'layers',
    url: `${MODEL_ROOT}/mobilenet-v1-lite/model.json`,
    outputName: 'conv_pw_13_relu',
    inputSize: 224,
    preprocess: 'tf',
    featureCount: 512
  }
};

/**
 * A loaded extractor. `infer` mirrors the @tensorflow-models/mobilenet signature so
 * the rest of the app (readiness checks, diagnostics) keeps working unchanged.
 */
type LoadedExtractor = {
  key: FeatureExtractor;
  config: ExtractorConfig;
  /** `pixels` must be RAW 0..255 values, shaped [h, w, 3] or [1, h, w, 3]. Returns [1, D]. */
  infer(pixels: any, embedding?: boolean): any;
  dispose(): void;
};

let activeExtractor: LoadedExtractor | null = null;
let extractorLoad: { key: FeatureExtractor; promise: Promise<LoadedExtractor> } | null = null;
// The test/tryout loops call ensureExtractor on every tick, so a failing download
// would otherwise be retried several times a second and flood the console.
let extractorFailure: { key: FeatureExtractor; at: number; error: unknown } | null = null;
const EXTRACTOR_RETRY_COOLDOWN_MS = 5000;

async function loadExtractor(key: FeatureExtractor): Promise<LoadedExtractor> {
  const tf = await import('@tensorflow/tfjs');
  const config = EXTRACTOR_CONFIGS[key];
  const { inputSize, preprocess, outputName } = config;

  const prepare = (pixels: any) => {
    const float = tf.cast(pixels, 'float32');
    const scaled = preprocess === '01' ? tf.div(float, 255) : tf.sub(tf.div(float, 127.5), 1);
    const batched = tf.reshape(scaled, [-1, ...(scaled.shape.slice(-3) as number[])]);
    return batched.shape[1] === inputSize && batched.shape[2] === inputSize
      ? batched
      : tf.image.resizeBilinear(batched, [inputSize, inputSize], true);
  };

  if (config.kind === 'graph') {
    const model = await tf.loadGraphModel(config.url);
    return {
      key,
      config,
      // The embedding node yields [1, 1, 1, D]; drop the spatial dims.
      infer: (pixels: any) =>
        tf.tidy(() => tf.squeeze(model.execute(prepare(pixels), outputName) as any, [1, 2])),
      dispose: () => model.dispose()
    };
  }

  const full = await tf.loadLayersModel(config.url);
  const truncated = tf.model({ inputs: full.inputs, outputs: full.getLayer(outputName).output });
  return {
    key,
    config,
    // Truncated Keras model yields [1, H, W, C]; pool the spatial dims away.
    infer: (pixels: any) =>
      tf.tidy(() => tf.mean(truncated.predict(prepare(pixels)) as any, [1, 2])),
    // `truncated` reuses the very same Layer objects as `full`, so disposing both
    // throws ("Layer 'conv1' is already disposed") and aborts halfway, leaking the
    // rest of the weights. Disposing the full model releases every layer.
    dispose: () => full.dispose()
  };
}

/** Loads `key` if it is not already the active extractor. Concurrent calls share one load. */
async function ensureExtractor(key: FeatureExtractor): Promise<LoadedExtractor> {
  if (activeExtractor?.key === key) return activeExtractor;
  if (extractorLoad?.key === key) return extractorLoad.promise;
  if (extractorFailure?.key === key && Date.now() - extractorFailure.at < EXTRACTOR_RETRY_COOLDOWN_MS) {
    throw extractorFailure.error;
  }

  const promise = loadExtractor(key)
    .then((loaded) => {
      if (activeExtractor && activeExtractor !== loaded) {
        try { activeExtractor.dispose(); } catch { /* already gone */ }
      }
      activeExtractor = loaded;
      extractorFailure = null;
      mobilenetModel.set(loaded);
      return loaded;
    })
    .catch((error) => {
      extractorFailure = { key, at: Date.now(), error };
      throw error;
    })
    .finally(() => {
      if (extractorLoad?.promise === promise) extractorLoad = null;
    });

  extractorLoad = { key, promise };
  return promise;
}

export async function loadFeatureExtractor(key: FeatureExtractor = 'mobilenet-v1') {
  if (typeof window === 'undefined') return null;
  return ensureExtractor(key);
}

/**
 * Produce an embedding tensor for a 0..255 RGB canvas using the currently-loaded extractor.
 * Caller is responsible for disposing the returned tensor.
 */
async function embedCanvasWith(extractor: FeatureExtractor, canvas: HTMLCanvasElement): Promise<any> {
  const tf = await import('@tensorflow/tfjs');
  const loaded = await ensureExtractor(extractor);
  const pixels = tf.browser.fromPixels(canvas);
  try {
    return tf.tidy(() => tf.squeeze(loaded.infer(pixels, true)));
  } finally {
    pixels.dispose();
  }
}

type DrawSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

function sourceSize(source: DrawSource): { w: number; h: number } {
  const w = (source as HTMLVideoElement).videoWidth
    || (source as HTMLImageElement).naturalWidth
    || (source as HTMLCanvasElement).width;
  const h = (source as HTMLVideoElement).videoHeight
    || (source as HTMLImageElement).naturalHeight
    || (source as HTMLCanvasElement).height;
  return { w: w || 224, h: h || 224 };
}

/** Draw a source into `canvas`, cropped to ROI (normalized 0..1) and scaled to `size`. */
function drawWithRoi(
  source: DrawSource,
  roi: Roi | null | undefined,
  canvas: HTMLCanvasElement,
  size = 224
) {
  const { w: sw, h: sh } = sourceSize(source);
  const r = roi && roi.w > 0 && roi.h > 0 ? roi : null;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    source,
    r ? r.x * sw : 0,
    r ? r.y * sh : 0,
    r ? r.w * sw : sw,
    r ? r.h * sh : sh,
    0, 0, size, size
  );
}

/** Draw `source` with ROI + random augmentation (flip/rotation/brightness/zoom) into `canvas`. */
function drawAugmented(
  source: DrawSource,
  roi: Roi | null | undefined,
  aug: AugmentationSettings,
  canvas: HTMLCanvasElement,
  size = 224
) {
  const { w: sw, h: sh } = sourceSize(source);
  const base = roi && roi.w > 0 && roi.h > 0 ? roi : { x: 0, y: 0, w: 1, h: 1 };

  // Random zoom: shrink ROI by up to zoomJitter and shift inside the base.
  const zoom = 1 - Math.random() * Math.max(0, Math.min(0.5, aug.zoomJitter));
  const zw = base.w * zoom;
  const zh = base.h * zoom;
  const offX = Math.random() * (base.w - zw);
  const offY = Math.random() * (base.h - zh);

  const sx = (base.x + offX) * sw;
  const sy = (base.y + offY) * sh;
  const srcW = zw * sw;
  const srcH = zh * sh;

  const flip = aug.horizontalFlip && Math.random() < 0.5;
  const deg = (Math.random() * 2 - 1) * Math.max(0, aug.rotationDegrees);
  const bright = 1 + (Math.random() * 2 - 1) * Math.max(0, Math.min(1, aug.brightnessJitter));

  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.filter = `brightness(${bright.toFixed(3)})`;
  ctx.translate(size / 2, size / 2);
  ctx.rotate((deg * Math.PI) / 180);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(source, sx, sy, srcW, srcH, -size / 2, -size / 2, size, size);
  ctx.restore();
  ctx.filter = 'none';
}

// ---------- Pose detection (MoveNet) ----------
// In pose-mode projects we (a) display a blurred version of the raw camera,
// (b) overlay the detected skeleton on top for preview, and (c) train/predict
// on the *rendered skeleton canvas* rather than the raw video, which makes
// classes robust to background/clothing (same approach as Teachable Machine).

let poseDetector: any = null;
let poseLoading: Promise<any> | null = null;
let lastPoseCanvas: HTMLCanvasElement | null = null;

// Keypoint pairs for the MoveNet 17-keypoint COCO skeleton.
const SKELETON_EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4],           // head
  [5, 6],                                   // shoulders
  [5, 7], [7, 9], [6, 8], [8, 10],          // arms
  [5, 11], [6, 12], [11, 12],               // torso
  [11, 13], [13, 15], [12, 14], [14, 16]    // legs
];

export async function loadPoseDetector() {
  if (poseDetector) return poseDetector;
  if (poseLoading) return poseLoading;
  poseLoading = (async () => {
    await import('@tensorflow/tfjs');
    const posedetection = await import('@tensorflow-models/pose-detection');
    // `modelUrl` is required, not an optimisation: the library's default points at
    // tfhub.dev, which no longer answers browser fetches (see MODEL_ROOT above).
    const det = await posedetection.createDetector(
      posedetection.SupportedModels.MoveNet,
      {
        modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        modelUrl: `${MODEL_ROOT}/movenet-singlepose-lightning/model.json`
      }
    );
    poseDetector = det;
    return det;
  })();
  try {
    return await poseLoading;
  } finally {
    poseLoading = null;
  }
}

export type Pose = { keypoints: { x: number; y: number; score?: number; name?: string }[] };

export async function estimatePose(source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<Pose | null> {
  const det = await loadPoseDetector();
  if (!det) return null;
  try {
    const poses = await det.estimatePoses(source, { flipHorizontal: false });
    const raw = poses?.[0] ?? null;
    return smoothPose(raw);
  } catch {
    return null;
  }
}

// Exponential keypoint smoothing — reduces MoveNet's per-frame jitter that
// makes the skeleton appear to "vibrate". Higher alpha = more responsive,
// lower alpha = smoother. Per-keypoint so hidden points don't drag visible ones.
const SMOOTH_ALPHA = 0.45;
let smoothedKp: { x: number; y: number; score: number }[] | null = null;

function smoothPose(pose: Pose | null): Pose | null {
  if (!pose || !pose.keypoints?.length) {
    smoothedKp = null;
    return pose;
  }
  if (!smoothedKp || smoothedKp.length !== pose.keypoints.length) {
    smoothedKp = pose.keypoints.map((p) => ({ x: p.x, y: p.y, score: p.score ?? 0 }));
    return pose;
  }
  const out: Pose['keypoints'] = [];
  for (let i = 0; i < pose.keypoints.length; i++) {
    const raw = pose.keypoints[i];
    const prev = smoothedKp[i];
    const score = raw.score ?? 0;
    // If the raw keypoint is low-confidence, decay toward its position gently
    // but don't let it snap. If high confidence, follow faster.
    const a = score < 0.3 ? SMOOTH_ALPHA * 0.5 : SMOOTH_ALPHA;
    const x = prev.x + (raw.x - prev.x) * a;
    const y = prev.y + (raw.y - prev.y) * a;
    const s = prev.score + (score - prev.score) * SMOOTH_ALPHA;
    smoothedKp[i] = { x, y, score: s };
    out.push({ x, y, score: s, name: raw.name });
  }
  return { keypoints: out };
}

/** Reset the pose-smoothing buffer — call when the camera or session changes. */
export function resetPoseSmoothing() {
  smoothedKp = null;
}

/**
 * Render a skeleton-only frame (black background, colored bones/joints) into `canvas`.
 * Coordinates come in source-pixel space and are normalized to the canvas size.
 */
export function drawPoseSkeleton(
  canvas: HTMLCanvasElement,
  pose: Pose | null,
  srcW: number,
  srcH: number,
  opts: { scoreThreshold?: number; size?: number } = {}
) {
  const size = opts.size ?? canvas.width ?? 512;
  const thr = opts.scoreThreshold ?? 0.3;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  if (!pose || !srcW || !srcH) return;

  // Fit source aspect into square canvas ("contain" letterbox).
  const scale = Math.min(size / srcW, size / srcH);
  const offX = (size - srcW * scale) / 2;
  const offY = (size - srcH * scale) / 2;
  const toX = (x: number) => offX + x * scale;
  const toY = (y: number) => offY + y * scale;

  const kp = pose.keypoints;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Bone thickness scales with canvas size so the skeleton looks clean at any resolution.
  ctx.lineWidth = Math.max(4, Math.round(size / 64));
  ctx.strokeStyle = '#adf54c';
  for (const [a, b] of SKELETON_EDGES) {
    const p = kp[a], q = kp[b];
    if (!p || !q) continue;
    if ((p.score ?? 1) < thr || (q.score ?? 1) < thr) continue;
    ctx.beginPath();
    ctx.moveTo(toX(p.x), toY(p.y));
    ctx.lineTo(toX(q.x), toY(q.y));
    ctx.stroke();
  }
  ctx.fillStyle = '#ff5c8a';
  const r = Math.max(4.5, size / 100);
  for (const p of kp) {
    if ((p.score ?? 1) < thr) continue;
    ctx.beginPath();
    ctx.arc(toX(p.x), toY(p.y), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Remember the most recently-rendered skeleton canvas so predictFromVideo can pick it up in pose mode. */
export function setLastPoseCanvas(canvas: HTMLCanvasElement | null) {
  lastPoseCanvas = canvas;
}

/** Capture a skeleton-only frame (for training thumbnails in pose mode). */
export async function capturePoseFrameFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const pose = await estimatePose(video);
  const canvas = document.createElement('canvas');
  canvas.width = 224;
  canvas.height = 224;
  drawPoseSkeleton(canvas, pose, video.videoWidth, video.videoHeight, { size: 224 });
  return canvas.toDataURL('image/png');
}

export async function initApp() {
  // initialize shared services
  try {
    await loadFeatureExtractor();
  } catch (e) { console.warn('initApp load feature extractor failed', e); }
}

export const init = initApp;

/**
 * Capture a still at the camera's own aspect ratio, short side `short`.
 * Squashing the frame into a square here would only show up as distorted
 * thumbnails and previews — training squashes every example to 224² anyway
 * (see drawWithRoi), so the pixels the model ends up seeing are the same.
 */
export function captureFrameFromVideo(video: HTMLVideoElement, short = 224) {
  const vw = video.videoWidth || short;
  const vh = video.videoHeight || short;
  const scale = short / Math.min(vw, vh);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vw * scale));
  canvas.height = Math.max(1, Math.round(vh * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export async function prepareDatasetForTraining(
  roi?: Roi | null,
  aug?: AugmentationSettings | null,
  requestedExtractor: FeatureExtractor = 'mobilenet-v1'
) {
  const tfModule = await import('@tensorflow/tfjs');
  const extractor = resolveFeatureExtractor(requestedExtractor);
  await ensureExtractor(extractor);

  const classesList = get(classes);
  const ex = get(examples);

  const xs: any[] = [];
  const ys: any[] = [];
  const canvas = document.createElement('canvas');
  const augMultiplier = aug ? Math.max(0, Math.floor(aug.multiplier)) : 0;

  const embedCanvas = async () => {
    const emb = await embedCanvasWith(extractor, canvas);
    xs.push(emb);
    ys.push(tfModule.oneHot([i], classesList.length).squeeze());
  };

  let i = 0;
  for (i = 0; i < classesList.length; i++) {
    const className = classesList[i];
    const classExamples = ex[className] || [];
    for (const example of classExamples) {
      const img = new Image();
      img.src = example.data;
      await new Promise<void>(r => (img.onload = () => r()));

      // Always include the (ROI-cropped) original.
      drawWithRoi(img, roi ?? null, canvas, 224);
      await embedCanvas();

      // Augmented copies.
      for (let k = 0; k < augMultiplier; k++) {
        drawAugmented(img, roi ?? null, aug!, canvas, 224);
        await embedCanvas();
      }
    }
  }

  if (xs.length === 0) {
    throw new Error('No examples to prepare');
  }

  const stackedX = tfModule.stack(xs);
  const stackedY = tfModule.stack(ys);
  // dispose individual tensors now that we have stacked ones
  try { xs.forEach(t => { try { t.dispose(); } catch (e) {} }); } catch(e) {}
  try { ys.forEach(t => { try { t.dispose(); } catch (e) {} }); } catch(e) {}
  return { xs: stackedX, ys: stackedY };
}

export type TrainOptions = {
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  hiddenUnits?: number;
  featureExtractor?: FeatureExtractor;
  optimizer?: Optimizer;
  dropout?: number;
  validationSplit?: number;
  earlyStopLoss?: number;
  roi?: Roi | null;
  augmentation?: boolean;
  augmentationSettings?: AugmentationSettings;
};

export async function trainModel(
  optsOrEpochs: number | TrainOptions = 20,
  onEpochEnd?: (epoch: number, logs: any) => void
) {
  const opts: TrainOptions =
    typeof optsOrEpochs === 'number' ? { epochs: optsOrEpochs } : optsOrEpochs;
  const epochs = opts.epochs ?? 20;
  const batchSize = opts.batchSize ?? 16;
  const learningRate = opts.learningRate ?? 0.001;
  const hiddenUnits = opts.hiddenUnits ?? 64;
  const dropout = Math.max(0, Math.min(0.9, opts.dropout ?? 0));
  const validationSplit = Math.max(0, Math.min(0.5, opts.validationSplit ?? 0));
  const earlyStopLoss = Math.max(0, opts.earlyStopLoss ?? 0);
  const featureExtractor = resolveFeatureExtractor(opts.featureExtractor);

  const tfModule = await import('@tensorflow/tfjs');
  await ensureExtractor(featureExtractor);
  const aug = opts.augmentation && opts.augmentationSettings
    ? opts.augmentationSettings
    : null;
  const data = await prepareDatasetForTraining(opts.roi ?? null, aug, featureExtractor);

  const model = tfModule.sequential();
  const xsShape = (data.xs as any).shape as number[] | undefined;
  if (!xsShape || xsShape.length < 2) throw new Error('Unexpected xs tensor shape');
  const featureCount = xsShape[xsShape.length - 1];
  model.add(tfModule.layers.dense({ inputShape: [featureCount as number], units: hiddenUnits, activation: 'relu' }));
  if (dropout > 0) {
    model.add(tfModule.layers.dropout({ rate: dropout }));
  }
  model.add(tfModule.layers.dense({ units: get(classes).length, activation: 'softmax' }));

  const optimizerName: Optimizer = opts.optimizer ?? 'adam';
  const optimizer =
    optimizerName === 'sgd' ? tfModule.train.sgd(learningRate)
    : optimizerName === 'rmsprop' ? tfModule.train.rmsprop(learningRate)
    : tfModule.train.adam(learningRate);
  model.compile({ optimizer, loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

  classifierModel.set(model);
  // reset training history for new training session
  setTrainingHistory({ epochs: [], accuracy: [], loss: [] });

  await model.fit(data.xs, data.ys, {
    epochs,
    batchSize,
    validationSplit,
    shuffle: true,
    callbacks: {
      onEpochEnd: (e: number, logs: any) => {
        const acc = (logs && (logs.acc ?? logs.accuracy)) ?? 0;
        const loss = (logs && (logs.loss ?? 0)) ?? 0;
        appendTrainingEpoch(e + 1, acc, loss);
        onEpochEnd?.(e, logs);
        if (earlyStopLoss > 0 && loss < earlyStopLoss) {
          (model as any).stopTraining = true;
        }
      }
    }
  });

  data.xs.dispose();
  data.ys.dispose();

  // Update model metadata when training completes
  try {
    const computed = computeModelMetadataFromModel(model);
    updateModelMetadata({ classes: get(classes), date: new Date().toISOString(), params: computed.params, layers: computed.layers, sizeBytes: computed.sizeBytes });
  } catch (e) { /* ignore */ }

  // Persist artifacts into the current project slot, and record a history entry
  try {
    await persistClassifierArtifacts(model);
    const tfMod = await import('@tensorflow/tfjs');
    const ex = get(examples);
    const counts: Record<string, number> = {};
    for (const c of get(classes)) counts[c] = ex[c]?.length ?? 0;
    await model.save(
      tfMod.io.withSaveHandler(async (a: any) => {
        recordTrainedModel(
          { topology: a.modelTopology, weightSpecs: a.weightSpecs, weightData: a.weightData },
          get(modelMetadata),
          get(trainingHistory),
          get(trainingOptions),
          [...get(classes)],
          counts,
          {
            roi: opts.roi ?? undefined,
            featureExtractor,
            mode: get(currentProject)?.mode ?? 'image'
          }
        );
        return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } } as any;
      })
    );
  } catch (e) { /* ignore */ }

  return model;
}

export function updateModelMetadata(meta: Partial<ModelMetadata>) {
  storeUpdateMeta(meta);
}

async function persistClassifierArtifacts(model: any): Promise<void> {
  const tfModule = await import('@tensorflow/tfjs');
  await model.save(
    tfModule.io.withSaveHandler(async (artifacts: any) => {
      setModelArtifacts({
        topology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs,
        weightData: artifacts.weightData
      });
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } } as any;
    })
  );
}

export async function loadClassifierFromArtifacts(artifacts: {
  topology: unknown;
  weightSpecs: unknown[];
  weightData: ArrayBuffer;
}): Promise<any> {
  const tfModule = await import('@tensorflow/tfjs');
  const model = await tfModule.loadLayersModel(
    tfModule.io.fromMemory({
      modelTopology: artifacts.topology as any,
      weightSpecs: artifacts.weightSpecs as any,
      weightData: artifacts.weightData
    })
  );
  classifierModel.set(model);
  return model;
}

export async function processZipFile(file: File): Promise<{ images: string[]; detectedClass?: string; files?: string[] }> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const arrayBuffer = await file.arrayBuffer();
  const zipContent = await zip.loadAsync(arrayBuffer);
  const imageFiles: string[] = [];
  let detectedClass: string | undefined;
  const folders = Object.keys(zipContent.files).filter(path => zipContent.files[path].dir && path !== '/' && !path.includes('__MACOSX'));

  if (folders.length > 0) {
    // multi-class zip, find the first folder with image files
    for (const folder of folders) {
      const filesInFolder = Object.keys(zipContent.files).filter(path => path.startsWith(folder) && !zipContent.files[path].dir && /\.(png|jpe?g)$/i.test(path));
      if (filesInFolder.length > 0) {
        detectedClass = folder.replace(/\/$/, '');
        for (const p of filesInFolder) {
          const f = zipContent.files[p];
          const base64 = await f.async('base64');
          const mimeType = p.endsWith('.png') ? 'image/png' : 'image/jpeg';
          imageFiles.push(`data:${mimeType};base64,${base64}`);
        }
        break;
      }
    }
  }

  if (imageFiles.length === 0) {
    // single folder or plain list of images
    const files = Object.keys(zipContent.files).filter(path => !zipContent.files[path].dir && /\.(png|jpe?g)$/i.test(path));
    for (const path of files) {
      const f = zipContent.files[path];
      const base64 = await f.async('base64');
      const mimeType = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
      imageFiles.push(`data:${mimeType};base64,${base64}`);
    }
    if (zipContent.file('metadata.json')) {
      try {
        const metadata = await zipContent.file('metadata.json')!.async('string');
        const obj = JSON.parse(metadata);
        if (obj.className) detectedClass = obj.className;
      } catch (err) {
        // ignore
      }
    }
  }

  return { images: imageFiles, detectedClass, files: Object.keys(zipContent.files) };
}

export async function downloadClassImages(className: string, images: { data: string }[]) {
  const JSZip = (await import('jszip')).default;
  const saveAs = (await import('file-saver')).saveAs;
  const zip = new JSZip();
  const folder = zip.folder(className)!;
  for (let i = 0; i < images.length; i++) {
    const base64 = images[i].data.split(',')[1];
    folder.file(`${className}_${i + 1}.png`, base64, { base64: true });
  }
  folder.file('metadata.json', JSON.stringify({ className, imageCount: images.length, date: new Date().toISOString() }, null, 2));
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `${className}_images_${Date.now()}.zip`);
}

export async function downloadAllClassImages(allExamples: Record<string, { data: string }[]>) {
  const JSZip = (await import('jszip')).default;
  const saveAs = (await import('file-saver')).saveAs;
  const zip = new JSZip();
  let totalImages = 0;
  for (const className in allExamples) {
    const folder = zip.folder(className)!;
    const imgs = allExamples[className];
    for (let i = 0; i < imgs.length; i++) {
      const base64 = imgs[i].data.split(',')[1];
      folder.file(`${className}_${i + 1}.png`, base64, { base64: true });
      totalImages++;
    }
    folder.file('metadata.json', JSON.stringify({ className, imageCount: imgs.length, date: new Date().toISOString() }, null, 2));
  }
  zip.file('dataset_metadata.json', JSON.stringify({ date: new Date().toISOString(), totalImages }, null, 2));
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `teachable_machine_dataset_${Date.now()}.zip`);
}

/**
 * What a model ZIP carries beyond the weights. Written by
 * {@link exportModelToZip} and read back by {@link readModelZip}, so an
 * exported model describes itself the same way an in-app model does: which
 * classes it outputs, which image region it was trained on, which feature
 * extractor produced its inputs.
 */
type ModelZipMetadata = ModelMetadata & {
  teachableFormat?: number;
  label?: string;
  trainedAt?: number;
  roi?: Roi;
  featureExtractor?: FeatureExtractor;
  mode?: ProjectMode;
};

const MODEL_ZIP_FORMAT = 2;

/**
 * Write a model out as a ZIP. Everything comes off the stored model, not off
 * whatever classifier happens to be in memory, so exporting the third model in
 * the list really exports that one.
 */
export async function exportModelToZip(model: TrainedModel): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const saveAs = (await import('file-saver')).saveAs;
  const zip = new JSZip();
  const meta: ModelZipMetadata = {
    ...model.metadata,
    teachableFormat: MODEL_ZIP_FORMAT,
    classes: [...model.classes],
    label: model.label,
    trainedAt: model.trainedAt,
    mode: model.mode,
    featureExtractor: resolveFeatureExtractor(model.featureExtractor ?? model.options?.featureExtractor),
    ...(model.roi ? { roi: model.roi } : {})
  };
  zip.file('metadata.json', JSON.stringify(meta, null, 2));
  zip.file(
    'model.json',
    new Blob([JSON.stringify(model.artifacts.topology)], { type: 'application/json' })
  );
  zip.file(
    'weights.json',
    new Blob([JSON.stringify(model.artifacts.weightSpecs)], { type: 'application/json' })
  );
  zip.file(
    'weights.bin',
    new Blob([model.artifacts.weightData], { type: 'application/octet-stream' })
  );
  const content = await zip.generateAsync({ type: 'blob' });
  const safeName = (model.label || 'teachable_machine_model').replace(/[^a-z0-9_\- ]/gi, '_');
  saveAs(content, `${safeName}_${Date.now()}.zip`);
}

export type ModelZipContents = {
  artifacts: ModelArtifacts;
  metadata: ModelMetadata;
  /** Classes the model outputs, in output-unit order. */
  classes: string[];
  label?: string;
  roi?: Roi;
  featureExtractor?: FeatureExtractor;
  mode?: ProjectMode;
  /** The loaded classifier, ready to hand to `classifierModel`. */
  model: any;
};

/**
 * Parse a model ZIP into everything a model entry needs, without touching app
 * state. ZIPs written before the metadata carried a class list fall back to
 * generated labels sized to the classifier's output layer — a model with
 * unnamed classes is still usable, one with the wrong number of classes is not.
 */
export async function readModelZip(file: File): Promise<ModelZipContents> {
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
  const artifacts: ModelArtifacts = { topology, weightSpecs, weightData };

  let meta: ModelZipMetadata = { name: '', date: '', version: '1.0', classes: [] };
  const metaEntry = zip.file('metadata.json');
  if (metaEntry) {
    try {
      meta = { ...meta, ...JSON.parse(await metaEntry.async('string')) };
    } catch {
      /* keep the defaults — a broken metadata.json must not sink the import */
    }
  }

  const model = await loadClassifierFromArtifacts(artifacts);
  const outputs = outputUnitsOf(model);
  let classes = (meta.classes ?? []).filter((c) => typeof c === 'string');
  if (outputs && classes.length !== outputs) {
    classes = Array.from({ length: outputs }, (_, i) => classes[i] || `Klasse ${i + 1}`);
  }

  const computed = computeModelMetadataFromModel(model);
  return {
    artifacts,
    metadata: {
      name: meta.name || file.name.replace(/\.zip$/i, ''),
      date: meta.date || new Date().toISOString(),
      version: meta.version || '1.0',
      classes,
      params: computed.params,
      layers: computed.layers,
      sizeBytes: computed.sizeBytes
    },
    classes,
    label: meta.label,
    roi: meta.roi,
    featureExtractor: meta.featureExtractor,
    mode: meta.mode,
    model
  };
}

/** Number of output units of a loaded classifier, or null when unreadable. */
function outputUnitsOf(model: any): number | null {
  try {
    const shape = model?.outputs?.[0]?.shape as (number | null)[] | undefined;
    const units = shape?.[shape.length - 1];
    return typeof units === 'number' && units > 0 ? units : null;
  } catch {
    return null;
  }
}

/**
 * Import a model ZIP into the open project as a selectable model, and load it.
 * Returns the new model's id.
 */
export async function importModelFromZip(file: File): Promise<string | null> {
  const contents = await readModelZip(file);
  const id = recordImportedModel({
    artifacts: contents.artifacts,
    metadata: contents.metadata,
    classes: contents.classes,
    label: contents.label || contents.metadata.name || file.name.replace(/\.zip$/i, ''),
    roi: contents.roi,
    featureExtractor: contents.featureExtractor,
    mode: contents.mode
  });
  classifierModel.set(contents.model);
  return id;
}

export async function predictFromVideo(video: HTMLVideoElement) {
  const classifier = get(classifierModel);
  const classesList = get(classes);
  if (!classifier || !video) return null;

  // Everything inference needs is on the selected model: its classes, the image
  // region it was trained on, and the extractor its embeddings came from.
  const proj = get(currentProject);
  const active = proj?.modelHistory.find((m) => m.id === proj.currentModelId) ?? null;
  // Output units map onto the classes the model was trained with — the live
  // class list may have grown or been renamed since.
  const labels = active?.classes?.length ? active.classes : classesList;
  const extractor = resolveFeatureExtractor(active?.featureExtractor);
  await ensureExtractor(extractor);
  const canvas = document.createElement('canvas');
  // In pose projects, use the rendered skeleton canvas; otherwise raw video.
  const source: DrawSource = proj?.mode === 'pose' && lastPoseCanvas ? lastPoseCanvas : video;
  drawWithRoi(source, active?.roi ?? null, canvas, 224);

  let emb: any = null;
  let batched: any = null;
  let predictionTensor: any = null;
  try {
    emb = await embedCanvasWith(extractor, canvas);
    batched = emb.expandDims(0);
    predictionTensor = await classifier.predict(batched) as any;
    const preds = (await predictionTensor.data()) as any;
  let maxProb = 0;
  let maxIndex = 0;
  for (let i = 0; i < preds.length; i++) {
    if (preds[i] > maxProb) {
      maxProb = preds[i];
      maxIndex = i;
    }
  }
    return {
      className: labels[maxIndex] || `class_${maxIndex}`,
      probability: maxProb,
      index: maxIndex,
      allProbs: Array.from(preds as Float32Array | number[]) as number[]
    };
  } catch (e) {
    console.error('predictFromVideo failed', e);
    return null;
  } finally {
    try { if (predictionTensor && predictionTensor.dispose) predictionTensor.dispose(); } catch (e) {}
    try { if (batched && batched.dispose) batched.dispose(); } catch (e) {}
    try { if (emb && emb.dispose) emb.dispose(); } catch (e) {}
  }
}

export async function getModelDiagnostics() {
  const tfModule = await import('@tensorflow/tfjs');
  const mobilenet = get(mobilenetModel);
  const classifier = get(classifierModel);
  const cls = get(classes);
  const diag: any = {
    mobilenetLoaded: !!mobilenet,
    extractor: mobilenet?.key ?? null,
    expectedFeatures: mobilenet?.config?.featureCount ?? null,
    classifierLoaded: !!classifier,
    classesCount: cls.length
  };
  if (mobilenet && dev) {
    // create a tiny dummy to check the embedding size
    let dummy: any = null;
    try {
      dummy = tfModule.zeros([1, 224, 224, 3]);
      const emb = mobilenet.infer(dummy, true);
      diag.embeddingShape = emb ? emb.shape : null;
      try { emb.dispose(); } catch (e) {}
    } catch (e) {
      diag.embeddingShape = null;
      console.warn('getModelDiagnostics failed to create embedding test', e);
    }
    try { dummy.dispose(); } catch (e) {}
  }
  if (classifier) {
    try {
      diag.classifierInputShape = classifier?.inputs?.[0]?.shape ?? null;
      diag.classifierOutputShape = classifier?.outputs?.[0]?.shape ?? null;
    } catch (e) {
      diag.classifierInputShape = null;
      diag.classifierOutputShape = null;
    }
  }
  return diag;
}

export function computeModelMetadataFromModel(model: any) {
  if (!model) return { params: 0, layers: 0, sizeBytes: 0 };
  // Get weight shapes without mutating or disposing any tensors on the model
  let weightsShapes: number[][] = [];
  try {
    if (model.getWeights) {
      const weights = model.getWeights();
      weightsShapes = weights.map((w: any) => w.shape || (w.tensor ? w.tensor.shape : []));
      // DO NOT dispose weights here — they are tensors owned by the model
    } else if (model.weights) {
      weightsShapes = model.weights.map((w: any) => w.shape || (w.tensor ? w.tensor.shape : []));
    }
  } catch (e) {
    weightsShapes = [];
  }
  let params = 0;
  for (const shape of weightsShapes) {
    try {
      const paramCount = shape && shape.length ? shape.reduce((a: number, b: number) => a * b, 1) : 0;
      params += paramCount;
    } catch (e) { /* ignore */ }
  }
  const layers = model.layers ? model.layers.length : 0;
  const sizeBytes = params * 4; // float32 approx
  return { params, layers, sizeBytes };
}

export async function calculateConfusionMatrix() {
  const classifier = get(classifierModel);
  const ex = get(examples);
  if (!classifier) throw new Error('Model not ready');

  const proj = get(currentProject);
  const active = proj?.modelHistory.find((m) => m.id === proj.currentModelId) ?? null;
  // Rows and columns are the model's own classes: its output units line up with
  // that list, and scoring the project's live classes against it would put
  // predictions in the wrong column as soon as a class was added or renamed.
  const classesList = active?.classes?.length ? active.classes : get(classes);
  const n = classesList.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));

  const roi = active?.roi ?? null;
  const extractor = resolveFeatureExtractor(active?.featureExtractor);
  await ensureExtractor(extractor);
  const canvas = document.createElement('canvas');

  for (let i = 0; i < classesList.length; i++) {
    const className = classesList[i];
    const classExamples = ex[className] || [];
    for (const example of classExamples) {
      const img = new Image();
      img.src = example.data;
      await new Promise<void>(r => (img.onload = () => r()));
      drawWithRoi(img, roi, canvas, 224);
      const emb = await embedCanvasWith(extractor, canvas);
      const batched = emb.expandDims(0);
      const predictionTensor: any = await classifier.predict(batched) as any;
      const preds = await predictionTensor.data();
      let maxIndex = 0;
      let maxProb = 0;
      for (let k = 0; k < preds.length; k++) {
        if (preds[k] > maxProb) { maxProb = preds[k]; maxIndex = k; }
      }
      matrix[i][maxIndex]++;
      try { emb.dispose(); } catch (e) {}
      try { batched.dispose(); } catch (e) {}
      try { if (predictionTensor && predictionTensor.dispose) predictionTensor.dispose(); } catch (e) {}
    }
  }
  return { matrix, classes: classesList };
}

