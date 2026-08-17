<script lang="ts">
  import { untrack } from 'svelte';
  import { trainingHistory } from '$lib/stores';
  import { isTraining } from '$lib/stores/app';
  import { activeModel } from '$lib/stores/projects';
  import ConfusionMatrix from '$lib/components/ConfusionMatrix.svelte';
  import InfoTooltip from '$lib/components/ui/InfoTooltip.svelte';
  import { calculateConfusionMatrix } from '$lib/machine';
  import { showNotification } from '$lib/stores/notifications';

  let { initialTab = 'accuracy' }: { initialTab?: 'accuracy' | 'confusion' } = $props();

  const ACC_COLOR = '#4CAF50';
  const LOSS_COLOR = '#F44336';

  let tab = $state<'accuracy' | 'confusion'>(initialTab);
  let matrix: number[][] = $state([]);
  let matrixClasses: string[] = $state([]);
  let matrixLoading = $state(false);

  const hist = $derived($trainingHistory);

  // Which run the curves belong to. Switching models means a different curve,
  // not an update of the current one — see the rebuild effect below.
  const runId = $derived($activeModel?.id ?? 'live');

  const series = $derived([
    { name: 'Genauigkeit', data: hist.accuracy.map((v, i) => [hist.epochs[i], v]) },
    { name: 'Verlust', data: hist.loss.map((v, i) => [hist.epochs[i], v]) }
  ]);
  // Cheap identity of what is currently plotted, so a rebuilt chart isn't
  // immediately re-animated with the very data it was created with.
  const seriesKey = $derived(
    `${runId}|${hist.epochs.length}|${hist.accuracy.at(-1) ?? ''}|${hist.loss.at(-1) ?? ''}`
  );

  const chartOptions = $derived({
    chart: {
      type: 'line',
      height: 240,
      width: '100%',
      animations: { enabled: true, speed: 200, dynamicAnimation: { speed: 200 } },
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: 'var(--md-font)'
    },
    stroke: { curve: 'smooth', width: 2 },
    colors: [ACC_COLOR, LOSS_COLOR],
    xaxis: {
      type: 'numeric',
      title: { text: 'Epoche', style: { fontSize: '11px' } },
      labels: { style: { fontSize: '10px' } }
    },
    yaxis: [
      {
        title: { text: 'Genauigkeit', style: { color: ACC_COLOR, fontSize: '11px' } },
        min: 0, max: 1,
        labels: { style: { colors: ACC_COLOR, fontSize: '10px' }, formatter: (v: number) => (v * 100).toFixed(0) + ' %' }
      },
      {
        opposite: true,
        title: { text: 'Verlust', style: { color: LOSS_COLOR, fontSize: '11px' } },
        min: 0,
        labels: { style: { colors: LOSS_COLOR, fontSize: '10px' }, formatter: (v: number) => v.toFixed(2) }
      }
    ],
    grid: { borderColor: 'rgba(0,0,0,0.08)' },
    // Our own legend above the chart carries the two explanations.
    legend: { show: false },
    tooltip: {
      x: { formatter: (v: number) => 'Epoche ' + v },
      y: [
        { formatter: (v: number) => (v * 100).toFixed(1) + ' %' },
        { formatter: (v: number) => v.toFixed(4) }
      ]
    },
    noData: { text: 'Warte auf Trainingsdaten…', style: { fontSize: '13px' } }
  });

  // ---------- Chart lifecycle ----------
  // The chart instance is managed here instead of through the `use:chart`
  // action: that action never destroys its chart and only ever merges options
  // into it, which left the previous model's epochs on screen after a switch to
  // a shorter run. It also rendered the chart in the same frame the surrounding
  // flex row was still being laid out, so the chart measured a too-small width —
  // ApexCharts corrects that from its own parent observer only once the intro
  // animation has ended, which is exactly when the first measurement happens.
  let wrapEl: HTMLDivElement | null = $state(null);
  let chart = $state<any>(null);
  let appliedKey: string | null = null;

  $effect(() => {
    const el = wrapEl;
    // A new run gets a new chart; new data points only get updateSeries().
    void runId;
    if (!el) return;

    let disposed = false;
    let instance: any = null;
    let lastWidth = 0;
    let ro: ResizeObserver | null = null;

    const raf = requestAnimationFrame(async () => {
      if (disposed) return;
      const ApexCharts = (await import('apexcharts')).default;
      if (disposed) return;
      // One frame later the row around us has its final width.
      lastWidth = el.clientWidth;
      const opts = untrack(() => ({ ...chartOptions, series }));
      appliedKey = untrack(() => seriesKey);
      instance = new ApexCharts(el, opts);
      await instance.render();
      if (disposed) {
        instance.destroy();
        return;
      }
      chart = instance;

      // Dragging the splitpane or the panel gaining a scrollbar changes our
      // width afterwards; drive the redraw off the wrapper instead of relying
      // on the built-in handler, which ignores resizes while animating.
      ro = new ResizeObserver(() => {
        const w = el.clientWidth;
        if (!w || Math.abs(w - lastWidth) < 2) return;
        lastWidth = w;
        instance?.updateOptions({}, true, false);
      });
      ro.observe(el);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      if (instance) instance.destroy();
      if (chart === instance) chart = null;
      appliedKey = null;
    };
  });

  // Live training and late-arriving epochs: update the data in place so the
  // curve keeps animating instead of being rebuilt on every epoch.
  $effect(() => {
    const key = seriesKey;
    const c = chart;
    if (!c || appliedKey === key) return;
    appliedKey = key;
    c.updateSeries(untrack(() => series), true);
  });

  // A different run means a different classifier, so a matrix computed for the
  // previous one has to go — the tab recomputes it when it is opened again.
  $effect(() => {
    void runId;
    untrack(() => {
      if (matrix.length) {
        matrix = [];
        matrixClasses = [];
      }
    });
  });

  $effect(() => {
    if (tab === 'confusion' && !matrix.length && !matrixLoading && !$isTraining) {
      void computeMatrix();
    }
  });

  async function computeMatrix() {
    matrixLoading = true;
    try {
      const res = await calculateConfusionMatrix();
      matrix = res.matrix;
      matrixClasses = res.classes;
    } catch (err) {
      showNotification('Konfusionsmatrix: ' + (err as Error).message, { type: 'error' });
    } finally {
      matrixLoading = false;
    }
  }
</script>

<div class="charts">
  <div class="chart-tabs">
    <button class="chart-tab" class:active={tab === 'accuracy'} onclick={() => (tab = 'accuracy')}>
      Verlauf
    </button>
    <button class="chart-tab" class:active={tab === 'confusion'} onclick={() => (tab = 'confusion')}>
      Konfusionsmatrix
    </button>
  </div>

  {#if tab === 'accuracy'}
    <div class="curve-legend">
      <span class="curve-key">
        <span class="swatch" style="background:{ACC_COLOR}"></span>
        Genauigkeit
        <InfoTooltip
          title="Genauigkeit — so sollte die Kurve aussehen"
          text="Gut: Sie steigt in den ersten Epochen steil an und läuft dann flach auf einem hohen Wert aus. Bleibt sie flach und niedrig? Das Modell lernt kaum — Lernrate erhöhen (z. B. 0.001 → 0.005) oder mehr Hidden Units. Springt sie stark auf und ab? Lernrate zu hoch oder Batch-Größe zu klein. Erreicht sie schon nach wenigen Epochen 100 %? Meist zu wenige oder zu ähnliche Bilder — das Modell merkt sich die Bilder statt Muster. Dann helfen mehr und vielfältigere Aufnahmen, Augmentierung und weniger Epochen."
        />
      </span>
      <span class="curve-key">
        <span class="swatch" style="background:{LOSS_COLOR}"></span>
        Verlust
        <InfoTooltip
          title="Verlust — so sollte die Kurve aussehen"
          text="Gut: Sie fällt gleichmäßig und wird zum Ende hin flach. Fällt sie kaum? Länger trainieren (mehr Epochen) oder Lernrate erhöhen. Zappelt sie oder steigt sie wieder an? Lernrate verringern (z. B. 0.001 → 0.0003) oder Batch-Größe erhöhen. Fällt sie fast auf 0, obwohl neue Bilder im Test falsch erkannt werden? Das ist Überanpassung — Dropout erhöhen, Augmentierung anschalten oder früher stoppen (weniger Epochen, Stop-Loss setzen)."
        />
      </span>
    </div>
    <div class="chart-wrap" bind:this={wrapEl}></div>
  {:else}
    <div class="matrix-wrap">
      {#if $isTraining}
        <div class="empty">Konfusionsmatrix verfügbar nach dem Training</div>
      {:else if matrixLoading}
        <div class="empty">Berechne…</div>
      {:else if matrix.length}
        <ConfusionMatrix classes={matrixClasses} {matrix} />
      {:else}
        <div class="empty">Noch keine Daten</div>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  .charts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .chart-tabs {
    display: flex;
    gap: 4px;
    background: rgba(var(--md-surface-variant), 0.3);
    padding: 4px;
    border-radius: var(--md-radius-md);
  }
  .chart-tab {
    flex: 1;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-radius: var(--md-radius-sm);
    font-size: 13px;
    font-weight: 500;
    color: rgb(var(--md-on-surface-variant));
    cursor: pointer;
    box-shadow: none;
    min-height: unset;
    &.active {
      background: rgb(var(--md-secondary-container));
      color: rgb(var(--md-on-secondary-container));
      font-weight: 600;
    }
  }
  // Replaces the chart's own legend so each curve can carry its reading guide.
  .curve-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }
  .curve-key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      flex-shrink: 0;
    }
  }
  .chart-wrap {
    min-height: 260px;
    min-width: 0;
    background: #fff;
    border-radius: var(--md-radius-md);
    padding: 4px;
  }
  .matrix-wrap {
    min-height: 180px;
  }
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 120px;
    color: rgb(var(--md-on-surface-variant));
    font-size: 13px;
    font-style: italic;
  }
</style>
