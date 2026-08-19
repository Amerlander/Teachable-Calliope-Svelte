/**
 * Downloads the TensorFlow.js model weights we ship into `static/models/`.
 *
 * The resulting files are committed, so this script is not part of the build —
 * it exists to document where the weights came from and to make a refresh
 * reproducible. Run it with `node scripts/vendor-models.mjs`.
 *
 * Why we self-host at all: tfhub.dev now 302s to kaggle.com and that redirect
 * chain does not answer browser fetches (403, no Access-Control-Allow-Origin),
 * which broke every extractor and the MoveNet pose detector. Server-side the
 * downloads work fine, so vendoring is the only way to get those weights into
 * the browser — and it also makes the app usable in filtered school networks.
 *
 * Weight shards are merged per model. MobileNet v1 Lite ships as 55 separate
 * shards upstream; serving that as one file turns 56 requests into 2. The merged
 * blob is then cut back into as few pieces as a static host allows — see
 * scripts/shard-weights.mjs for why that limit exists.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specByteLength, writeModel } from './shard-weights.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = join(ROOT, 'static', 'models');
const TFJS_MODELS = 'https://storage.googleapis.com/tfjs-models';
const TFHUB = 'https://tfhub.dev';

/** @type {{dir: string, url: string, note: string}[]} */
const MODELS = [
  {
    dir: 'mobilenet-v1',
    url: `${TFJS_MODELS}/savedmodel/mobilenet_v1_1.0_224/model.json`,
    note: 'MobileNet v1, alpha 1.0, 224px — feature extractor (graph model, embedding at module_apply_default/MobilenetV1/Logits/global_pool)'
  },
  {
    dir: 'mobilenet-v2',
    url: `${TFJS_MODELS}/savedmodel/mobilenet_v2_1.0_224/model.json`,
    note: 'MobileNet v2, alpha 1.0, 224px — feature extractor (graph model, embedding at module_apply_default/MobilenetV2/Logits/AvgPool)'
  },
  {
    dir: 'mobilenet-v3-small',
    url: `${TFHUB}/google/tfjs-model/imagenet/mobilenet_v3_small_100_224/feature_vector/5/default/1/model.json?tfjs-format=file`,
    note: 'MobileNet v3 Small, alpha 1.0, 224px — feature extractor (graph model, feature vector is the default output "Identity")'
  },
  {
    dir: 'mobilenet-v3-large',
    url: `${TFHUB}/google/tfjs-model/imagenet/mobilenet_v3_large_100_224/feature_vector/5/default/1/model.json?tfjs-format=file`,
    note: 'MobileNet v3 Large, alpha 1.0, 224px — feature extractor (graph model, feature vector is the default output "Identity")'
  },
  {
    dir: 'mobilenet-v1-lite',
    url: `${TFJS_MODELS}/tfjs/mobilenet_v1_0.50_224/model.json`,
    note: 'MobileNet v1, alpha 0.5, 224px — feature extractor (Keras layers model, truncated at conv_pw_13_relu)'
  },
  {
    dir: 'movenet-singlepose-lightning',
    url: `${TFHUB}/google/tfjs-model/movenet/singlepose/lightning/4/model.json?tfjs-format=file`,
    note: 'MoveNet SinglePose Lightning v4 — pose detection'
  }
];

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Concatenate every shard of every weight group into one buffer and flatten the
 * groups into a single list of specs describing it.
 *
 * TFJS resolves a weight's position by walking a group's specs in order and
 * summing their byte lengths, so flattening groups is only safe when each
 * group's shards hold exactly its specs and nothing else. We assert that rather
 * than assume it — a padded group would silently shift every later tensor.
 */
async function downloadMerged(baseUrl, manifest, query) {
  const chunks = [];
  const weights = [];
  for (const group of manifest) {
    const buffers = await Promise.all(
      group.paths.map((p) => fetchBuffer(`${baseUrl}/${p}${query}`))
    );
    const actual = buffers.reduce((n, b) => n + b.length, 0);
    const expected = group.weights.reduce((n, w) => n + specByteLength(w), 0);
    if (actual !== expected) {
      throw new Error(
        `Weight group [${group.paths.join(', ')}] is ${actual} bytes but its specs ` +
        `describe ${expected}. Merging groups would corrupt the weights — aborting.`
      );
    }
    chunks.push(...buffers);
    weights.push(...group.weights);
  }
  return { data: Buffer.concat(chunks), manifest: [{ paths: [], weights }] };
}

async function vendor(model) {
  const [plainUrl, search] = model.url.split('?');
  const query = search ? `?${search}` : '';
  const baseUrl = plainUrl.slice(0, plainUrl.lastIndexOf('/'));

  const topology = JSON.parse((await fetchBuffer(model.url)).toString('utf8'));
  const shardCountBefore = topology.weightsManifest.flatMap((g) => g.paths).length;
  const { data, manifest } = await downloadMerged(baseUrl, topology.weightsManifest, query);
  topology.weightsManifest = manifest;

  const outDir = join(OUT_ROOT, model.dir);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const shards = await writeModel(outDir, topology, data);
  const modelJson = await readFile(join(outDir, 'model.json'), 'utf8');

  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  console.log(
    `${model.dir.padEnd(30)} ${mb(modelJson.length + data.length).padStart(8)}  ` +
    `${shardCountBefore} Shards -> ${shards.length}`
  );

  return {
    dir: model.dir,
    note: model.note,
    source: model.url,
    retrieved: new Date().toISOString().slice(0, 10),
    shardsMerged: shardCountBefore,
    bytes: modelJson.length + data.length,
    sha256: createHash('sha256').update(data).digest('hex')
  };
}

// Without arguments every model is re-downloaded. Naming directories vendors only
// those and keeps the recorded provenance of the rest, so adding one model does not
// have to touch weights that are already committed.
const only = process.argv.slice(2);
const unknown = only.filter((dir) => !MODELS.some((m) => m.dir === dir));
if (unknown.length) throw new Error(`Unbekannte Modelle: ${unknown.join(', ')}`);
const selected = only.length ? MODELS.filter((m) => only.includes(m.dir)) : MODELS;

const previous = await readFile(join(OUT_ROOT, 'PROVENANCE.json'), 'utf8')
  .then((raw) => JSON.parse(raw).models)
  .catch(() => []);

const vendored = new Map();
for (const model of selected) vendored.set(model.dir, await vendor(model));
// Models this script does not know about — MobileNet v4 is converted by
// scripts/convert-mobilenet-v4.py — keep their recorded provenance instead of being
// dropped from the file the next time somebody refreshes the downloads.
const foreign = previous.filter((p) => !MODELS.some((m) => m.dir === p.dir));
const provenance = MODELS
  .map((m) => vendored.get(m.dir) ?? previous.find((p) => p.dir === m.dir))
  .filter(Boolean)
  .concat(foreign);
await writeFile(
  join(OUT_ROOT, 'PROVENANCE.json'),
  JSON.stringify({ models: provenance }, null, 2) + '\n'
);
console.log(`\nGesamt: ${(provenance.reduce((n, m) => n + m.bytes, 0) / 1048576).toFixed(1)} MB`);
