/**
 * Replays the reference embeddings recorded by scripts/convert-mobilenet-v4.py
 * against the TensorFlow.js artifacts that ended up in `static/models/`.
 *
 * Why this exists: MobileNet v4 is the one backbone we convert ourselves
 * (ONNX -> onnx2tf -> tensorflowjs_converter). A conversion that gets the channel
 * order, the normalisation or a fused activation subtly wrong still loads and still
 * produces plausible-looking numbers — it would show up as "training just works
 * worse", which is exactly the kind of bug nobody traces back to the model file.
 * onnx2tf's own -cotof check is not enough either: it feeds its own dummy input and
 * silently gives up when that does not match the graph. So we pin the expected output.
 *
 *     node scripts/verify-mobilenet-v4.mjs
 *
 * The probe images are rebuilt here from the same closed-form expression the Python
 * script uses, so only the embeddings have to be committed.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@tensorflow/tfjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ROOT = join(ROOT, 'static', 'models');
const FIXTURE_DIR = join(ROOT, 'scripts', 'fixtures');

// timm normalisation. Mirrors `preprocess: 'imagenet'` in src/lib/machine.ts — if that
// changes, this check has to change with it, which is the point of repeating it here.
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** A cosine below this means the artifact is not the model we converted. */
const MIN_COSINE = 0.999;

/** Same expression as probe_images() in scripts/convert-mobilenet-v4.py. */
function probeImage(index, size) {
  const pixels = new Float32Array(size * size * 3);
  let at = 0;
  for (let row = 0; row < size; row++) {
    const y = row / (size - 1);
    for (let col = 0; col < size; col++) {
      const x = col / (size - 1);
      for (let c = 0; c < 3; c++) {
        const value =
          128 +
          90 * Math.sin((index + 1) * 3.0 * x + c) * Math.cos((index + 2) * 2.0 * y - c) +
          25 * Math.sin((index + 1) * 7.0 * (x + y) + 2 * c);
        pixels[at++] = Math.min(255, Math.max(0, Math.round(value)));
      }
    }
  }
  return pixels;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}

/**
 * Load a vendored model straight off disk. tfjs normally fetches over HTTP; in Node
 * that means standing up a server for a file we already have, so hand it the parsed
 * artifacts instead — concatenating the manifest's shards the way tfjs would.
 */
async function loadLocalGraphModel(dir) {
  const modelDir = join(MODEL_ROOT, dir);
  const json = JSON.parse(readFileSync(join(modelDir, 'model.json'), 'utf8'));
  const paths = json.weightsManifest.flatMap((group) => group.paths);
  const bytes = Buffer.concat(paths.map((p) => readFileSync(join(modelDir, p))));
  return tf.loadGraphModel(
    tf.io.fromMemory({
      modelTopology: json.modelTopology,
      weightSpecs: json.weightsManifest.flatMap((group) => group.weights),
      weightData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      signature: json.signature
    })
  );
}

async function check(dir, fixture) {
  const { inputSize, outputName, probeCount, embeddings } = fixture;
  const model = await loadLocalGraphModel(dir);
  const results = [];

  for (let i = 0; i < probeCount; i++) {
    const actual = tf.tidy(() => {
      const raw = tf.tensor4d(probeImage(i, inputSize), [1, inputSize, inputSize, 3]);
      const normalised = tf.div(tf.sub(tf.div(raw, 255), tf.tensor1d(MEAN)), tf.tensor1d(STD));
      const out = model.execute(normalised, outputName);
      return tf.reshape(out, [out.shape[0], -1]);
    });
    const vector = Array.from(actual.dataSync());
    actual.dispose();

    const expected = embeddings[i];
    if (vector.length !== expected.length) {
      throw new Error(
        `${dir}: probe ${i} has ${vector.length} features, reference has ${expected.length}`
      );
    }
    const maxDiff = expected.reduce((m, v, j) => Math.max(m, Math.abs(v - vector[j])), 0);
    const scale = Math.max(...expected.map(Math.abs));
    results.push({ cos: cosine(vector, expected), maxDiff, scale });
  }

  model.dispose();
  return results;
}

const fixtures = (await readdir(FIXTURE_DIR).catch(() => []))
  .filter((f) => f.endsWith('-reference.json'))
  .map((f) => ({ dir: f.replace('-reference.json', ''), file: join(FIXTURE_DIR, f) }));

if (!fixtures.length) {
  console.error(`No reference fixtures in ${FIXTURE_DIR} — run scripts/convert-mobilenet-v4.py first.`);
  process.exit(1);
}

await tf.setBackend('cpu');
let failed = false;

for (const { dir, file } of fixtures) {
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  for (const [i, { cos, maxDiff, scale }] of (await check(dir, fixture)).entries()) {
    const ok = cos >= MIN_COSINE;
    failed = failed || !ok;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${dir} probe ${i}: cos=${cos.toFixed(6)} ` +
        `maxDiff=${maxDiff.toFixed(4)} (largest reference value ${scale.toFixed(2)})`
    );
  }
}

if (failed) {
  console.error(`\nAt least one probe fell below cos >= ${MIN_COSINE}. Do not ship this conversion.`);
  process.exit(1);
}
console.log('\nAll probes match the source ONNX graph.');
