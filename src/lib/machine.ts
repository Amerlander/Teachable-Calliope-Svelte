import { get } from 'svelte/store';
import { dev } from '$app/environment';
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
  trainingOptions
} from './stores';
import { recordTrainedModel, currentProject, type Roi, type FeatureExtractor, type Optimizer } from './stores/projects';
import { showNotification } from './stores/notifications';
import type { ModelMetadata } from './stores';

// We will dynamically import TensorFlow and other libs on the client side

type CameraVideoRefs = {
  webcam?: HTMLVideoElement | null;
  webcamTest?: HTMLVideoElement | null;
  webcamTryout?: HTMLVideoElement | null;
};

let currentStream: MediaStream | null = null;

export async function initSharedCamera(
  videoElements: CameraVideoRefs = {},
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
    const els = [videoElements.webcam, videoElements.webcamTest, videoElements.webcamTryout];
    for (const vid of els) {
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

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return [];
  try {
    // Probe once so device labels become available
    if (!currentStream) {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
    }
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

let loadedMobilenetVersion: 1 | 2 = 1;

export async function loadMobilenetModel(version: 1 | 2 = 1) {
  if (typeof window === 'undefined') return null;
  await import('@tensorflow/tfjs');
  const mobilenet = await import('@tensorflow-models/mobilenet');
  const model = await mobilenet.load({ version, alpha: 1.0 });
  mobilenetModel.set(model);
  loadedMobilenetVersion = version;
  return model;
}

/** Map a FeatureExtractor choice to an actually-supported MobileNet version.
 *  Unsupported extractors fall back to v1 with a warning. */
async function ensureExtractor(extractor: FeatureExtractor | undefined) {
  const desired: 1 | 2 =
    extractor === 'mobilenet-v2' ? 2 :
    extractor === 'mobilenet-v1' ? 1 :
    (extractor ? 1 : loadedMobilenetVersion);
  if (extractor && !['mobilenet-v1', 'mobilenet-v2'].includes(extractor)) {
    try {
      showNotification(
        `Feature-Extraktor "${extractor}" ist noch nicht verfügbar – verwende MobileNet v1.`,
        { type: 'warning' }
      );
    } catch { /* ignore */ }
  }
  if (desired !== loadedMobilenetVersion || !get(mobilenetModel)) {
    await loadMobilenetModel(desired);
  }
}

/** Draw a (video|image|canvas) source into `canvas`, cropped to ROI (normalized 0..1). */
function drawWithRoi(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  roi: Roi | null | undefined,
  canvas: HTMLCanvasElement,
  size = 224
) {
  const sw = (source as HTMLVideoElement).videoWidth
    || (source as HTMLImageElement).naturalWidth
    || (source as HTMLCanvasElement).width
    || size;
  const sh = (source as HTMLVideoElement).videoHeight
    || (source as HTMLImageElement).naturalHeight
    || (source as HTMLCanvasElement).height
    || size;
  const r = roi && roi.w > 0 && roi.h > 0 ? roi : null;
  const sx = r ? r.x * sw : 0;
  const sy = r ? r.y * sh : 0;
  const srcW = r ? r.w * sw : sw;
  const srcH = r ? r.h * sh : sh;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, sx, sy, srcW, srcH, 0, 0, size, size);
}

export async function initApp() {
  // initialize shared services
  try {
    await loadMobilenetModel();
  } catch (e) { console.warn('initApp load mobilenet failed', e); }
}

export const init = initApp;

export function captureFrameFromVideo(video: HTMLVideoElement) {
  const canvas = document.createElement('canvas');
  canvas.width = 224;
  canvas.height = 224;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export async function prepareDatasetForTraining(roi?: Roi | null) {
  const tfModule = await import('@tensorflow/tfjs');
  const mobilenet = get(mobilenetModel);
  if (!mobilenet) throw new Error('Mobilenet not loaded');

  const classesList = get(classes);
  const ex = get(examples);

  const xs: any[] = [];
  const ys: any[] = [];
  const canvas = document.createElement('canvas');

  for (let i = 0; i < classesList.length; i++) {
    const className = classesList[i];
    const classExamples = ex[className] || [];
    for (const example of classExamples) {
      const img = new Image();
      img.src = example.data;
      await new Promise<void>(r => (img.onload = () => r()));
      drawWithRoi(img, roi ?? null, canvas, 224);
      const input = tfModule.browser.fromPixels(canvas).toFloat().div(127.5).sub(1).expandDims(0);
      const emb = mobilenet.infer(input, true);
      xs.push(emb.squeeze());
      ys.push(tfModule.oneHot([i], classesList.length).squeeze());
      input.dispose();
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
  // advanced / new
  featureExtractor?: FeatureExtractor;
  optimizer?: Optimizer;
  dropout?: number;
  validationSplit?: number;
  earlyStopLoss?: number;
  roi?: Roi | null;
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
  const featureExtractor = opts.featureExtractor ?? 'mobilenet-v1';

  const tfModule = await import('@tensorflow/tfjs');
  await ensureExtractor(featureExtractor);
  const data = await prepareDatasetForTraining(opts.roi ?? null);

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
          { roi: opts.roi ?? undefined, featureExtractor }
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

export async function saveModelToZip(model: any, meta: any) {
  if (!model) throw new Error('No model to save');
  const JSZip = (await import('jszip')).default;
  const saveAs = (await import('file-saver')).saveAs;
  const tfModule = await import('@tensorflow/tfjs');
  const zip = new JSZip();
  zip.file('metadata.json', JSON.stringify(meta, null, 2));
  // Save model via TF.js handler
  await model.save(tfModule.io.withSaveHandler(async (artifacts: any) => {
    zip.file('model.json', new Blob([JSON.stringify(artifacts.modelTopology)], { type: 'application/json' }));
    zip.file('weights.json', new Blob([JSON.stringify(artifacts.weightSpecs)], { type: 'application/json' }));
    zip.file('weights.bin', new Blob([artifacts.weightData], { type: 'application/octet-stream' }));
    return ({ modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } } as any);
  }));
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `teachable_machine_model_${Date.now()}.zip`);
  // update model metadata store
  try { updateModelMetadata(meta); } catch (e) { /* ignore */ }
}

export async function loadModelFromZip(file: File) {
  const tfModule = await import('@tensorflow/tfjs');
  const JSZip = (await import('jszip')).default;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  if (!zip.file('model.json') || !zip.file('weights.json') || !zip.file('weights.bin')) {
    throw new Error('Model ZIP is missing required files');
  }
  const modelFileObj = zip.file('model.json');
  if (!modelFileObj) throw new Error('Missing model.json in zip');
  const modelFile = await modelFileObj.async('string');
  const modelTopology = JSON.parse(modelFile);
  const weightSpecsObj = zip.file('weights.json');
  if (!weightSpecsObj) throw new Error('Missing weights.json in zip');
  const weightSpecsFile = await weightSpecsObj.async('string');
  const weightSpecs = JSON.parse(weightSpecsFile);
  const weightsObj = zip.file('weights.bin');
  if (!weightsObj) throw new Error('Missing weights.bin in zip');
  const weightsArrayBuffer = await weightsObj.async('arraybuffer');
  const weightData = new Uint8Array(weightsArrayBuffer);
  // Use browserFiles handler for TensorFlow.js to load model from model.json + weights
  const modelJsonBlob = new Blob([JSON.stringify(modelTopology)], { type: 'application/json' });
  const weightsBlob = new Blob([weightData.buffer], { type: 'application/octet-stream' });
  const modelJsonFile = new File([modelJsonBlob], 'model.json', { type: 'application/json' });
  const weightsFileObj = new File([weightsBlob], 'weights.bin', { type: 'application/octet-stream' });
  const model = await tfModule.loadLayersModel(tfModule.io.browserFiles([modelJsonFile, weightsFileObj]));
  classifierModel.set(model);
  // update metadata store if present
  if (zip.file('metadata.json')) {
    try {
      const metaStr = await zip.file('metadata.json')!.async('string');
      const meta = JSON.parse(metaStr);
      updateModelMetadata(meta);
    } catch (e) { /* ignore */ }
  }
  // compute params/layers/size when model loaded
  try {
    const computed = computeModelMetadataFromModel(model);
    updateModelMetadata({ params: computed.params, layers: computed.layers, sizeBytes: computed.sizeBytes });
  } catch (e) { /* ignore */ }
  try {
    await persistClassifierArtifacts(model);
  } catch (e) { /* ignore */ }
  return model;
}

// Backwards-compat alias for the Tryout UI
export const loadTryoutModel = loadModelFromZip;

export async function predictFromVideo(video: HTMLVideoElement) {
  const tfModule = await import('@tensorflow/tfjs');
  const mobilenet = get(mobilenetModel);
  const classifier = get(classifierModel);
  const classesList = get(classes);
  if (!mobilenet || !classifier || !video) {
    if (dev) console.debug('predictFromVideo early exit', { mobilenet: !!mobilenet, classifier: !!classifier, video: !!video });
    return null;
  }

  // Use ROI + feature extractor stored on the currently loaded trained model.
  const proj = get(currentProject);
  const active = proj?.modelHistory.find((m) => m.id === proj.currentModelId) ?? null;
  if (active?.featureExtractor) {
    await ensureExtractor(active.featureExtractor);
  }
  const canvas = document.createElement('canvas');
  drawWithRoi(video, active?.roi ?? null, canvas, 224);

  let input: any = null;
  let emb: any = null;
  let predictionTensor: any = null;
  try {
    input = tfModule.browser.fromPixels(canvas).toFloat().div(127.5).sub(1).expandDims(0);
    if (dev) console.debug('predictFromVideo input.shape', input.shape);
    emb = mobilenet.infer(input, true);
    if (dev) console.debug('predictFromVideo emb.shape', emb?.shape);
    const classifierInputShape = classifier?.inputs?.[0]?.shape;
    if (dev) console.debug('predictFromVideo classifier input shape', classifierInputShape);
    predictionTensor = await classifier.predict(emb) as any;
    const preds = (await predictionTensor.data()) as any;
    if (dev) console.debug('predictFromVideo preds', preds, 'classesLen', get(classes).length);
    // warn if number of classes doesn't match the predictions length
    const clsLen = get(classes).length;
    if (clsLen > 0 && preds.length !== clsLen) {
      console.warn('[predictFromVideo] mismatch classes length vs preds length', { classes: clsLen, predsLen: preds.length });
    }
  let maxProb = 0;
  let maxIndex = 0;
  for (let i = 0; i < preds.length; i++) {
    if (preds[i] > maxProb) {
      maxProb = preds[i];
      maxIndex = i;
    }
  }
    return {
      className: classesList[maxIndex] || `class_${maxIndex}`,
      probability: maxProb,
      index: maxIndex,
      allProbs: Array.from(preds as Float32Array | number[]) as number[]
    };
  } catch (e) {
    console.error('predictFromVideo failed', e);
    return null;
  } finally {
    try { if (predictionTensor && predictionTensor.dispose) predictionTensor.dispose(); } catch (e) {}
    try { if (input && input.dispose) input.dispose(); } catch (e) {}
    try { if (emb && emb.dispose) emb.dispose(); } catch (e) {}
  }
}

export async function getModelDiagnostics() {
  const tfModule = await import('@tensorflow/tfjs');
  const mobilenet = get(mobilenetModel);
  const classifier = get(classifierModel);
  const cls = get(classes);
  const diag: any = { mobilenetLoaded: !!mobilenet, classifierLoaded: !!classifier, classesCount: cls.length };
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
  const tfModule = await import('@tensorflow/tfjs');
  const mobilenet = get(mobilenetModel);
  const classifier = get(classifierModel);
  const classesList = get(classes);
  const ex = get(examples);
  if (!mobilenet || !classifier) throw new Error('Model not ready');
  const n = classesList.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));

  const proj = get(currentProject);
  const active = proj?.modelHistory.find((m) => m.id === proj.currentModelId) ?? null;
  const roi = active?.roi ?? null;
  const canvas = document.createElement('canvas');

  for (let i = 0; i < classesList.length; i++) {
    const className = classesList[i];
    const classExamples = ex[className] || [];
    for (const example of classExamples) {
      const img = new Image();
      img.src = example.data;
      await new Promise<void>(r => (img.onload = () => r()));
      drawWithRoi(img, roi, canvas, 224);
      const input = tfModule.browser.fromPixels(canvas).toFloat().div(127.5).sub(1).expandDims(0);
      const emb = mobilenet.infer(input, true);
      const predictionTensor: any = await classifier.predict(emb) as any;
      const preds = await predictionTensor.data();
      let maxIndex = 0;
      let maxProb = 0;
      for (let k = 0; k < preds.length; k++) {
        if (preds[k] > maxProb) { maxProb = preds[k]; maxIndex = k; }
      }
      matrix[i][maxIndex]++;
      try { input.dispose(); } catch (e) {}
      try { emb.dispose(); } catch (e) {}
      try { if (predictionTensor && predictionTensor.dispose) predictionTensor.dispose(); } catch (e) {}
    }
  }
  return { matrix, classes: classesList };
}

