<script lang="ts">
  import { modelMetadata, trainingHistory, examples } from '$lib/stores';
  import { currentProject, type TrainedModel } from '$lib/stores/projects';
  import InfoTooltip from '$lib/components/ui/InfoTooltip.svelte';

  // With `model` given, every number comes from that training run's snapshot —
  // the classes, images and options it was actually trained with, which is not
  // the same as what the project holds now. Without it we fall back to the live
  // project for the figures we can still trust; the hyper-parameters of an
  // imported model are unknown and stay blank rather than borrowing the
  // project's current settings.
  let { model = null }: { model?: TrainedModel | null } = $props();

  function formatNumber(n: number | undefined) {
    if (n == null) return '–';
    return n.toLocaleString('de-DE');
  }

  function formatBytes(bytes: number | undefined) {
    if (bytes == null) return '–';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  const EXTRACTOR_LABELS: Record<string, string> = {
    'mobilenet-v1': 'MobileNet v1',
    'mobilenet-v2': 'MobileNet v2',
    'mobilenet-v1-lite': 'MobileNet v1 Lite'
  };
  const OPTIMIZER_LABELS: Record<string, string> = {
    adam: 'Adam',
    sgd: 'SGD',
    rmsprop: 'RMSProp'
  };

  const isPose = $derived($currentProject?.mode === 'pose');
  const history = $derived(model?.history ?? $trainingHistory);
  const meta = $derived(model?.metadata ?? $modelMetadata);
  const opts = $derived(model?.options ?? null);
  const totalExamples = $derived(
    model
      ? Object.values(model.exampleCounts ?? {}).reduce((acc, n) => acc + n, 0)
      : Object.values($examples).reduce((acc, arr) => acc + (arr?.length || 0), 0)
  );
  const finalAccuracy = $derived(
    history.accuracy.length
      ? (history.accuracy[history.accuracy.length - 1] * 100).toFixed(1) + ' %'
      : '–'
  );
  const finalLoss = $derived(
    history.loss.length ? history.loss[history.loss.length - 1].toFixed(4) : '–'
  );
  // Early stopping can end a run before the configured epoch count, so show
  // both numbers whenever they disagree.
  const epochsLabel = $derived.by(() => {
    const run = history.epochs.length;
    if (!run) return '–';
    return opts && opts.epochs !== run ? `${run} / ${opts.epochs}` : String(run);
  });
  const roiLabel = $derived(
    model?.roi
      ? `${Math.round(model.roi.w * 100)}×${Math.round(model.roi.h * 100)} %`
      : model
        ? 'Ganzes Bild'
        : '–'
  );
  const extractorLabel = $derived.by(() => {
    const key = model?.featureExtractor ?? opts?.featureExtractor;
    if (!key) return '–';
    return EXTRACTOR_LABELS[key] ?? key;
  });
  const trainedOn = $derived.by(() => {
    if (model) return new Date(model.trainedAt).toLocaleString('de-DE');
    return meta.date ? new Date(meta.date).toLocaleString('de-DE') : '–';
  });
</script>

<div class="stats-grid">
  <div class="stat">
    <div class="label">
      Genauigkeit
      <InfoTooltip
        title="Genauigkeit"
        text="Anteil der Trainingsbilder, die das Modell nach dem Training richtig erkennt. 100 % heißt: alle Trainingsbilder korrekt klassifiziert — das bedeutet nicht automatisch, dass es mit neuen Bildern auch so gut funktioniert."
      />
    </div>
    <div class="value highlight">{finalAccuracy}</div>
  </div>

  <div class="stat">
    <div class="label">
      Verlust
      <InfoTooltip
        title="Verlust (Loss)"
        text="Misst, wie weit die Vorhersagen des Modells von der richtigen Antwort entfernt sind. Sollte im Verlauf des Trainings fallen — steigt er wieder, ist das Modell möglicherweise überangepasst."
      />
    </div>
    <div class="value">{finalLoss}</div>
  </div>

  <div class="stat">
    <div class="label">
      Beispiele
      <InfoTooltip
        title="Trainingsbeispiele"
        text="Gesamtzahl der aufgenommenen Bilder über alle Klassen. Je mehr und vielfältiger, desto robuster wird das Modell. Faustregel: mindestens 30 Bilder pro Klasse, in verschiedenen Positionen und bei unterschiedlichem Licht."
      />
    </div>
    <div class="value">{totalExamples}</div>
  </div>

  <div class="stat">
    <div class="label">
      Epochen
      <InfoTooltip
        title="Epochen"
        text="Wie oft das Modell während des Trainings durch alle Beispiele gelaufen ist. Mehr Epochen = mehr Lernzeit, aber bei zu vielen kann Überanpassung entstehen (Modell merkt sich Bilder statt Muster)."
      />
    </div>
    <div class="value">{epochsLabel}</div>
  </div>

  <div class="stat">
    <div class="label">
      Lernrate
      <InfoTooltip
        title="Lernrate"
        text="Schrittweite pro Anpassung der Gewichte. Zu groß = das Training schwingt über, zu klein = es lernt kaum. 0.001 ist der Standardwert."
      />
    </div>
    <div class="value">{opts ? opts.learningRate : '–'}</div>
  </div>

  <div class="stat">
    <div class="label">
      Hidden Units
      <InfoTooltip
        title="Hidden Units"
        text="Anzahl der Neuronen in der versteckten Schicht. Mehr = komplexere Muster lernbar, aber es braucht auch mehr Bilder, um nicht überanzupassen."
      />
    </div>
    <div class="value">{opts ? opts.hiddenUnits : '–'}</div>
  </div>

  <div class="stat">
    <div class="label">
      Batch-Größe
      <InfoTooltip
        title="Batch-Größe"
        text="Wie viele Beispiele pro Lernschritt gleichzeitig durchs Modell laufen. Kleiner = rauschiger, aber oft besser für kleine Datensätze."
      />
    </div>
    <div class="value">{opts ? opts.batchSize : '–'}</div>
  </div>

  <div class="stat">
    <div class="label">
      Optimierer
      <InfoTooltip
        title="Optimierer"
        text="Algorithmus, der die Gewichte anpasst. Adam passt für die meisten Fälle, SGD ist robuster für große Datensätze, RMSProp für rauschige."
      />
    </div>
    <div class="value small">{opts ? (OPTIMIZER_LABELS[opts.optimizer] ?? opts.optimizer) : '–'}</div>
  </div>

  <div class="stat">
    <div class="label">
      Dropout
      <InfoTooltip
        title="Dropout"
        text="Anteil der Neuronen, die beim Training zufällig deaktiviert werden. Reduziert Überanpassung. 0 = aus, 0.5 = aggressiv."
      />
    </div>
    <div class="value">{opts ? (opts.dropout ? opts.dropout : 'aus') : '–'}</div>
  </div>

  <div class="stat">
    <div class="label">
      Validierung
      <InfoTooltip
        title="Validierungs-Split"
        text="Anteil der Bilder, die vom Training zurückgehalten und nur zum Prüfen genutzt werden. Zeigt, wie gut das Modell auf ungesehenen Bildern funktioniert."
      />
    </div>
    <div class="value">
      {opts ? (opts.validationSplit ? Math.round(opts.validationSplit * 100) + ' %' : 'aus') : '–'}
    </div>
  </div>

  <div class="stat">
    <div class="label">
      Augmentierung
      <InfoTooltip
        title="Daten-Augmentierung"
        text="Erzeugt zufällig gespiegelte, gedrehte, hellere/dunklere und leicht gezoomte Varianten deiner Bilder, damit das Modell robuster wird."
      />
    </div>
    <div class="value small">{opts ? (opts.augmentation ? 'An' : 'Aus') : '–'}</div>
  </div>

  {#if !isPose}
    <div class="stat">
      <div class="label">
        Feature-Extraktor
        <InfoTooltip
          title="Feature-Extraktor"
          text="Vortrainiertes Netz, das jedes Bild in einen Merkmalsvektor umwandelt. Nur der kleine Klassifikator darüber wird trainiert — deshalb reichen wenige Bilder."
        />
      </div>
      <div class="value small">{extractorLabel}</div>
    </div>

    <div class="stat">
      <div class="label">
        Bildbereich
        <InfoTooltip
          title="Bildbereich (ROI)"
          text="Der Ausschnitt des Kamerabildes, mit dem trainiert wurde. Beim Testen wird derselbe Ausschnitt verwendet."
        />
      </div>
      <div class="value small">{roiLabel}</div>
    </div>
  {/if}

  <div class="stat">
    <div class="label">
      Parameter
      <InfoTooltip
        title="Parameter"
        text="Anzahl der einstellbaren Werte (Gewichte + Bias) im neuronalen Netz. Mehr Parameter = theoretisch mehr Kapazität, aber auch größeres Modell und mehr Gefahr von Überanpassung."
      />
    </div>
    <div class="value small">{formatNumber(meta.params)}</div>
  </div>

  <div class="stat">
    <div class="label">
      Größe
      <InfoTooltip
        title="Modellgröße"
        text="Speicherbedarf des Modells (ungefähr, basierend auf Parametern × 4 Bytes für float32). Wichtig, wenn du das Modell später auf ein Gerät mit wenig Speicher exportierst."
      />
    </div>
    <div class="value small">{formatBytes(meta.sizeBytes)}</div>
  </div>

  <div class="stat">
    <div class="label">
      Trainiert am
      <InfoTooltip
        title="Trainingszeitpunkt"
        text="Wann dieses Modell trainiert wurde. Ändern sich Klassen oder Beispiele nach dem Training, sollte neu trainiert werden — das Datum hilft dabei, den Überblick zu behalten."
      />
    </div>
    <div class="value small">{trainedOn}</div>
  </div>
</div>

<style lang="scss">
  // Auto-fit keeps the facts at four to five columns on the usual panel widths
  // and folds down gracefully when the camera pane is dragged narrow.
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
    gap: 6px;
  }
  .stat {
    background: rgba(var(--md-surface-variant), 0.4);
    border-radius: var(--md-radius-md);
    padding: 6px 10px;
    min-width: 0;
  }
  .label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: rgb(var(--md-on-surface-variant));
    display: flex;
    align-items: center;
    gap: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .value {
    font-size: 16px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    &.highlight {
      color: rgb(var(--md-primary));
    }
    &.small {
      font-size: 12px;
      font-weight: 500;
    }
  }
</style>
