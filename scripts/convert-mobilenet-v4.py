#!/usr/bin/env python3
"""
Converts MobileNet v4 feature extractors into the TensorFlow.js graph models we
ship in `static/models/`, mirroring what scripts/vendor-models.mjs does for the
other backbones.

Why a conversion instead of a download: MobileNet v4 (Qin et al., 2024) was never
published as a TensorFlow.js model. The weights live in timm (PyTorch), and the
only browser-ready exports are ONNX. So we take a pinned ONNX export, cut the
1000-class classifier off it to get the pooled feature vector, and run that
through onnx2tf -> tensorflowjs_converter.

The result is committed like every other vendored model, so this script is not part
of the build. Run it on Linux or WSL with the toolchain described in
`docs/mobilenet-v4-conversion.md`:

    python3 scripts/convert-mobilenet-v4.py                    # all variants
    python3 scripts/convert-mobilenet-v4.py mobilenet-v4-small # just one

Correctness is checked twice, because a silently wrong conversion would look like a
model that simply learns badly:
  1. onnx2tf's own elementwise comparison (-cotof) between the ONNX graph and the
     TensorFlow graph it produces.
  2. This script records what the cut ONNX graph outputs under onnxruntime for a
     set of fixed, formula-generated probe images into
     `scripts/fixtures/<dir>-reference.json`; scripts/verify-mobilenet-v4.mjs
     replays exactly those images against the shipped .js artifact.

Note the preprocessing: unlike the tfhub MobileNets, timm normalises with the
ImageNet mean/std, so these extractors use `preprocess: 'imagenet'` in
src/lib/machine.ts. The ONNX graph starts *after* that normalisation.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = ROOT / "static" / "models"
FIXTURE_DIR = ROOT / "scripts" / "fixtures"
MERGED_SHARD = "weights.bin"
PROBE_COUNT = 3

# Pinned to a commit so a rerun cannot silently pick up different weights.
VARIANTS = [
    {
        "dir": "mobilenet-v4-small",
        "repo": "onnx-community/mobilenetv4_conv_small.e2400_r224_in1k",
        "revision": "3ba07f12712fa58fd6b3d661f9909c9e332c5005",
        "input_size": 224,
        "features": 1280,
        "note": (
            "MobileNet v4 Conv Small, 224px — feature extractor. Converted from the "
            "pinned ONNX export of timm/mobilenetv4_conv_small.e2400_r224_in1k: "
            "classifier cut off at the pooled feature vector, then onnx2tf -> "
            "tensorflowjs_converter. Expects ImageNet mean/std normalised input."
        ),
    },
    {
        "dir": "mobilenet-v4-medium",
        "repo": "onnx-community/mobilenetv4_conv_medium.e500_r224_in1k",
        "revision": "dc8d9ef543f3c84172e9ec8c4ce50c7edab85224",
        "input_size": 224,
        "features": 1280,
        "note": (
            "MobileNet v4 Conv Medium, 224px — feature extractor. Converted from the "
            "pinned ONNX export of timm/mobilenetv4_conv_medium.e500_r224_in1k: "
            "classifier cut off at the pooled feature vector, then onnx2tf -> "
            "tensorflowjs_converter. Expects ImageNet mean/std normalised input."
        ),
    },
]


def tool(name: str) -> str:
    """
    Resolve a console script next to the interpreter that runs us. The script is meant
    to be called as `~/mnv4/venv/bin/python scripts/convert-mobilenet-v4.py`, where the
    venv is not on PATH, so onnx2tf and tensorflowjs_converter would not be found.
    """
    local = Path(sys.executable).parent / name
    return str(local) if local.exists() else name


def run(cmd: list[str]) -> None:
    print("  $", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True)


def download(url: str, dest: Path) -> None:
    print(f"  fetching {url}", flush=True)
    with urllib.request.urlopen(url) as res, dest.open("wb") as fh:
        shutil.copyfileobj(res, fh)


def classifier_input(model: onnx.ModelProto) -> str:
    """
    Name of the tensor feeding the 1000-class head — that is the embedding we want.

    The timm exports end in a Gemm (or MatMul) against the classifier weights, so we
    walk back from the graph output instead of hardcoding a node name, and refuse to
    guess when the tail does not look the way we expect.
    """
    producer = {out: node for node in model.graph.node for out in node.output}
    name = model.graph.output[0].name
    node = producer.get(name)
    while node is not None and node.op_type in {"Softmax", "Identity", "Reshape", "Squeeze"}:
        name = node.input[0]
        node = producer.get(name)
    if node is None or node.op_type not in {"Gemm", "MatMul"}:
        raise SystemExit(
            f"Expected a Gemm/MatMul classifier at the graph tail, found "
            f"{node.op_type if node else 'nothing'} — refusing to guess where the "
            f"feature vector is."
        )
    return node.input[0]


def probe_images(size: int) -> np.ndarray:
    """
    Fixed probe images as raw 0..255 uint8, [N, H, W, 3].

    Generated from a closed-form expression rather than an RNG so that
    scripts/verify-mobilenet-v4.mjs can rebuild the very same pixels in JavaScript
    and we only have to commit the embeddings, not the images. Smooth gradients with
    per-channel offsets give the network real structure to respond to.
    """
    axis = np.arange(size, dtype=np.float64) / (size - 1)
    y, x = np.meshgrid(axis, axis, indexing="ij")
    images = []
    for i in range(PROBE_COUNT):
        img = np.empty((size, size, 3), dtype=np.float64)
        for c in range(3):
            img[..., c] = (
                128
                + 90 * np.sin((i + 1) * 3.0 * x + c)
                * np.cos((i + 2) * 2.0 * y - c)
                + 25 * np.sin((i + 1) * 7.0 * (x + y) + 2 * c)
            )
        images.append(np.clip(np.rint(img), 0, 255))
    return np.asarray(images, dtype=np.uint8)


def normalise(images: np.ndarray) -> np.ndarray:
    """ImageNet mean/std normalisation in NCHW, matching the timm export's input."""
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    scaled = (images.astype(np.float32) / 255.0 - mean) / std
    return scaled.transpose(0, 3, 1, 2).astype(np.float32)


