/**
 * Splits the weight blob of a vendored TensorFlow.js model into files small enough
 * for a static host, and puts the resulting paths into its `model.json`.
 *
 * Why this exists: scripts/vendor-models.mjs and scripts/convert-mobilenet-v4.py
 * merge the converter's 4 MB shards into one `weights.bin` per model, because 56
 * requests for MobileNet v1 Lite is worse than 2. That is still right for every
 * backbone but MobileNet v4 Medium, whose weights are 32 MiB — over the 25 MiB
 * per-file limit Cloudflare Pages enforces on upload, so the deployment fails
 * before the model is ever served.
 *
 * So: merge as before, then cut the result into as few pieces as the limit allows.
 * TFJS concatenates a weight group's paths in order and only then walks the specs
 * to find each tensor, so a shard boundary may fall anywhere — mid-tensor is what
 * tensorflowjs_converter itself does. Loading is unaffected.
 *
 * Run directly to repack models that are already committed:
 *
 *     node scripts/shard-weights.mjs                     # every model
 *     node scripts/shard-weights.mjs mobilenet-v4-medium # just one
 *
 * That is byte-preserving: the concatenated stream, and therefore the sha256 in
 * PROVENANCE.json, stays exactly what it was.
 */
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = join(ROOT, 'static', 'models');

/**
 * Largest weight file we write. Cloudflare Pages rejects any asset above 25 MiB;
 * 20 leaves room for a host that is slightly stricter without splitting models
 * that comfortably fit today (the next largest is MobileNet v1 at 16.1 MiB).
 */
export const SHARD_LIMIT = 20 * 1024 * 1024;

/** Bytes one element of a weight spec occupies on the wire. */
function bytesPerElement(spec) {
  const dtype = spec.quantization?.dtype ?? spec.dtype;
  switch (dtype) {
    case 'uint8': case 'int8': case 'bool': return 1;
    case 'uint16': case 'int16': case 'float16': return 2;
    case 'float32': case 'int32': return 4;
    case 'complex64': return 8;
    default: throw new Error(`Unhandled weight dtype: ${dtype}`);
  }
}

export function specByteLength(spec) {
  const elements = (spec.shape ?? []).reduce((a, b) => a * b, 1);
  return elements * bytesPerElement(spec);
}

/** `weights.bin` while it fits, numbered siblings once it does not. */
export function shardNames(count) {
  if (count === 1) return ['weights.bin'];
  return Array.from({ length: count }, (_, i) => `weights-${i + 1}of${count}.bin`);
}

/** Cut a merged blob into equal-sized pieces, each at most `limit` bytes. */
export function splitWeights(data, limit = SHARD_LIMIT) {
  const count = Math.max(1, Math.ceil(data.length / limit));
  const size = Math.ceil(data.length / count);
  return shardNames(count).map((name, i) => ({
    name,
    data: data.subarray(i * size, Math.min((i + 1) * size, data.length))
  }));
}

/**
 * Write `model.json` plus the shards of `data` into `dir`, dropping weight files
 * left over from an earlier split — a stale `weights.bin` next to a new pair of
 * shards would be dead weight in the deployment and a puzzle for the next reader.
 */
export async function writeModel(dir, topology, data, limit = SHARD_LIMIT) {
  const shards = splitWeights(data, limit);
  const keep = new Set(shards.map((s) => s.name));
  const stale = (await readdir(dir).catch(() => []))
    .filter((f) => f.endsWith('.bin') && !keep.has(f));
  for (const file of stale) await rm(join(dir, file));

  topology.weightsManifest = [{
    paths: shards.map((s) => s.name),
    weights: topology.weightsManifest.flatMap((g) => g.weights)
  }];
  await writeFile(join(dir, 'model.json'), JSON.stringify(topology));
  for (const shard of shards) await writeFile(join(dir, shard.name), shard.data);
  return shards;
}

/**
 * Read a model back as one buffer. The specs describe the byte length exactly, so
 * a mismatch means the files on disk and the manifest disagree — repacking that
 * would shift every tensor after the discrepancy, silently.
 */
export async function readModel(dir) {
  const topology = JSON.parse(await readFile(join(dir, 'model.json'), 'utf8'));
  const groups = topology.weightsManifest;
  const chunks = [];
  for (const group of groups) {
    for (const path of group.paths) chunks.push(await readFile(join(dir, path)));
  }
  const data = Buffer.concat(chunks);
  const expected = groups
    .flatMap((g) => g.weights)
    .reduce((n, w) => n + specByteLength(w), 0);
  if (data.length !== expected) {
    throw new Error(
      `${dir}: weight files are ${data.length} bytes but the specs describe ${expected} — ` +
      'resharding would corrupt the weights.'
    );
  }
  return { topology, data };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv.slice(2);
  const dirs = (await readdir(OUT_ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && (!only.length || only.includes(e.name)))
    .map((e) => e.name);
  const unknown = only.filter((d) => !dirs.includes(d));
  if (unknown.length) throw new Error(`Unbekannte Modelle: ${unknown.join(', ')}`);

  for (const dir of dirs) {
    const modelDir = join(OUT_ROOT, dir);
    const { topology, data } = await readModel(modelDir);
    const before = topology.weightsManifest.flatMap((g) => g.paths);
    const after = splitWeights(data).map((s) => s.name);
    const sizes = splitWeights(data)
      .map((s) => `${(s.data.length / 1048576).toFixed(1)} MB`)
      .join(' + ');
    // Rewriting a model that already has the right layout would only reformat its
    // model.json, which reads as a change in review that is not one.
    if (before.join() === after.join()) {
      console.log(`${dir.padEnd(30)} ${sizes.padStart(18)}  unverändert`);
      continue;
    }
    await writeModel(modelDir, topology, data);
    console.log(`${dir.padEnd(30)} ${sizes.padStart(18)}  ${before.length} -> ${after.length} Shards`);
  }
}
