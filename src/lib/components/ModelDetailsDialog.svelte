<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import ConfusionMatrix from '$lib/components/ConfusionMatrix.svelte';
  import { calculateConfusionMatrix } from '$lib/machine';
  import { showNotification } from '$lib/stores/notifications';
  import { trainingHistory, classes, examples, modelMetadata } from '$lib/stores';
  import { get } from 'svelte/store';
  export let open = false;
  const dispatch = createEventDispatcher();
  function close() { open = false; dispatch('close'); }

  let activeTab: 'overview' | 'accuracy' | 'confusion' = 'overview';
  let accuracyLossCanvas: HTMLCanvasElement | null = null;
  let chartInstance: any = null;
  let unsubscribe: (() => void) | null = null;
  let confusionMatrix: number[][] = [];
  let confusionClasses: string[] = [];
  let metadata: any = get(modelMetadata);
  let metaUnsub: (() => void) | null = null;

  function formatNumber(n: number | undefined) {
    if (!n && n !== 0) return '-';
    return n.toLocaleString();
  }

  function formatBytes(bytes: number | undefined) {
    if (!bytes && bytes !== 0) return '-';
    const units = ['Bytes', 'KB', 'MB', 'GB'];
    let idx = 0;
    let val = bytes;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx++;
    }
    return `${val.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
  }

  $: if (open && accuracyLossCanvas) {
    (async () => {
      if (chartInstance) {
        try { chartInstance.destroy(); } catch (e) { /* ignore */ }
        chartInstance = null;
      }
      const ChartModule = await import('chart.js/auto');
      const ChartCtor = (ChartModule as any).Chart || (ChartModule as any).default || ChartModule;
      const ctx = accuracyLossCanvas.getContext('2d');
      chartInstance = new ChartCtor(ctx as any, {
        type: 'line',
        data: {
          labels: get(trainingHistory).epochs || [],
          datasets: [
            { label: 'Genauigkeit', data: get(trainingHistory).accuracy || [], borderColor: '#4CAF50' },
            { label: 'Verlust', data: get(trainingHistory).loss || [], borderColor: '#F44336' }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });

      if (unsubscribe) unsubscribe();
      unsubscribe = trainingHistory.subscribe((history) => {
        if (!chartInstance) return;
        chartInstance.data.labels = history.epochs || [];
        if (chartInstance.data.datasets?.[0]) chartInstance.data.datasets[0].data = history.accuracy || [];
        if (chartInstance.data.datasets?.[1]) chartInstance.data.datasets[1].data = history.loss || [];
        try { chartInstance.update(); } catch (e) { /* ignore */ }
      });
    })();
  }

  $: if (open && activeTab === 'confusion') {
    (async () => {
      try {
        showNotification('Konfusionsmatrix wird berechnet...', { type: 'info' });
        const res = await calculateConfusionMatrix();
        confusionMatrix = res.matrix;
        confusionClasses = res.classes;
        showNotification('Konfusionsmatrix berechnet', { type: 'success' });
      } catch (err) {
        console.error('Failed to calculate confusion matrix', err);
        showNotification('Fehler beim Berechnen der Konfusionsmatrix', { type: 'error' });
      }
    })();
  }

  onDestroy(() => {
    if (chartInstance) {
      try { chartInstance.destroy(); } catch (e) { /* ignore */ }
      chartInstance = null;
    }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (metaUnsub) { metaUnsub(); metaUnsub = null; }
  });

  // keep a subscription for model metadata for UI updates
  onMount(() => {
    metaUnsub = modelMetadata.subscribe((m) => (metadata = m));
  });
</script>

{#if open}
  <div class="dialog-overlay" role="button" tabindex="0" on:click={close} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') close(); }}></div>
  <div class="model-details-dialog">
    <button class="close-btn" on:click={close}>&times;</button>
    <h2>Modell-Details</h2>
    <div class="model-details-tabs">
      <button type="button" class="model-details-tab {activeTab === 'overview' ? 'active' : ''}" on:click={() => activeTab = 'overview'}>Übersicht</button>
      <button type="button" class="model-details-tab {activeTab === 'accuracy' ? 'active' : ''}" on:click={() => activeTab = 'accuracy'}>Genauigkeit</button>
      <button type="button" class="model-details-tab {activeTab === 'confusion' ? 'active' : ''}" on:click={() => activeTab = 'confusion'}>Konfusionsmatrix</button>
    </div>

    <div class="model-stats">
      <div class="stat-card" style="min-width: 100%;">
        <div class="stat-value">{metadata?.name || 'Unnamed Model'}</div>
        <div class="stat-label">Modellname</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{metadata?.version || '-'}</div>
        <div class="stat-label">Version</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{metadata?.date ? new Date(metadata.date).toLocaleString() : '-'}</div>
        <div class="stat-label">Trainingsdatum</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{$trainingHistory.epochs.length}</div>
        <div class="stat-label">Trainingsepochen</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{get(trainingHistory).accuracy?.length ? (get(trainingHistory).accuracy[get(trainingHistory).accuracy.length - 1] * 100).toFixed(1) + '%' : '-'}</div>
        <div class="stat-label">Gesamtgenauigkeit</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{$classes?.length || 0}</div>
        <div class="stat-label">Klassen</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{Object.values(get(examples)).reduce((acc: number, arr: any[]) => acc + (arr?.length || 0), 0)}</div>
        <div class="stat-label">Trainingsbeispiele</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatNumber(metadata?.params)}</div>
        <div class="stat-label">Parameter</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatNumber(metadata?.layers)}</div>
        <div class="stat-label">Schichten</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatBytes(metadata?.sizeBytes)}</div>
        <div class="stat-label">Modellgröße</div>
      </div>
    </div>

    {#if activeTab === 'accuracy'}
      <div class="chart-container">
        <canvas bind:this={accuracyLossCanvas} class="accuracy-loss-chart"></canvas>
      </div>
    {/if}
    {#if activeTab === 'confusion'}
      <div class="confusion-container" style="margin-top:12px;">
        <ConfusionMatrix classes={confusionClasses} matrix={confusionMatrix} />
      </div>
    {/if}
  </div>
{/if}