def merge_shards(model_dir: Path) -> int:
    """
    Concatenate the converter's shards into one weights.bin, as vendor-models.mjs does
    for the downloaded models — same reasoning (fewer requests), and the same check
    that a group's shards hold exactly its specs and nothing else, because a padded
    group would silently shift every later tensor.
    """
    manifest_path = model_dir / "model.json"
    topology = json.loads(manifest_path.read_text(encoding="utf8"))
    sizes = {"uint8": 1, "int8": 1, "bool": 1, "uint16": 2, "int16": 2, "float16": 2,
             "float32": 4, "int32": 4, "complex64": 8}

    chunks: list[bytes] = []
    weights: list[dict] = []
    shard_count = 0
    for group in topology["weightsManifest"]:
        shard_count += len(group["paths"])
        blob = b"".join((model_dir / p).read_bytes() for p in group["paths"])
        expected = 0
        for spec in group["weights"]:
            dtype = spec.get("quantization", {}).get("dtype", spec["dtype"])
            expected += int(np.prod(spec.get("shape", []))) * sizes[dtype]
        if len(blob) != expected:
            raise SystemExit(
                f"Weight group {group['paths']} is {len(blob)} bytes but its specs "
                f"describe {expected} — merging would corrupt the weights."
            )
        chunks.append(blob)
        weights.extend(group["weights"])

    for group in topology["weightsManifest"]:
        for path in group["paths"]:
            (model_dir / path).unlink()
    topology["weightsManifest"] = [{"paths": [MERGED_SHARD], "weights": weights}]
    manifest_path.write_text(json.dumps(topology), encoding="utf8")
    (model_dir / MERGED_SHARD).write_bytes(b"".join(chunks))
    return shard_count


def graph_output_name(model_dir: Path) -> str:
    """The node src/lib/machine.ts has to ask for, read back from the artifact itself."""
    topology = json.loads((model_dir / "model.json").read_text(encoding="utf8"))
    outputs = topology.get("signature", {}).get("outputs", {})
    if len(outputs) != 1:
        raise SystemExit(f"Expected exactly one output, got {list(outputs)}")
    return next(iter(outputs.values()))["name"].split(":")[0]


