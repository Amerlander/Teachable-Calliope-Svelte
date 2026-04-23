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
  import { updateProject, currentProject, renameTrainedModel } from '$lib/stores/projects';
  import { isTraining, trainStatus, modelTrained, modelTabView } from '$lib/stores/app';
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
  import Button from '$lib/components/ui/Button.svelte';
  import ModelStats from './ModelStats.svelte';
  import ModelCharts from './ModelCharts.svelte';
  import ModelHistory from './ModelHistory.svelte';
  import ModelDetailsModal from './ModelDetailsModal.svelte';

  let loadModelEl: HTMLInputElement = $state()!;
  let detailsOpen = $state(false);

  const enoughClasses = $derived($classes.length >= 3);
  const hasArtifacts = $derived(!!$classifierModel);

  modelTabView.set(get(classifierModel) ? 'model' : 'new');
  let newModelName = $state('');

  // Training progress
  let trainEpoch = $state(0);
  let trainTotalEpochs = $state(0);
  const trainProgress = $derived(
    trainTotalEpochs ? Math.min(100, Math.round((trainEpoch / trainTotalEpochs) * 100)) : 0
  );

  async function doTrain() {
    if ($classes.length < 3) {
      showNotification('Mindestens 3 Klassen erforderlich', { type: 'warning' });
      return;
    }
    const opts = get(trainingOptions);
    trainEpoch = 0;
    trainTotalEpochs = opts.epochs;
    isTraining.set(true);
    trainStatus.set('Training läuft…');
    try {
      await trainModel(
        {
          epochs: opts.epochs,
          batchSize: opts.batchSize,
          learningRate: opts.learningRate,
          hiddenUnits: opts.hiddenUnits
        },
        (ep) => {
          trainEpoch = ep + 1;
          trainStatus.set(`Epoche ${ep + 1}/${opts.epochs}`);
        }
      );
      modelTrained.set(true);
      trainStatus.set('Training abgeschlossen');
      showNotification('Training abgeschlossen', { type: 'success' });
      const label = newModelName.trim();
      if (label) {
        const id = get(currentProject)?.currentModelId;
        if (id) renameTrainedModel(id, label);
      }
      newModelName = '';
      modelTabView.set('model');
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
  <!-- Models list (top, like classes) -->
  <div class="section">
    <div class="row-between">
      <span class="section-label">Modelle</span>
      <Dropdown placement="bottom-end">
        {#snippet trigger()}
          <Button variant="ghost" size="small" aria-label="Modell-Aktionen" title="Mehr Aktionen">⋯</Button>
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

    <ModelHistory onselect={() => (modelTabView.set('model'))} />

    <!-- "Train new" row: input for the model name (mirrors new-class-row in Classes tab) -->
    <div class="train-new-row" class:selected={$modelTabView === 'new'}>
      <input
        class="train-new-input"
        type="text"
        placeholder="Neues Modell (Name)"
        bind:value={newModelName}
        onfocus={() => (modelTabView.set('new'))}
        onkeydown={(e) => e.key === 'Enter' && enoughClasses && !$isTraining && doTrain()}
      />
      <Button
        size="small"
        disabled={!enoughClasses || $isTraining}
        onclick={doTrain}
        title={enoughClasses ? 'Neues Modell trainieren' : 'Mindestens 3 Klassen erforderlich'}
        aria-label="Neues Modell trainieren"
      >
        +
      </Button>
    </div>
  </div>

  <hr />

  <!-- Body: depends on view / training state -->
  {#if $isTraining}
    <section class="card training-card">
      <h3>Training läuft…</h3>
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:{trainProgress}%"></div></div>
        <div class="progress-label">
          Epoche {trainEpoch} / {trainTotalEpochs} · {trainProgress}%
        </div>
      </div>
      <div class="training-detail">{$trainStatus}</div>
      <div class="training-hint">
        Das Modell lernt gerade aus deinen Bildern. Das kann je nach Anzahl der Klassen
        und Bilder ein paar Sekunden bis einige Minuten dauern.
      </div>
    </section>
  {:else if $modelTabView === 'model'}
    {#if hasArtifacts}
      <section class="card">
        <div class="card-head">
          <h3>Überblick</h3>
          <Button variant="ghost" size="small" onclick={() => (detailsOpen = true)}>
            Details…
          </Button>
        </div>
        <ModelStats />
      </section>

      <section class="card">
        <h3>Auswertung</h3>
        <ModelCharts />
      </section>
    {:else}
      <div class="empty">Wähle ein Modell aus der Liste oder trainiere ein neues.</div>
    {/if}
  {:else}
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
        <Button class="train-btn" fullWidth disabled={!enoughClasses} onclick={doTrain}>
          Trainieren
        </Button>
      </div>
      {#if !enoughClasses}
        <div class="hint">Mindestens 3 Klassen erforderlich ({$classes.length}/3)</div>
      {/if}
    </section>
  {/if}
</div>

<ModelDetailsModal bind:isOpen={detailsOpen} />

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
    margin-bottom: 6px;
  }
  .section {
    display: flex;
    flex-direction: column;
  }
  .section-label {
    font-size: 13px;
    font-weight: 600;
    color: rgb(var(--md-on-surface-variant));
    margin-bottom: 4px;
  }
  hr {
    border: none;
    border-top: 1px solid rgba(var(--md-outline-variant), 0.5);
    margin: 12px 0;
  }
  .train-new-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    margin-top: 6px;
    border: 1px dashed rgba(var(--md-outline), 0.7);
    border-radius: var(--md-radius-md);
    background: transparent;
    transition: all 0.15s;
    &:focus-within,
    &.selected {
      border-style: solid;
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary-container), 0.3);
    }
  }
  .train-new-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 6px 8px;
    font: inherit;
    color: rgb(var(--md-on-surface));
    &:focus {
      outline: none;
      border: none;
      padding: 6px 8px;
    }
  }
  .train-new-row :global(button) {
    width: 32px;
    min-width: 32px;
    height: 32px;
    min-height: 32px;
    padding: 0;
    font-size: 18px;
    font-weight: 500;
    line-height: 1;
    flex-shrink: 0;
    box-shadow: none;
  }
  .training-card h3 {
    color: rgb(var(--md-primary));
  }
  .progress-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .progress-bar {
    height: 10px;
    background: rgb(var(--md-surface-variant));
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: rgb(var(--md-primary));
    border-radius: 999px;
    transition: width 0.3s;
  }
  .progress-label {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    font-variant-numeric: tabular-nums;
  }
  .training-detail {
    font-size: 13px;
    font-weight: 500;
    color: rgb(var(--md-on-surface));
    margin-bottom: 6px;
  }
  .training-hint {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    line-height: 1.5;
  }
  .empty {
    padding: 16px;
    text-align: center;
    font-size: 13px;
    color: rgb(var(--md-on-surface-variant));
    font-style: italic;
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
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    h3 {
      margin: 0;
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
  .train-row :global(.train-btn) {
    font-weight: 600;
  }
  .hint {
    margin-top: 6px;
    text-align: center;
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
  }
</style>
