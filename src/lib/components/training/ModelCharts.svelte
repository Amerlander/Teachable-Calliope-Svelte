<script lang="ts">
  import { onDestroy } from 'svelte';
  import { trainingHistory } from '$lib/stores';
  import ConfusionMatrix from '$lib/components/ConfusionMatrix.svelte';
  import { calculateConfusionMatrix } from '$lib/machine';
  import { showNotification } from '$lib/stores/notifications';

  let { initialTab = 'accuracy' }: { initialTab?: 'accuracy' | 'confusion' } = $props();

  let tab = $state<'accuracy' | 'confusion'>(initialTab);
  let canvasEl: HTMLCanvasElement | null = $state(null);
  let chart: any = null;
  let matrix: number[][] = $state([]);
  let matrixClasses: string[] = $state([]);
  let matrixLoading = $state(false);

  $effect(() => {
    if (tab === 'accuracy' && canvasEl) {
      void renderChart();
    }
    return () => {
      if (chart) {
        try {
          chart.destroy();
        } catch {
          /* ignore */
        }
        chart = null;
      }
    };
  });

  $effect(() => {
    if (tab === 'confusion' && !matrix.length && !matrixLoading) {
      void computeMatrix();
    }
  });

  async function renderChart() {
    const history = $trainingHistory;
    const ChartModule = await import('chart.js/auto');
    const ChartCtor = (ChartModule as any).Chart || (ChartModule as any).default || ChartModule;
    if (chart) {
      try {
        chart.destroy();
      } catch {
        /* ignore */
      }
      chart = null;
    }
    if (!canvasEl) return;
    chart = new ChartCtor(canvasEl.getContext('2d') as any, {
      type: 'line',
      data: {
        labels: history.epochs,
        datasets: [
          { label: 'Genauigkeit', data: history.accuracy, borderColor: '#4CAF50', tension: 0.25 },
          { label: 'Verlust', data: history.loss, borderColor: '#F44336', tension: 0.25 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

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

  onDestroy(() => {
    if (chart) {
      try {
        chart.destroy();
      } catch {
        /* ignore */
      }
    }
  });
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
    <div class="chart-wrap">
      {#if $trainingHistory.epochs.length}
        <canvas bind:this={canvasEl}></canvas>
      {:else}
        <div class="empty">Noch kein Training durchgeführt</div>
      {/if}
    </div>
  {:else}
    <div class="matrix-wrap">
      {#if matrixLoading}
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
    height: 220px;
    position: relative;
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
