<script lang="ts">
  import { modelMetadata, trainingHistory, classes, examples } from '$lib/stores';
  import type { TrainedModel } from '$lib/stores/projects';
  import InfoTooltip from '$lib/components/ui/InfoTooltip.svelte';

  // With `model` given, every number comes from that training run's snapshot —
  // the classes and images it was actually trained on, which is not the same as
  // what the project holds now. Without it we fall back to the live project.
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

  const history = $derived(model?.history ?? $trainingHistory);
  const meta = $derived(model?.metadata ?? $modelMetadata);
  const classCount = $derived(model ? (model.classesSnapshot?.length ?? 0) : $classes.length);
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
      Klassen
      <InfoTooltip
        title="Klassen"
        text="Anzahl der Kategorien, die dein Modell unterscheidet. Mehr Klassen = schwieriger zu trainieren. Mindestens 3 Klassen sind nötig."
      />
    </div>
    <div class="value">{classCount}</div>
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
    <div class="value">{history.epochs.length || '–'}</div>
  </div>

  <div class="stat">
    <div class="label">
      Parameter
      <InfoTooltip
        title="Parameter"
        text="Anzahl der einstellbaren Werte (Gewichte + Bias) im neuronalen Netz. Mehr Parameter = theoretisch mehr Kapazität, aber auch größeres Modell und mehr Gefahr von Überanpassung."
      />
    </div>
    <div class="value">{formatNumber(meta.params)}</div>
  </div>

  <div class="stat">
    <div class="label">
      Größe
      <InfoTooltip
        title="Modellgröße"
        text="Speicherbedarf des Modells (ungefähr, basierend auf Parametern × 4 Bytes für float32). Wichtig, wenn du das Modell später auf ein Gerät mit wenig Speicher exportierst."
      />
    </div>
    <div class="value">{formatBytes(meta.sizeBytes)}</div>
  </div>

  <div class="stat wide">
    <div class="label">
      Trainiert am
      <InfoTooltip
        title="Trainingszeitpunkt"
        text="Wann das aktuell geladene Modell trainiert wurde. Ändern sich Klassen oder Beispiele nach dem Training, sollte neu trainiert werden — das Datum hilft dabei, den Überblick zu behalten."
      />
    </div>
    <div class="value small">{trainedOn}</div>
  </div>
</div>

<style lang="scss">
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .stat {
    background: rgba(var(--md-surface-variant), 0.4);
    border-radius: var(--md-radius-md);
    padding: 10px 12px;
    &.wide {
      grid-column: 1 / -1;
    }
  }
  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(var(--md-on-surface-variant));
    margin-bottom: 2px;
    display: flex;
    align-items: center;
  }
  .value {
    font-size: 18px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    &.highlight {
      color: rgb(var(--md-primary));
    }
    &.small {
      font-size: 13px;
      font-weight: 500;
    }
  }
</style>
