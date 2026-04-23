<script lang="ts">
  import { trainingHistory } from '$lib/stores';
  import { isTraining } from '$lib/stores/app';
  import ConfusionMatrix from '$lib/components/ConfusionMatrix.svelte';
  import { calculateConfusionMatrix } from '$lib/machine';
  import { showNotification } from '$lib/stores/notifications';
  import { chart } from 'svelte-apexcharts';

  let { initialTab = 'accuracy' }: { initialTab?: 'accuracy' | 'confusion' } = $props();

  let tab = $state<'accuracy' | 'confusion'>(initialTab);
  let matrix: number[][] = $state([]);
  let matrixClasses: string[] = $state([]);
  let matrixLoading = $state(false);

  const hist = $derived($trainingHistory);

  const chartOptions = $derived({
    chart: {
      type: 'line',
      height: 240,
      animations: { enabled: true, speed: 200, dynamicAnimation: { speed: 200 } },
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: 'var(--md-font)'
    },
    stroke: { curve: 'smooth', width: 2 },
    colors: ['#4CAF50', '#F44336'],
    series: [
      { name: 'Genauigkeit', data: hist.accuracy.map((v, i) => [hist.epochs[i], v]) },
      { name: 'Verlust',     data: hist.loss.map((v, i) => [hist.epochs[i], v]) }
    ],
    xaxis: {
      type: 'numeric',
      title: { text: 'Epoche', style: { fontSize: '11px' } },
      labels: { style: { fontSize: '10px' } }
    },
    yaxis: [
      {
        title: { text: 'Genauigkeit', style: { color: '#4CAF50', fontSize: '11px' } },
        min: 0, max: 1,
        labels: { style: { colors: '#4CAF50', fontSize: '10px' }, formatter: (v: number) => (v * 100).toFixed(0) + ' %' }
      },
      {
        opposite: true,
        title: { text: 'Verlust', style: { color: '#F44336', fontSize: '11px' } },
        min: 0,
        labels: { style: { colors: '#F44336', fontSize: '10px' }, formatter: (v: number) => v.toFixed(2) }
      }
    ],
    grid: { borderColor: 'rgba(0,0,0,0.08)' },
    legend: { fontSize: '12px' },
    tooltip: {
      x: { formatter: (v: number) => 'Epoche ' + v },
      y: [
        { formatter: (v: number) => (v * 100).toFixed(1) + ' %' },
        { formatter: (v: number) => v.toFixed(4) }
      ]
    },
    noData: { text: 'Warte auf Trainingsdaten…', style: { fontSize: '13px' } }
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
    <div class="chart-wrap" use:chart={chartOptions}></div>
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
  .chart-wrap {
    min-height: 260px;
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