def convert(variant: dict, work: Path) -> dict:
    print(f"\n=== {variant['dir']}", flush=True)
    stage = work / variant["dir"]
    stage.mkdir(parents=True)

    url = f"https://huggingface.co/{variant['repo']}/resolve/{variant['revision']}/onnx/model.onnx"
    onnx_path = stage / "model.onnx"
    download(url, onnx_path)

    model = onnx.load(str(onnx_path))
    feature_tensor = classifier_input(model)
    input_name = model.graph.input[0].name
    print(f"  cutting at {feature_tensor} (input {input_name})", flush=True)
    features_path = stage / "features.onnx"
    onnx.utils.extract_model(str(onnx_path), str(features_path), [input_name], [feature_tensor])

    images = probe_images(variant["input_size"])
    session = ort.InferenceSession(str(features_path), providers=["CPUExecutionProvider"])
    reference = np.concatenate([
        session.run(None, {input_name: normalise(images[i:i + 1])})[0].reshape(1, -1)
        for i in range(len(images))
    ])
    if reference.shape[1] != variant["features"]:
        raise SystemExit(
            f"Expected {variant['features']} features, the cut graph yields {reference.shape[1]}"
        )
    print(f"  onnxruntime reference: {reference.shape}", flush=True)

    saved_model = stage / "saved_model"
    # -osd writes signature defs (tensorflowjs_converter needs a serving signature),
    # -cotof compares every tensor of the produced graph against the ONNX one.
    run([tool("onnx2tf"), "-i", features_path, "-o", saved_model, "-osd", "-cotof", "-n"])

    tfjs_out = stage / "tfjs"
    run([
        tool("tensorflowjs_converter"),
        "--input_format=tf_saved_model",
        "--output_format=tfjs_graph_model",
        "--saved_model_tags=serve",
        "--signature_name=serving_default",
        saved_model,
        tfjs_out,
    ])

    shards = merge_shards(tfjs_out)
    output_name = graph_output_name(tfjs_out)

    target = OUT_ROOT / variant["dir"]
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(tfjs_out, target)

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (FIXTURE_DIR / f"{variant['dir']}-reference.json").write_text(
        json.dumps({
            "note": "What the source ONNX graph outputs for the probe images that "
                    "scripts/verify-mobilenet-v4.mjs rebuilds. Written by "
                    "scripts/convert-mobilenet-v4.py.",
            "source": url,
            "inputSize": variant["input_size"],
            "outputName": output_name,
            "probeCount": PROBE_COUNT,
            "embeddings": [[round(v, 6) for v in row] for row in reference.tolist()],
        }, indent=1) + "\n",
        encoding="utf8",
    )

    weights = (target / MERGED_SHARD).read_bytes()
    model_json = (target / "model.json").read_bytes()
    print(
        f"  {(len(weights) + len(model_json)) / 1048576:.1f} MB, {shards} shards -> 1, "
        f"output '{output_name}'",
        flush=True,
    )
    return {
        "dir": variant["dir"],
        "note": variant["note"],
        "source": url,
        "retrieved": date.today().isoformat(),
        "shardsMerged": shards,
        "bytes": len(weights) + len(model_json),
        "sha256": hashlib.sha256(weights).hexdigest(),
        "conversion": "onnx.utils.extract_model -> onnx2tf -cotof -> tensorflowjs_converter "
                      "(scripts/convert-mobilenet-v4.py)",
        "preprocess": "ImageNet mean/std on 0..1 pixels",
    }


def write_provenance(entries: list[dict]) -> None:
    """
    Merge into the record vendor-models.mjs keeps: existing entries stay in place and
    keep their order, ours are updated or appended. That script leaves entries it does
    not know about alone, so the two tools can share one file.
    """
    path = OUT_ROOT / "PROVENANCE.json"
    models = json.loads(path.read_text(encoding="utf8"))["models"] if path.exists() else []
    new = {entry["dir"]: entry for entry in entries}
    merged = [new.pop(m["dir"], m) for m in models] + list(new.values())
    path.write_text(json.dumps({"models": merged}, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


def main() -> None:
    wanted = sys.argv[1:]
    unknown = [w for w in wanted if not any(v["dir"] == w for v in VARIANTS)]
    if unknown:
        raise SystemExit(f"Unknown variant(s): {', '.join(unknown)}")
    selected = [v for v in VARIANTS if not wanted or v["dir"] in wanted]

    with tempfile.TemporaryDirectory(prefix="mnv4-") as tmp:
        entries = [convert(v, Path(tmp)) for v in selected]
    write_provenance(entries)
    print("\nWrote:", ", ".join(e["dir"] for e in entries))
    print("Now verify the artifacts: node scripts/verify-mobilenet-v4.mjs")


if __name__ == "__main__":
    main()
