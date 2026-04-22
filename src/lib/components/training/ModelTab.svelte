<script lang="ts">
  import { get } from 'svelte/store';
  import {
    classes,
    trainingOptions,
    setTrainingOptions,
    classifierModel,
    modelMetadata,
    setModelArtifacts
  } from '$lib/stores';
  import type { TrainingOptions } from '$lib/stores';
  import { updateProject } from '$lib/stores/projects';
  import { isTraining, trainStatus, modelTrained } from '$lib/stores/app';
  import {
    trainModel,
    saveModelToZip,
    loadModelFromZip,
    loadClassifierFromArtifacts
  } from '$lib/machine';
  import { showNotification } from '$lib/stores/notifications';
  import { generateMakeCodeProject, importProject as importMcProject } from '$lib/makecode';
  import { examples } from '$lib/stores';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import InfoTooltip from '$lib/components/ui/InfoTooltip.svelte';
  import ModelStats from './ModelStats.svelte';
  import ModelCharts from './ModelCharts.svelte';

  let loadModelEl: HTMLInputElement = $state()!;

  const enoughClasses = $derived($classes.length >= 3);
  const hasArtifacts = $derived(!!$classifierModel);

  async function doTrain() {
    if ($classes.length < 3) {
      showNotification('Mindestens 3 Klassen erforderlich', { type: 'warning' });
      return;
    }
    isTraining.set(true);
    trainStatus.set('Training läuft…');
    try {
      const opts = get(trainingOptions);
      await trainModel(
        {
          epochs: opts.epochs,
          batchSize: opts.batchSize,
          learningRate: opts.learningRate,
          hiddenUnits: opts.hiddenUnits
        },
        (ep) => trainStatus.set(`Epoche ${ep + 1}/${opts.epochs}`)
      );
      modelTrained.set(true);
      trainStatus.set('Training abgeschlossen');
      showNotification('Training abgeschlossen', { type: 'success' });
      try {
        const project = generateMakeCodeProject('Teachable Project', get(classes), get(examples));
        importMcProject(project);
      } catch {
        /* ignore */
      }
    } catch (err) {
      trainStatus.set('Fehler beim Training');
      showNotification('Fehler: ' + (err as Error).message, { type: 'error' });
    } finally {
      isTraining.set(false);
    }
  }

  async function onExportModel() {
    const model = get(classifierModel);
    if (!model) {
      showNotification('Kein Modell vorhanden', { type: 'warning' });
      return;
    }
    try {
      await saveModelToZip(model, get(modelMetadata));
      showNotification('Modell exportiert', { type: 'success' });
    } catch {
      showNotification('Fehler beim Speichern', { type: 'error' });
    }
  }

  async function onImportModelChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      await loadModelFromZip(input.files[0]);
      modelTrained.set(true);
      showNotification('Modell geladen', { type: 'success' });
    } catch (err) {
      showNotification('Fehler: ' + (err as Error).message, { type: 'error' });
    }
    input.value = '';
  }

  function onDeleteModel() {
    if (!confirm('Trainiertes Modell löschen?')) return;
    classifierModel.set(null);
    modelTrained.set(false);
    setModelArtifacts(null);
    updateProject((p) => {
      p.trainingHistory = { epochs: [], accuracy: [], loss: [] };
    });
    showNotification('Modell gelöscht', { type: 'success' });
  }

  function updateOpt<K extends keyof TrainingOptions>(key: K, value: TrainingOptions[K]) {
    setTrainingOptions({ [key]: value } as Partial<TrainingOptions>);
  }
</script>

