<script lang="ts">
  import type { TrainedModel } from '$lib/stores/projects';
  import { COMPARE_COLORS, COMPARE_DASHES } from '$lib/compare';
  import { modelLabel } from '$lib/models';

  // One curve per compared model in a single chart, so runs of different length
  // stand next to each other and each ends where its training stopped. Plain
  // SVG like EpochChart next door, for the same reason: this lives in a modal
  // that mounts and unmounts, and an ApexCharts instance would have to be torn
  // down and rebuilt with it.
  let {
    models,
    metric = $bindable('accuracy')
  }: {
    models: TrainedModel[];
    metric?: 'accuracy' | 'loss' | 'valAccuracy';
  } = $props();

  const W = 900;
  const H = 250;
  const L = 52;
  const R = 884;
  const T = 14;
  const B = 200;

  const METRICS: { id: 'accuracy' | 'loss' | 'valAccuracy'; label: string }[] = [
    { id: 'accuracy', label: 'Genauigkeit' },
    { id: 'loss', label: 'Verlust' },
    { id: 'valAccuracy', label: 'Geprüfte Genauigkeit' }
  ];

  function seriesOf(model: TrainedModel): number[] {
    const h = model.history;
    if (metric === 'accuracy') return h.accuracy ?? [];
    if (metric === 'loss') return h.loss ?? [];
    return h.valAccuracy ?? [];
  }

  const series = $derived(models.map((m) => ({ model: m, values: seriesOf(m) })));
  const maxEpochs = $derived(Math.max(1, ...series.map((s) => s.values.length)));
  /** Loss has no natural ceiling, so the axis is fitted to the runs on screen. */
  const maxValue = $derived.by(() => {
    if (metric !== 'loss') return 1;
    const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    const peak = all.length ? Math.max(...all) : 1;
    return peak > 0 ? peak * 1.05 : 1;
  });
  const hasAnything = $derived(series.some((s) => s.values.length > 0));

  function x(i: number): number {
    if (maxEpochs <= 1) return L;
    return L + ((R - L) * i) / (maxEpochs - 1);
  }
  function y(v: number): number {
    return B - (B - T) * Math.max(0, Math.min(1, v / maxValue));
  }
  function line(values: number[]): string {
    return values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  }
  function axisLabel(fraction: number): string {
    const v = fraction * maxValue;
    return metric === 'loss' ? v.toFixed(2).replace('.', ',') : `${Math.round(v * 100)} %`;
  }

  const xTicks = $derived.by(() => {
    const step = Math.max(1, Math.ceil(maxEpochs / 6));
    const ticks: { at: number; label: string }[] = [];
    for (let i = 0; i < maxEpochs; i += step) ticks.push({ at: x(i), label: String(i + 1) });
    return ticks;
  });
</script>

<div class="chart-head">
  <span class="ct">Trainingsverlauf</span>
  <div class="seg" role="tablist">
    {#each METRICS as m}
      <button
        type="button"
        role="tab"
        aria-selected={metric === m.id}
        class:on={metric === m.id}
        onclick={() => (metric = m.id)}
      >{m.label}</button>
    {/each}
  </div>
  <div class="legend">
    {#each models as model, i (model.id)}
      <span>
        <i
          style="border-color:{COMPARE_COLORS[i % COMPARE_COLORS.length]};
                 border-top-style:{COMPARE_DASHES[i % COMPARE_DASHES.length] ? 'dashed' : 'solid'}"
        ></i>{modelLabel(model)}
      </span>
    {/each}
  </div>
</div>

{#if hasAnything}
  <svg viewBox="0 0 {W} {H}" width="100%" height={H} role="img" aria-label="Trainingsverlauf aller verglichenen Modelle">
    <g stroke="rgba(0,0,0,.08)" stroke-width="1">
      {#each [0, 0.25, 0.5, 0.75, 1] as f}
        <line x1={L} y1={y(f * maxValue)} x2={R} y2={y(f * maxValue)} />
      {/each}
    </g>
    <g font-size="10" fill="#46464F" text-anchor="end">
      {#each [1, 0.5, 0] as f}
        <text x={L - 8} y={y(f * maxValue) + 4}>{axisLabel(f)}</text>
      {/each}
    </g>

    {#each series as s, i (s.model.id)}
      {#if s.values.length > 1}
        <polyline
          fill="none"
          stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
          stroke-width="2.4"
          stroke-linejoin="round"
          stroke-linecap="round"
          stroke-dasharray={COMPARE_DASHES[i % COMPARE_DASHES.length] || undefined}
          points={line(s.values)}
        />
      {/if}
      {#if s.values.length}
        <!-- The run ends here; without the dot a short run just looks cut off. -->
        <circle
          cx={x(s.values.length - 1)}
          cy={y(s.values[s.values.length - 1])}
          r="3.5"
          fill={COMPARE_COLORS[i % COMPARE_COLORS.length]}
        />
      {/if}
    {/each}

    <g font-size="10" fill="#46464F" text-anchor="middle">
      {#each xTicks as tick}
        <text x={tick.at} y={B + 20}>{tick.label}</text>
      {/each}
      <text x={(L + R) / 2} y={H - 6}>Epoche</text>
    </g>
  </svg>
  <div class="foot">
    Jede Kurve endet dort, wo ihr Training aufhörte — unterschiedlich lange Läufe stehen nebeneinander.
    {#if metric === 'valAccuracy'}
      Läufe ohne zurückgehaltene Bilder haben hier keine Kurve.
    {/if}
  </div>
{:else}
  <div class="empty">
    {metric === 'valAccuracy'
      ? 'Keiner dieser Läufe hat Bilder zum Prüfen zurückgehalten.'
      : 'Für diese Modelle ist kein Verlauf gespeichert.'}
  </div>
{/if}

<style lang="scss">
  .chart-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .ct {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 700;
    color: rgb(var(--md-on-surface-variant));
  }
  .seg {
    display: inline-flex;
    background: rgb(var(--md-surface));
    border-radius: 99px;
    padding: 3px;
    gap: 2px;
    box-shadow: inset 0 0 0 1px rgb(var(--md-outline-variant));
    button {
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 5px 13px;
      border-radius: 99px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: rgb(var(--md-on-surface-variant));
      &.on {
        background: rgb(var(--md-primary));
        color: rgb(var(--md-on-primary));
      }
    }
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-left: auto;
    font-size: 12px;
    color: rgb(var(--md-on-surface));
    span {
      display: inline-flex;
      align-items: center;
      min-width: 0;
    }
    i {
      width: 16px;
      border-top-width: 3px;
      display: inline-block;
      margin-right: 6px;
      border-radius: 2px;
    }
  }
  .foot,
  .empty {
    font-size: 11.5px;
    color: rgb(var(--md-on-surface-variant));
    margin-top: 4px;
  }
  .empty {
    padding: 18px 0;
  }
</style>
