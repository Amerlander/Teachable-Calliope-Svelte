# MobileNet v4 selbst nach TensorFlow.js konvertieren

MobileNet v4 ist der einzige Backbone, den wir nicht herunterladen, sondern selbst
konvertieren. Grund: es gibt keine offizielle TensorFlow.js-Version. Die Gewichte
liegen in timm (PyTorch), browserfähig exportiert sind sie nur als ONNX. Alles andere
in `static/models/` kommt fertig von Google und wird nur von
`scripts/vendor-models.mjs` heruntergeladen und umgepackt.

Die Artefakte sind eingecheckt. Dieses Dokument braucht man nur, wenn eine Variante
neu oder zusätzlich konvertiert werden soll.

## Warum diese Kette

    HF-ONNX-Export (timm-Gewichte)
      → Klassifikator abschneiden        (onnx.utils.extract_model)
      → NCHW nach NHWC umschreiben       (onnx2tf, nicht das alte onnx-tf)
      → TensorFlow.js Graph Model        (tensorflowjs_converter)

`onnx2tf` statt `onnx-tf`, weil onnx-tf das NCHW-Layout beibehält und um jede
Convolution ein Transpose-Paar legt — im Browser kostet das mehr als das Modell selbst.
Abgeschnitten wird am Eingang des 1000-Klassen-Kopfes: wir brauchen den gepoolten
Merkmalsvektor (1280 Dimensionen), nicht die ImageNet-Logits.

Wichtig für `src/lib/machine.ts`: timm normalisiert mit ImageNet-mean/std, nicht mit
`x/255` wie die tfhub-Modelle. Deshalb hat der Extraktor `preprocess: 'imagenet'`. Der
konvertierte Graph beginnt *nach* dieser Normalisierung.

## Toolchain

Unter Linux oder WSL, nicht native Windows: `tensorflowjs` zieht
`tensorflow-decision-forests` mit, wofür es keine Windows-Wheels gibt. Python 3.10–3.12
(3.14 hat noch keine TensorFlow-Wheels).

```bash
python3 -m venv ~/mnv4/venv
~/mnv4/venv/bin/pip install -U pip wheel
~/mnv4/venv/bin/pip install -U onnx onnxruntime onnx-graphsurgeon sng4onnx \
    simple_onnx_processing_tools onnx2tf tensorflow tensorflowjs ai_edge_litert
```

Danach sind drei Reparaturen nötig, sonst startet keines der beiden Werkzeuge. Sie
gehören zusammen und sind alle Folge davon, dass `tensorflowjs` 4.22 und TensorFlow 2.19
auf unterschiedliche Protobuf- und setuptools-Generationen zeigen:

```bash
# 1) setuptools ab 81 liefert kein pkg_resources mehr, tensorflow_hub braucht es
~/mnv4/venv/bin/pip install "setuptools==80.9.0"

# 2) tensorflow-decision-forests bringt Protobuf-Gencode 6.31 mit, TensorFlow 2.19
#    läuft mit Runtime <6 — beides gleichzeitig geht nicht. tensorflowjs importiert
#    das Paket nur, damit Decision-Forest-Modelle ladbar sind, und benutzt es sonst
#    nicht, also raus damit und durch einen Stub ersetzen.
~/mnv4/venv/bin/pip uninstall -y tensorflow_decision_forests ydf
SP=~/mnv4/venv/lib/python3.10/site-packages
mkdir -p $SP/tensorflow_decision_forests
echo '__version__ = "0.0.0-stub"' > $SP/tensorflow_decision_forests/__init__.py

# 3) protobuf 6.31.1 (Runtime darf neuer als Gencode sein, umgekehrt nicht).
#    7.x fällt raus: dort fehlt MessageFactory.GetPrototype, das TensorFlow braucht.
~/mnv4/venv/bin/pip install "protobuf==6.31.1"
```

Prüfen, dass beide Werkzeuge starten:

```bash
~/mnv4/venv/bin/onnx2tf --help > /dev/null && echo onnx2tf ok
~/mnv4/venv/bin/tensorflowjs_converter --version
```

## Konvertieren

```bash
cd /mnt/c/GIT/calliope-stack/apps/web/Teachable-Calliope-Svelte
~/mnv4/venv/bin/python scripts/convert-mobilenet-v4.py               # alle Varianten
~/mnv4/venv/bin/python scripts/convert-mobilenet-v4.py mobilenet-v4-small
```

Das Skript pinnt jede Quelle auf einen HF-Commit, schneidet den Kopf ab, konvertiert,
führt die Shards zusammen (wie das Vendor-Skript), schreibt nach
`static/models/<variante>/` und ergänzt `static/models/PROVENANCE.json`.

Zusammengeführt wird nicht zwingend zu einer Datei: Cloudflare Pages lehnt Assets über
25 MiB beim Upload ab, und v4 Medium wiegt 32 MiB. Deshalb wird der Blob am Ende auf so
wenige Dateien wie möglich verteilt, jede höchstens `SHARD_LIMIT` groß — eine
`weights.bin`, solange es passt, sonst `weights-1of2.bin`, `weights-2of2.bin`. Für den
Loader ist das transparent. Bereits eingecheckte Modelle lassen sich ohne die
Konvertierungs-Toolchain nachträglich aufteilen:

```bash
node scripts/shard-weights.mjs                     # alle Modelle
node scripts/shard-weights.mjs mobilenet-v4-medium # nur eins
```

## Prüfen — nicht optional

Eine falsch konvertierte Kanalordnung oder Normalisierung lädt und rechnet weiter, nur
schlechter. Das fällt später als "das Training taugt nicht" auf und niemand sucht die
Ursache im Modell. Also zwei Prüfungen:

1. `onnx2tf -cotof` vergleicht während der Konvertierung jeden Tensor des erzeugten
   TensorFlow-Graphen elementweise mit dem ONNX-Graphen.
2. Das Skript legt die Embeddings, die der abgeschnittene ONNX-Graph unter onnxruntime
   für feste Testbilder liefert, in `scripts/fixtures/<variante>-reference.json` ab.
   Gegenprüfung gegen das tatsächlich ausgelieferte Artefakt:

```bash
node scripts/verify-mobilenet-v4.mjs
```

Die Testbilder stehen nicht im Repo, sondern werden auf beiden Seiten aus derselben
Formel gebaut — deshalb müssen nur die Embeddings eingecheckt werden. Erwartet wird
Kosinus-Ähnlichkeit ≥ 0,999 pro Bild. Fällt eine Probe darunter, gehört die Konvertierung
nicht ausgeliefert.

## Neue Variante hinzufügen

1. `VARIANTS` in `scripts/convert-mobilenet-v4.py` erweitern (Repo, Commit-SHA,
   Eingabegröße, erwartete Merkmalszahl).
2. Konvertieren und prüfen.
3. In `src/lib/machine.ts` einen `EXTRACTOR_CONFIGS`-Eintrag anlegen — `outputName` gibt
   das Konvertierungsskript aus, es liest ihn aus dem Artefakt.
4. `FeatureExtractor` und `SUPPORTED_FEATURE_EXTRACTORS` in `src/lib/stores/projects.ts`,
   `EXTRACTOR_LABELS` in `src/lib/modelInsights.ts`, `<option>` in `ModelTab.svelte`.
5. `static/models/NOTICE` ergänzen.

Hybrid-Varianten (`mobilenetv4_hybrid_*`) sind bewusst nicht dabei: sie enthalten
Mobile-MQA-Attention, die durch die Kette deutlich unzuverlässiger läuft als die reinen
Convolution-Varianten.
