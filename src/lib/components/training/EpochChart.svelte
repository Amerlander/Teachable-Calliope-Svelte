<script lang="ts">
  import type { TrainingHistory } from '$lib/stores/projects';

  // The epoch table drawn as curves. Deliberately plain SVG rather than the
  // ApexCharts instance ModelCharts manages: this one sits in a modal that is
  // mounted and unmounted per pane, and it has to show four series — the two
  // training curves and, when the run held images back, the two checked ones.
  let { history }: { history: TrainingHistory } = $props();

  const ACC = '#4CAF50';
  const LOSS = '#F44336';

  // Viewport of the drawing. The SVG scales with its container, so these are
  // just the coordinates the paths are computed in.
  const W = 600;
  const H = 210;
  const L = 44; // left axis
  const R = 566; // right axis
  const T = 14;
  const B = 168;

  const epochs = $derived(history.epochs ?? []);
  const hasVal = $derived(
    (history.valAccuracy?.length ?? 0) > 0 && (history.valLoss?.length ?? 0) > 0
  );
  const maxLoss = $derived.by(() => {
    const all = [...(history.loss ?? []), ...(history.valLoss ?? [])].filter((v) =>
      Number.isFinite(v)
    );
    const peak = all.length ? Math.max(...all) : 1;
    return peak > 0 ? peak * 1.05 : 1;
  });

  function x(i: number): number {
    if (epochs.length <= 1) return L;
    return L + ((R - L) * i) / (epochs.length - 1);
  }
  function yAcc(v: number): number {
    return B - (B - T) * Math.max(0, Math.min(1, v));
  }
  function yLoss(v: number): number {
    return B - (B - T) * Math.max(0, Math.min(1, v / maxLoss));
  }
  function line(values: number[] | undefined, scale: (v: number) => number): string {
    if (!values?.length) return '';
    return values
      .map((v, i) => `${x(i).toFixed(1)},${scale(v).toFixed(1)}`)
      .join(' ');
  }

  const accLine = $derived(line(history.accuracy, yAcc));
  const valAccLine = $derived(line(history.valAccuracy, yAcc));
  const lossLine = $derived(line(history.loss, yLoss));
  const valLossLine = $derived(line(history.valLoss, yLoss));

  // Three labels are enough on this width; the last one is always the final epoch.
  const xTicks = $derived.by(() => {
    if (!epochs.length) return [];
    const idx = [0, Math.floor((epochs.length - 1) / 2), epochs.length - 1];
    return [...new Set(idx)].map((i) => ({ at: x(i), label: String(epochs[i]) }));
  });
</script>

{#if epochs.length}
  <div class="legend">
    <span><i class="swatch" style="background:{ACC}"></i>Genauigkeit</span>
    <span><i class="swatch" style="background:{LOSS}"></i>Verlust</span>
    {#if hasVal}
      <span><i class="swatch dashed" style="border-color:{ACC}"></i>geprüfte Genauigkeit</span>
      <span><i class="swatch dashed" style="border-color:{LOSS}"></i>geprüfter Verlust</span>
    {/if}
  </div>

  <svg viewBox="0 0 {W} {H}" width="100%" height={H} role="img" aria-label="Genauigkeit und Verlust pro Epoche">
    <g stroke="rgba(0,0,0,.08)" stroke-width="1">
      {#each [0, 0.25, 0.5, 0.75, 1] as f}
        <line x1={L} y1={yAcc(f)} x2={R} y2={yAcc(f)} />
      {/each}
    </g>

    <g font-size="9" fill={ACC} text-anchor="end">
      <text x={L - 6} y={yAcc(1) + 4}>100 %</text>
      <text x={L - 6} y={yAcc(0.5) + 4}>50 %</text>
      <text x={L - 6} y={yAcc(0) + 4}>0 %</text>
    </g>
    <g font-size="9" fill={LOSS} text-anchor="start">
      <text x={R + 6} y={yAcc(1) + 4}>{maxLoss.toFixed(2).replace('.', ',')}</text>
      <text x={R + 6} y={yAcc(0.5) + 4}>{(maxLoss / 2).toFixed(2).replace('.', ',')}</text>
      <text x={R + 6} y={yAcc(0) + 4}>0</text>
    </g>

    {#if hasVal}
      <polyline fill="none" stroke={ACC} stroke-width="1.6" stroke-dasharray="4 3" points={valAccLine} />
      <polyline fill="none" stroke={LOSS} stroke-width="1.6" stroke-dasharray="4 3" points={valLossLine} />
    {/if}
    <polyline fill="none" stroke={ACC} stroke-width="2.2" stroke-linejoin="round" points={accLine} />
    <polyline fill="none" stroke={LOSS} stroke-width="2.2" stroke-linejoin="round" points={lossLine} />

    {#if epochs.length === 1}
      <circle cx={L} cy={yAcc(history.accuracy[0] ?? 0)} r="3" fill={ACC} />
      <circle cx={L} cy={yLoss(history.loss[0] ?? 0)} r="3" fill={LOSS} />
    {/if}

    <g font-size="9" fill="#46464F" text-anchor="middle">
      {#each xTicks as tick}
        <text x={tick.at} y={B + 18}>{tick.label}</text>
      {/each}
      <text x={(L + R) / 2} y={H - 4}>Epoche</text>
    </g>
  </svg>
{:else}
  <div class="empty">Für dieses Modell ist kein Verlauf gespeichert.</div>
{/if}

<style lang="scss">
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 11.5px;
    color: rgb(var(--md-on-surface-variant));
    margin-bottom: 2px;
    span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
  }
  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
    &.dashed {
      background: transparent;
      border: 2px solid;
      border-radius: 0;
      height: 0;
      width: 12px;
    }
  }
  .empty {
    font-size: 12.5px;
    color: rgb(var(--md-on-surface-variant));
    padding: 8px 0;
  }
</style>