<div class="model-tab">
  <!-- Header row with actions dropdown -->
  <div class="row-between tab-header">
    <span class="section-label">Modell</span>
    <Dropdown placement="bottom-end">
      {#snippet trigger()}
        <button class="ghost small" aria-label="Modell-Aktionen" title="Mehr Aktionen">⋯</button>
      {/snippet}
      {#snippet children()}
        <DropdownItem onclick={onExportModel} disabled={!hasArtifacts}>
          Modell exportieren
        </DropdownItem>
        <DropdownItem onclick={() => loadModelEl?.click()}>
          Modell importieren
        </DropdownItem>
        <DropdownItem onclick={onDeleteModel} disabled={!hasArtifacts}>
          Modell löschen
        </DropdownItem>
      {/snippet}
    </Dropdown>
    <input
      bind:this={loadModelEl}
      type="file"
      accept=".zip"
      style="display:none"
      onchange={onImportModelChange}
    />
  </div>

  <!-- Model stats -->
  <section class="card">
    <ModelStats />
  </section>

  <!-- Training options -->
  <section class="card">
    <h3>Trainings-Optionen</h3>
    <div class="opt-grid">
      <label class="opt">
        <span class="opt-label">
          Epochen
          <InfoTooltip
            text="Wie oft die gesamten Trainingsdaten durchlaufen werden. Mehr Epochen = genauer, aber langsamer. 30 ist ein guter Startwert."
          />
        </span>
        <input
          type="number"
          min="1"
          max="500"
          value={$trainingOptions.epochs}
          onchange={(e) => updateOpt('epochs', +((e.target as HTMLInputElement).value))}
        />
      </label>

      <label class="opt">
        <span class="opt-label">
          Batch-Größe
          <InfoTooltip
            text="Wie viele Beispiele gleichzeitig durchs Modell laufen. Größer = schneller, aber mehr Speicherbedarf."
          />
        </span>
        <input
          type="number"
          min="1"
          max="128"
          value={$trainingOptions.batchSize}
          onchange={(e) => updateOpt('batchSize', +((e.target as HTMLInputElement).value))}
        />
      </label>

      <label class="opt">
        <span class="opt-label">
          Lernrate
          <InfoTooltip
            text="Wie stark das Modell bei jedem Schritt angepasst wird. Kleiner = stabiler, aber langsamer. 0.001 ist Standard."
          />
        </span>
        <input
          type="number"
          min="0.00001"
          max="1"
          step="0.0001"
          value={$trainingOptions.learningRate}
          onchange={(e) => updateOpt('learningRate', +((e.target as HTMLInputElement).value))}
        />
      </label>

      <label class="opt">
        <span class="opt-label">
          Hidden Units
          <InfoTooltip
            text="Anzahl der Neuronen in der versteckten Schicht. Mehr = komplexere Muster lernbar, aber Überanpassungs­risiko."
          />
        </span>
        <input
          type="number"
          min="2"
          max="512"
          value={$trainingOptions.hiddenUnits}
          onchange={(e) => updateOpt('hiddenUnits', +((e.target as HTMLInputElement).value))}
        />
      </label>
    </div>

    <div class="train-row">
      <button class="train-btn" disabled={!enoughClasses || $isTraining} onclick={doTrain}>
        {#if $isTraining}<span class="spinner"></span>{/if}
        {$classifierModel ? 'Neu trainieren' : 'Trainieren'}
      </button>
      <div class="status">{$trainStatus}</div>
    </div>
    {#if !enoughClasses}
      <div class="hint">Mindestens 3 Klassen erforderlich ({$classes.length}/3)</div>
    {/if}
  </section>

  <!-- Charts -->
  <section class="card">
    <h3>Auswertung</h3>
    <ModelCharts />
  </section>
</div>

<style lang="scss">
  .model-tab {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .row-between {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tab-header {
    padding: 0 2px;
  }
  .section-label {
    font-size: 13px;
    font-weight: 600;
    color: rgb(var(--md-on-surface-variant));
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .card {
    background: rgba(var(--md-surface-variant), 0.25);
    border-radius: var(--md-radius-md);
    padding: 14px;
    h3 {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
    }
  }
  .opt-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .opt {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .opt-label {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    display: inline-flex;
    align-items: center;
  }
  .train-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }
  .train-btn {
    flex: 1;
    font-weight: 600;
  }
  .status {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
  }
  .hint {
    margin-top: 6px;
    text-align: center;
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
  }
</style>
