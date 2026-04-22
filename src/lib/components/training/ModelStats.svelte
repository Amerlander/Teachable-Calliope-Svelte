<script lang="ts">
  import { modelMetadata, trainingHistory, classes, examples } from '$lib/stores';

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

  const totalExamples = $derived(
    Object.values($examples).reduce((acc, arr) => acc + (arr?.length || 0), 0)
  );
  const finalAccuracy = $derived(
    $trainingHistory.accuracy.length
      ? ($trainingHistory.accuracy[$trainingHistory.accuracy.length - 1] * 100).toFixed(1) + ' %'
      : '–'
  );
  const trainedOn = $derived(
    $modelMetadata.date ? new Date($modelMetadata.date).toLocaleString('de-DE') : '–'
  );
</script>

<div class="stats-grid">
  <div class="stat">
    <div class="label">Genauigkeit</div>
    <div class="value highlight">{finalAccuracy}</div>
  </div>
  <div class="stat">
    <div class="label">Klassen</div>
    <div class="value">{$classes.length}</div>
  </div>
  <div class="stat">
    <div class="label">Beispiele</div>
    <div class="value">{totalExamples}</div>
  </div>
  <div class="stat">
    <div class="label">Epochen</div>
    <div class="value">{$trainingHistory.epochs.length || '–'}</div>
  </div>
  <div class="stat">
    <div class="label">Parameter</div>
    <div class="value">{formatNumber($modelMetadata.params)}</div>
  </div>
  <div class="stat">
    <div class="label">Größe</div>
    <div class="value">{formatBytes($modelMetadata.sizeBytes)}</div>
  </div>
  <div class="stat wide">
    <div class="label">Trainiert am</div>
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
