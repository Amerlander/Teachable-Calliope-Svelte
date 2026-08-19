/**
 * What the details modal says about a model, and where every sentence comes
 * from.
 *
 * Two kinds of text meet in that dialog and they are kept apart on purpose:
 *
 *  - `INFO_TEXTS` are definitions. One sentence per label, no reference to any
 *    result, shown behind the "?" next to the label they belong to.
 *  - the findings below refer to *this* run: they are fixed German sentences
 *    with the model's own numbers put in. Nothing is written at runtime, a
 *    condition only decides which sentence appears.
 *
 * A finding carries the pane it belongs to, so the right column can show the
 * class findings on the classes pane and the curve findings on the history
 * pane, while the overview shows the highest-priority ones of all panes.
 */

import type { TrainedModel, TrainingHistory } from '$lib/stores/projects';
import { roiSizeLabel } from '$lib/roi';

// ---------------------------------------------------------------- formatting

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '–';
  return (n * 100).toFixed(digits).replace('.', ',') + ' %';
}

export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  return n.toLocaleString('de-DE');
}

export function dec(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '–';
  return n.toFixed(digits).replace('.', ',');
}

export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2).replace('.', ',')} ${units[i]}`;
}

/** "jedes vierte Bild" reads better than "jedes 4. Bild" for small numbers. */
const ORDINALS = ['', 'erste', 'zweite', 'dritte', 'vierte', 'fünfte', 'sechste', 'siebte', 'achte', 'neunte', 'zehnte'];
function everyNth(errorRate: number): string {
  if (!(errorRate > 0)) return '–';
  const n = Math.max(2, Math.round(1 / errorRate));
  return n <= 10 ? ORDINALS[n] : `${n}.`;
}

export const EXTRACTOR_LABELS: Record<string, string> = {
  'mobilenet-v1': 'MobileNet v1 (α=1.0)',
  'mobilenet-v2': 'MobileNet v2 (α=1.0)',
  'mobilenet-v3-small': 'MobileNet v3 Small (α=1.0)',
  'mobilenet-v3-large': 'MobileNet v3 Large (α=1.0)',
  'mobilenet-v4-small': 'MobileNet v4 Conv Small',
  'mobilenet-v4-medium': 'MobileNet v4 Conv Medium',
  'mobilenet-v1-lite': 'MobileNet v1 Lite (α=0.5)'
};

export const OPTIMIZER_LABELS: Record<string, string> = {
  adam: 'Adam',
  sgd: 'SGD',
  rmsprop: 'RMSProp'
};

// ------------------------------------------------------------------ the facts

export type ClassFact = {
  name: string;
  count: number;
  share: number;
  /** From the confusion matrix, absent until it has been computed. */
  recall?: number;
  precision?: number;
  errors?: number;
  confusedWith?: { name: string; count: number }[];
};

export type ConfusionPair = {
  trueClass: string;
  predictedClass: string;
  count: number;
  /** How often it happens the other way round. */
  reverse: number;
};

export type ModelFacts = {
  imported: boolean;
  accuracy: number | null;
  loss: number | null;
  firstLoss: number | null;
  /** Only set when the run held images back — see TrainingHistory.valAccuracy. */
  valAccuracy: number | null;
  valLoss: number | null;
  hasValidation: boolean;
  epochsRun: number;
  epochsConfigured: number;
  earlyStopped: boolean;
  classes: ClassFact[];
  totalExamples: number;
  /** Samples the run actually trained on, augmented copies included. */
  effectiveExamples: number;
  /** Images held back for checking, 0 when the run had none. */
  validationExamples: number;
  /** True when the counts come off the model instead of being estimated. */
  countsExact: boolean;
  min: ClassFact | null;
  max: ClassFact | null;
  below30: number;
  /** First epoch from which the accuracy no longer gained a full point. */
  plateauEpoch: number | null;
  /** Set when the loss climbed again in the last third of the run. */
  lossRise: { fromEpoch: number; low: number; end: number } | null;
  valGap: number | null;
  params: number | null;
  sizeBytes: number | null;
  layers: number | null;
  topPair: ConfusionPair | null;
};

function lastOf(arr: number[] | undefined): number | null {
  if (!arr || !arr.length) return null;
  const v = arr[arr.length - 1];
  return Number.isFinite(v) ? v : null;
}

/**
 * The epoch from which the run stopped gaining: the earliest epoch whose
 * accuracy is already within one point of the final one. Only reported for runs
 * long enough for the statement to mean anything, and only when the flat tail
 * is at least a third of the run.
 */
function findPlateau(history: TrainingHistory): number | null {
  const acc = history.accuracy;
  if (acc.length < 8) return null;
  const final = acc[acc.length - 1];
  for (let i = 0; i < acc.length; i++) {
    if (final - acc[i] < 0.01) {
      const tail = acc.length - i;
      return tail >= acc.length / 3 ? history.epochs[i] : null;
    }
  }
  return null;
}

/** A loss that climbs again towards the end is the clearest overfitting sign. */
function findLossRise(history: TrainingHistory): ModelFacts['lossRise'] {
  const loss = history.loss;
  if (loss.length < 6) return null;
  const start = Math.floor((loss.length * 2) / 3);
  let lowIdx = start;
  for (let i = start; i < loss.length; i++) if (loss[i] < loss[lowIdx]) lowIdx = i;
  const end = loss[loss.length - 1];
  if (lowIdx === loss.length - 1 || end <= loss[lowIdx] * 1.1) return null;
  return { fromEpoch: history.epochs[lowIdx], low: loss[lowIdx], end };
}

function findTopPair(classes: string[], matrix: number[][] | null): ConfusionPair | null {
  if (!matrix || !matrix.length) return null;
  let best: ConfusionPair | null = null;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i === j) continue;
      const count = matrix[i][j];
      if (count < 2) continue;
      if (!best || count > best.count) {
        best = {
          trueClass: classes[i],
          predictedClass: classes[j],
          count,
          reverse: matrix[j]?.[i] ?? 0
        };
      }
    }
  }
  return best;
}

export function modelFacts(model: TrainedModel, matrix: number[][] | null = null): ModelFacts {
  const history = model.history;
  const opts = model.options;
  const imported = model.source === 'imported';

  const counts = model.classes.map((name) => ({
    name,
    count: model.exampleCounts?.[name] ?? 0
  }));
  const total = counts.reduce((a, c) => a + c.count, 0);
  const classes: ClassFact[] = counts.map((c) => ({
    ...c,
    share: total > 0 ? c.count / total : 0
  }));

  if (matrix && matrix.length === classes.length) {
    // Column sums are what the model predicted, row sums what was actually there.
    const colTotals = classes.map((_, j) => matrix.reduce((a, row) => a + (row[j] ?? 0), 0));
    classes.forEach((c, i) => {
      const row = matrix[i] ?? [];
      const rowTotal = row.reduce((a, b) => a + b, 0);
      c.recall = rowTotal > 0 ? (row[i] ?? 0) / rowTotal : undefined;
      c.precision = colTotals[i] > 0 ? (row[i] ?? 0) / colTotals[i] : undefined;
      c.errors = rowTotal - (row[i] ?? 0);
      c.confusedWith = row
        .map((n, j) => ({ name: classes[j].name, count: n }))
        .filter((e, j) => j !== i && e.count > 0)
        .sort((a, b) => b.count - a.count);
    });
  }

  const sorted = [...classes].sort((a, b) => a.count - b.count);
  const accuracy = lastOf(history.accuracy);
  const valAccuracy = lastOf(history.valAccuracy);
  const multiplier = opts?.augmentation ? Math.max(0, Math.floor(opts.augmentationSettings?.multiplier ?? 0)) : 0;

  // Older runs did not record their sample counts, so they fall back to the
  // estimate they were shown with before: images times augmented copies.
  const recorded = model.sampleCounts;

  return {
    imported,
    accuracy,
    loss: lastOf(history.loss),
    firstLoss: history.loss.length ? history.loss[0] : null,
    valAccuracy,
    valLoss: lastOf(history.valLoss),
    hasValidation: !imported && (opts?.validationSplit ?? 0) > 0 && valAccuracy != null,
    epochsRun: history.epochs.length,
    epochsConfigured: opts?.epochs ?? 0,
    earlyStopped:
      !imported && history.epochs.length > 0 && history.epochs.length < (opts?.epochs ?? 0),
    classes,
    totalExamples: total,
    effectiveExamples: recorded?.train ?? total * (1 + multiplier),
    validationExamples: recorded?.validation ?? 0,
    countsExact: !!recorded,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    below30: classes.filter((c) => c.count > 0 && c.count < 30).length,
    plateauEpoch: imported ? null : findPlateau(history),
    lossRise: imported ? null : findLossRise(history),
    valGap: accuracy != null && valAccuracy != null ? accuracy - valAccuracy : null,
    params: model.metadata?.params ?? null,
    sizeBytes: model.metadata?.sizeBytes ?? null,
    layers: model.metadata?.layers ?? null,
    topPair: findTopPair(model.classes, matrix)
  };
}

// --------------------------------------------------------------- the findings

export type FindingPane = 'classes' | 'settings' | 'history' | 'architecture' | 'confusion';

export type Finding = {
  id: string;
  head: string;
  body: string;
  pane: FindingPane;
};

/** One per model, first matching rule wins. */
export function verdictFor(model: TrainedModel, f: ModelFacts): Finding | null {
  if (f.imported) {
    return {
      id: 'fazit.importiert',
      pane: 'history',
      head: 'Importiertes Modell',
      body: 'Trainingsverlauf und Beispielzahlen sind nicht mitgekommen. Beurteilen lässt es sich hier nur im Test.'
    };
  }
  if (f.accuracy == null) return null;
  if (f.accuracy >= 0.9995) {
    return {
      id: 'fazit.perfekt',
      pane: 'history',
      head: '100 % ist ein Warnzeichen',
      body: 'Ein Modell erreicht das meist nur, wenn die Klassen sehr verschieden aussehen oder wenn zu wenige Bilder da sind. Teste es im Video mit Bildern, die es noch nicht kennt.'
    };
  }
  if (f.accuracy >= 0.9 && f.hasValidation) {
    return {
      id: 'fazit.stark',
      pane: 'history',
      head: 'Solide trainiert',
      body: `${pct(f.accuracy)} auf den Trainingsbildern, ${pct(f.valAccuracy)} auf den zurückgehaltenen. Die beiden Werte liegen dicht beieinander. Das spricht dafür, dass das Modell auch bei neuen Bildern trägt.`
    };
  }
  if (f.accuracy >= 0.9) {
    return {
      id: 'fazit.starkOhneVal',
      pane: 'history',
      head: 'Sieht gut aus, ist aber ungeprüft',
      body: `Die ${pct(f.accuracy)} gelten nur für die Bilder, die du selbst aufgenommen hast.`
    };
  }
  if (f.accuracy >= 0.8) {
    return {
      id: 'fazit.mittel',
      pane: 'history',
      head: 'Brauchbar, aber wackelig',
      body: `Bei ${pct(f.accuracy)} liegt etwa jedes ${everyNth(1 - f.accuracy)} Bild falsch.`
    };
  }
  return {
    id: 'fazit.schwach',
    pane: 'history',
    head: 'Noch zu unsicher',
    body: `Mit ${pct(f.accuracy)} liegt etwa jedes ${everyNth(1 - f.accuracy)} Bild falsch, und zwar schon auf den Bildern, mit denen das Modell trainiert wurde.`
  };
}

/**
 * Every rule that applies, most important first. The overview shows the first
 * few, each pane shows the ones that belong to it.
 */
export function tipsFor(model: TrainedModel, f: ModelFacts): Finding[] {
  const out: Finding[] = [];
  if (f.imported) return out;

  if (f.min && f.below30 > 0) {
    out.push({
      id: 'tipp.zuWenigeBilder',
      pane: 'classes',
      head: 'Zu wenige Bilder',
      body: `${f.below30 === f.classes.length && f.classes.length > 1 ? `Alle ${f.classes.length} Klassen liegen` : f.below30 === 1 ? 'Eine Klasse liegt' : `${f.below30} Klassen liegen`} unter 30 Bildern, „${f.min.name}“ hat nur ${f.min.count}. Das ist die wahrscheinlichste Ursache für Fehler.`
    });
  }

  if (f.min && f.max && f.max.count > 0 && f.min.count / f.max.count < 0.7) {
    out.push({
      id: 'tipp.unbalanciert',
      pane: 'classes',
      head: `„${f.min.name}“ hat am wenigsten Bilder`,
      body: `${f.min.count} gegenüber ${f.max.count} bei „${f.max.name}“. Klassen mit deutlich weniger Bildern erkennt das Modell meist schlechter.`
    });
  }

  if (f.lossRise) {
    out.push({
      id: 'tipp.lossSteigt',
      pane: 'history',
      head: 'Der Verlust steigt wieder',
      body: `Ab Epoche ${f.lossRise.fromEpoch} klettert er von ${dec(f.lossRise.low)} auf ${dec(f.lossRise.end)}. Das Modell fängt an, sich Bilder zu merken. ${f.lossRise.fromEpoch} Epochen hätten gereicht.`
    });
  }

  if ((model.options?.validationSplit ?? 0) === 0) {
    out.push({
      id: 'tipp.keineValidierung',
      pane: 'settings',
      head: 'Keine Validierung eingestellt',
      body: 'Ohne zurückgehaltene Bilder lässt sich die Genauigkeit nicht gegenprüfen. 15 % sind ein guter Startwert.'
    });
  } else if (f.valGap != null && f.valGap > 0.1) {
    out.push({
      id: 'tipp.valWeichtAb',
      pane: 'history',
      head: 'Große Lücke zur Validierung',
      body: `${pct(f.accuracy)} im Training, aber nur ${pct(f.valAccuracy)} auf zurückgehaltenen Bildern. Das Modell hat auswendig gelernt.`
    });
  }

  if (f.topPair) {
    out.push({
      id: 'tipp.verwechslung',
      pane: 'confusion',
      head: 'Häufigste Verwechslung',
      body: `„${f.topPair.trueClass}“ wurde ${f.topPair.count} × für „${f.topPair.predictedClass}“ gehalten.${
        f.topPair.reverse > 0
          ? ` In die andere Richtung passiert es ${f.topPair.reverse} ×.`
          : ' In die andere Richtung passiert es nicht.'
      }`
    });
  }

  if (!model.options?.augmentation && f.totalExamples > 0 && f.totalExamples < 100) {
    out.push({
      id: 'tipp.augmentierungAus',
      pane: 'settings',
      head: 'Augmentierung ist aus',
      body: `Bei ${f.totalExamples} Bildern hilft sie meist deutlich, weil sie aus jedem Bild gespiegelte, gedrehte, hellere und leicht gezoomte Varianten macht.`
    });
  } else if (model.options?.augmentation && f.effectiveExamples > f.totalExamples) {
    out.push({
      id: 'tipp.augmentierungAn',
      pane: 'settings',
      head: 'Augmentierung hat sich gelohnt',
      body: f.validationExamples
        ? `Aus ${f.totalExamples - f.validationExamples} Trainingsbildern wurden ${f.effectiveExamples} Beispiele. ${f.validationExamples} Bilder sind zum Prüfen zurückgehalten.`
        : `Aus ${f.totalExamples} Bildern wurden ${f.effectiveExamples} Trainingsbeispiele.`
    });
  }

  if (f.plateauEpoch != null && f.epochsRun - f.plateauEpoch >= 3) {
    out.push({
      id: 'tipp.plateau',
      pane: 'history',
      head: `Ab Epoche ${f.plateauEpoch} kaum noch Fortschritt`,
      body: `Die letzten ${f.epochsRun - f.plateauEpoch} Epochen haben weniger als einen Prozentpunkt gebracht. Weniger Epochen hätten hier gereicht.`
    });
  }

  if (f.earlyStopped) {
    out.push({
      id: 'tipp.frueherStop',
      pane: 'history',
      head: 'Früher gestoppt',
      body: `Das Training endete nach ${f.epochsRun} von ${f.epochsConfigured} Epochen, weil der Stop-Loss von ${dec(model.options?.earlyStopLoss, 3)} erreicht war.`
    });
  }

  if (f.classes.length === 2 && !hasNothingClass(f.classes)) {
    out.push({
      id: 'tipp.zweiKlassen',
      pane: 'classes',
      head: 'Nur zwei Klassen',
      body: 'Das Modell muss sich immer für eine davon entscheiden. Eine Klasse für „nichts davon“ macht es im Einsatz brauchbarer.'
    });
  }

  // Only the unusual case is worth a line. A head of the normal size says nothing
  // the Steckbrief does not already show, and the extractors are prebuilt and
  // small anyway. The model runs in the browser; the Calliope only receives the
  // detected class over serial, so size matters for storing and exporting.
  if (f.sizeBytes != null && f.sizeBytes > 2 * 1024 * 1024) {
    out.push({
      id: 'tipp.grossesModell',
      pane: 'architecture',
      head: 'Recht groß',
      body: `${bytes(f.sizeBytes)} bei ${num(model.options?.hiddenUnits)} Hidden Units. Das fällt beim Speichern im Projekt und beim Export ins Gewicht. Weniger Hidden Units machen das Modell kleiner.`
    });
  }

  return out;
}

function hasNothingClass(classes: ClassFact[]): boolean {
  return classes.some((c) => /nichts|leer|hintergrund|nothing|none/i.test(c.name));
}

/** Derived from the top tip, so the advice never contradicts the findings. */
export function nextStepFor(tips: Finding[], f: ModelFacts): Finding | null {
  const top = tips[0];
  const step = (body: string): Finding => ({
    id: 'schritt',
    pane: top?.pane ?? 'history',
    head: 'Nächster Schritt',
    body
  });
  if (!top) {
    return step(
      'Teste das Modell im Video bei anderem Licht und mit anderem Hintergrund. Dort zeigt sich, ob es trägt.'
    );
  }
  switch (top.id) {
    case 'tipp.zuWenigeBilder':
      return step(
        `Auf mindestens 30 Bilder pro Klasse kommen. Bei „${f.min?.name}“ fehlen ${Math.max(0, 30 - (f.min?.count ?? 0))}. Danach neu trainieren.`
      );
    case 'tipp.unbalanciert':
      return step(
        `${Math.max(5, Math.round(((f.max?.count ?? 0) - (f.min?.count ?? 0)) / 5) * 5)} weitere Bilder von „${f.min?.name}“ aufnehmen, in anderer Position und bei anderem Licht, dann neu trainieren.`
      );
    case 'tipp.lossSteigt':
      return step(
        `Epochen auf ${f.lossRise?.fromEpoch} senken oder mehr Bilder aufnehmen, dann neu trainieren.`
      );
    case 'tipp.keineValidierung':
      return step(
        'Validierung auf 15 % stellen und neu trainieren. Dann steht neben der Trainings-Genauigkeit eine geprüfte Zahl.'
      );
    case 'tipp.valWeichtAb':
      return step(
        'Mehr und vielfältigere Bilder aufnehmen, dann neu trainieren. Die Lücke schließt sich nicht über die Einstellungen.'
      );
    case 'tipp.verwechslung':
      return step(
        `Bilder aufnehmen, auf denen „${f.topPair?.trueClass}“ und „${f.topPair?.predictedClass}“ klar zu unterscheiden sind, dann neu trainieren.`
      );
    case 'tipp.augmentierungAus':
      return step('Augmentierung anschalten und neu trainieren. Die Bilder von Hand zu vervielfachen bringt nichts.');
    case 'tipp.plateau':
      return step(`Epochen auf ${f.plateauEpoch} senken. Das Ergebnis bleibt gleich, das Training ist schneller durch.`);
    default:
      return null;
  }
}

export type ModelInsights = {
  facts: ModelFacts;
  verdict: Finding | null;
  tips: Finding[];
  nextStep: Finding | null;
};

export function modelInsights(
  model: TrainedModel,
  matrix: number[][] | null = null
): ModelInsights {
  const facts = modelFacts(model, matrix);
  const tips = tipsFor(model, facts);
  return {
    facts,
    verdict: verdictFor(model, facts),
    tips,
    nextStep: nextStepFor(tips, facts)
  };
}

// ------------------------------------------------------------- the architecture

export type LayerRow = {
  index: number;
  name: string;
  shape: string;
  params: number | null;
  /** MobileNet is not part of the saved model, it is loaded next to it. */
  frozen?: boolean;
  note?: string;
};

type TopologyLayer = {
  class_name?: string;
  config?: {
    units?: number;
    activation?: string;
    rate?: number;
    batch_input_shape?: (number | null)[];
  };
};

/**
 * The classifier's layers, read out of the saved topology rather than
 * reconstructed from the options: an imported model has no trustworthy options,
 * but it does carry its topology.
 */
export function describeLayers(model: TrainedModel): LayerRow[] {
  const topology = model.artifacts?.topology as
    | { config?: { layers?: TopologyLayer[] } }
    | undefined;
  const layers = topology?.config?.layers ?? [];
  const rows: LayerRow[] = [];
  let index = 1;
  let inputUnits: number | null = null;

  for (const layer of layers) {
    const cfg = layer.config ?? {};
    if (inputUnits == null && Array.isArray(cfg.batch_input_shape)) {
      const last = cfg.batch_input_shape[cfg.batch_input_shape.length - 1];
      inputUnits = typeof last === 'number' ? last : null;
      if (inputUnits != null) {
        rows.push({
          index: index++,
          name: model.mode === 'pose' ? 'Gezeichnetes Skelett' : 'Kamerabild',
          shape: '224 × 224 Pixel',
          params: null
        });
        rows.push({
          index: index++,
          name: EXTRACTOR_LABELS[model.featureExtractor ?? 'mobilenet-v1'] ?? 'MobileNet',
          shape: `→ ${inputUnits} Merkmale`,
          params: null,
          frozen: true,
          note: 'wird geladen, nicht mittrainiert'
        });
      }
    }
    if (layer.class_name === 'Dense') {
      const units = cfg.units ?? 0;
      const from = inputUnits ?? 0;
      rows.push({
        index: index++,
        name: cfg.activation === 'softmax' ? 'Dense, Softmax' : `Dense, ${cfg.activation ?? 'linear'}`,
        shape: `${from} → ${units}`,
        params: from > 0 ? from * units + units : null
      });
      inputUnits = units;
    } else if (layer.class_name === 'Dropout') {
      rows.push({
        index: index++,
        name: 'Dropout',
        shape: `${Math.round((cfg.rate ?? 0) * 100)} % aus`,
        params: 0
      });
    }
  }

  if (rows.length) {
    rows.push({
      index: index++,
      name: 'Ausgabe',
      shape: `${model.classes.length} ${model.classes.length === 1 ? 'Wert' : 'Werte'}, Summe 1`,
      params: null
    });
  }
  return rows;
}

/** The weight dtype as it was saved, for the raw-data pane. */
export function weightDtype(model: TrainedModel): string {
  const specs = model.artifacts?.weightSpecs as { dtype?: string }[] | undefined;
  return specs?.[0]?.dtype ?? '–';
}

export function roiLabel(model: TrainedModel): string {
  if (model.mode === 'pose') return 'Ganzes Bild';
  return model.roi ? roiSizeLabel(model.roi) : 'Ganzes Bild';
}

// --------------------------------------------------------------- info texts

/**
 * One sentence per label, shown behind the "?" next to it. These never mention
 * a result — the findings do that.
 */
export const INFO_TEXTS: Record<string, { title: string; text: string }> = {
  accuracy: {
    title: 'Genauigkeit',
    text: 'Anteil der Trainingsbilder, die das Modell richtig erkennt. Über neue Bilder sagt der Wert nichts.'
  },
  loss: {
    title: 'Verlust',
    text: 'Abstand zwischen Vorhersage und richtiger Antwort. Im Training soll er fallen.'
  },
  classes: {
    title: 'Klassen',
    text: 'Die Dinge, die dieses Modell unterscheiden kann. Sie stehen mit dem Training fest.'
  },
  examples: {
    title: 'Beispiele',
    text: 'Alle aufgenommenen Bilder. Mehr und vielfältigere Bilder helfen meist mehr als geänderte Einstellungen.'
  },
  epochs: {
    title: 'Epochen',
    text: 'Ein Durchlauf durch alle Bilder ist eine Epoche.'
  },
  learningRate: {
    title: 'Lernrate',
    text: 'Schrittweite pro Anpassung. Zu groß schwingt über, zu klein lernt kaum.'
  },
  batchSize: {
    title: 'Batch-Größe',
    text: 'Wie viele Bilder pro Lernschritt gleichzeitig durchs Modell laufen.'
  },
  hiddenUnits: {
    title: 'Hidden Units',
    text: 'Neuronen der versteckten Schicht. Mehr Kapazität braucht mehr Bilder.'
  },
  augmentation: {
    title: 'Augmentierung',
    text: 'Erzeugt aus jedem Bild gespiegelte, gedrehte, hellere und leicht gezoomte Varianten.'
  },
  validationSplit: {
    title: 'Validierung',
    text: 'Anteil der Bilder, die vom Training zurückgehalten und nur zum Prüfen benutzt werden.'
  },
  dropout: {
    title: 'Dropout',
    text: 'Anteil der Neuronen, die beim Training zufällig ausgeschaltet werden.'
  },
  earlyStopLoss: {
    title: 'Stop-Loss',
    text: 'Das Training endet früher, sobald der Verlust unter diesen Wert fällt.'
  },
  optimizer: {
    title: 'Optimierer',
    text: 'Verfahren, das die Gewichte anpasst. Adam passt für die meisten Fälle.'
  },
  featureExtractor: {
    title: 'Feature-Extraktor',
    text: 'Vortrainiertes Netz, das jedes Bild in einen Merkmalsvektor umwandelt.'
  },
  roi: {
    title: 'Bildbereich',
    text: 'Ausschnitt des Kamerabildes, mit dem trainiert wurde. Beim Testen gilt derselbe.'
  },
  layers: {
    title: 'Schichten',
    text: 'Zahl der Ebenen im trainierten Klassifikator.'
  },
  params: {
    title: 'Trainierte Parameter',
    text: 'Einstellbare Werte im Netz. Trainiert werden nur die des kleinen Klassifikators.'
  },
  sizeBytes: {
    title: 'Modellgröße',
    text: 'Speicherbedarf der Gewichte, geschätzt aus der Zahl der Parameter.'
  },
  valAccuracy: {
    title: 'Geprüfte Genauigkeit',
    text: 'Genauigkeit auf den Bildern, die vom Training zurückgehalten wurden.'
  },
  recall: {
    title: 'Erkannt',
    text: 'Wie viele Bilder dieser Klasse das Modell gefunden hat.'
  },
  precision: {
    title: 'Treffgenauigkeit',
    text: 'Wie oft die Klasse stimmte, wenn das Modell sie vorhergesagt hat.'
  },
  smoothing: {
    title: 'Glättung',
    text: 'Median über die letzten Vorhersagen. Wirkt beim Testen und beim Streamen, nicht im Training.'
  }
};
