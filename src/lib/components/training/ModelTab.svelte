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
  import { updateProject, currentProject, renameTrainedModel, setTrainedModelRoi } from '$lib/stores/projects';
  import { isTraining, trainStatus, modelTrained, modelTabView, draftRoi, roiEditing, trainPhase } from '$lib/stores/app';
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
    trainPhase.set('preparing');
    trainStatus.set('Bilder werden vorbereitet…');
    try {
      await trainModel(
        {
          epochs: opts.epochs,
          batchSize: opts.batchSize,
          learningRate: opts.learningRate,
          hiddenUnits: opts.hiddenUnits
        },
        (ep) => {
          if (get(trainPhase) !== 'training') trainPhase.set('training');
          trainEpoch = ep + 1;
          trainStatus.set(`Epoche ${ep + 1}/${opts.epochs}`);
        }
      );
      modelTrained.set(true);
      trainPhase.set('done');
      trainStatus.set('Training abgeschlossen');
      showNotification('Training abgeschlossen', { type: 'success' });
      const id = get(currentProject)?.currentModelId;
      const label = newModelName.trim();
      if (id && label) renameTrainedModel(id, label);
      const roi = get(draftRoi);
      if (id && roi) setTrainedModelRoi(id, roi);
      newModelName = '';
      modelTabView.set('model');
      try {
        const project = generateMakeCodeProject('Teachable Project', get(classes), get(examples));
        importMcProject(project);
      } catch {
        /* ignore */
      }
    } catch (err) {
      trainPhase.set('error');
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

  <div class="tab-body">
  <!-- Body: depends on view / training state -->
  {#if $isTraining}
    <section class="card training-card">
      <h3>{$trainPhase === 'preparing' ? 'Vorbereitung…' : 'Training läuft…'}</h3>
      <div class="phase-steps">
        <div class="phase-step" class:done={$trainPhase !== 'preparing'} class:active={$trainPhase === 'preparing'}>
          <span class="phase-dot"></span>
          <span>Bilder vorbereiten (Feature-Extraktion)</span>
          {#if $trainPhase === 'preparing'}<span class="spinner"></span>{/if}
        </div>
        <div class="phase-step" class:active={$trainPhase === 'training'}>
          <span class="phase-dot"></span>
          <span>Modell trainieren</span>
        </div>
      </div>

      {#if $trainPhase === 'training'}
        <div class="progress-wrap">
          <div class="progress-bar"><div class="progress-fill" style="width:{trainProgress}%"></div></div>
          <div class="progress-label">
            Epoche {trainEpoch} / {trainTotalEpochs} · {trainProgress}%
          </div>
        </div>
      {:else}
        <div class="progress-wrap">
          <div class="progress-bar indeterminate"><div class="progress-fill"></div></div>
          <div class="progress-label">Features werden aus deinen Bildern berechnet…</div>
        </div>
      {/if}
      <div class="training-detail">{$trainStatus}</div>
      <div class="training-hint">
        Das Modell lernt gerade aus deinen Bildern. Das kann je nach Anzahl der Klassen
        und Bilder ein paar Sekunden bis einige Minuten dauern.
      </div>

      {#if $trainPhase === 'training'}
        <div class="live-chart">
          <ModelCharts initialTab="accuracy" />
        </div>
      {/if}
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

      <details class="advanced">
        <summary>Erweiterte Optionen</summary>
        <div class="adv-note">
          Hinweis: einige dieser Parameter werden in der aktuellen Trainings-Pipeline
          noch nicht angewendet. Sie werden mit dem Projekt gespeichert und für die
          kommende, erweiterte Pipeline vorbereitet.
        </div>
        <div class="opt-grid">
          <label class="opt">
            <span class="opt-label">
              Feature-Extraktor
              <InfoTooltip
                text="Basis-CNN, das Bilder in Merkmalsvektoren umwandelt. MobileNet v1 ist schnell und klein und läuft auch im Browser gut. Andere Extraktoren sind vorbereitet, aber noch nicht aktiv."
              />
            </span>
            <select
              value={$trainingOptions.featureExtractor ?? 'mobilenet-v1'}
              onchange={(e) => updateOpt('featureExtractor', (e.target as HTMLSelectElement).value as any)}
            >
              <option value="mobilenet-v1">MobileNet v1 (aktiv)</option>
              <option value="mobilenet-v2">MobileNet v2</option>
              <option value="squeezenet">SqueezeNet</option>
              <option value="resnet50">ResNet-50</option>
              <option value="inception-v3">Inception v3</option>
            </select>
          </label>

          <label class="opt">
            <span class="opt-label">
              Optimierer
              <InfoTooltip
                text="Algorithmus, der die Gewichte des Modells anpasst. Adam funktioniert für die meisten Fälle. SGD ist robuster für große Datensätze."
              />
            </span>
            <select
              value={$trainingOptions.optimizer ?? 'adam'}
              onchange={(e) => updateOpt('optimizer', (e.target as HTMLSelectElement).value as any)}
            >
              <option value="adam">Adam</option>
              <option value="sgd">SGD</option>
              <option value="rmsprop">RMSProp</option>
            </select>
          </label>

          <label class="opt">
            <span class="opt-label">
              Dropout
              <InfoTooltip
                text="Anteil der Neuronen, die beim Training zufällig deaktiviert werden. Reduziert Überanpassung. 0 = aus, 0.5 = aggressiv."
              />
            </span>
            <input
              type="number"
              min="0"
              max="0.9"
              step="0.05"
              value={$trainingOptions.dropout ?? 0}
              onchange={(e) => updateOpt('dropout', +((e.target as HTMLInputElement).value))}
            />
          </label>

          <label class="opt">
            <span class="opt-label">
              Validierungs-Split
              <InfoTooltip
                text="Anteil der Bilder, die als Validierungsdaten zurückgehalten werden (0 – 0.5). Zeigt, wie gut das Modell auf ungesehenen Bildern funktioniert."
              />
            </span>
            <input
              type="number"
              min="0"
              max="0.5"
              step="0.05"
              value={$trainingOptions.validationSplit ?? 0}
              onchange={(e) => updateOpt('validationSplit', +((e.target as HTMLInputElement).value))}
            />
          </label>

          <label class="opt">
            <span class="opt-label">
              Stop-Loss
              <InfoTooltip
                text="Frühzeitiger Abbruch: Training stoppt, sobald der Loss unter diesen Wert fällt. 0 = kein frühzeitiger Abbruch."
              />
            </span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.005"
              value={$trainingOptions.earlyStopLoss ?? 0}
              onchange={(e) => updateOpt('earlyStopLoss', +((e.target as HTMLInputElement).value))}
            />
          </label>

          <label class="opt">
            <span class="opt-label">
              Daten-Augmentierung
              <InfoTooltip
                text="Erzeugt leicht veränderte Varianten deiner Bilder (Spiegeln, Rotation, Helligkeit), damit das Modell robuster wird."
              />
            </span>
            <select
              value={$trainingOptions.augmentation ? 'on' : 'off'}
              onchange={(e) => updateOpt('augmentation', (e.target as HTMLSelectElement).value === 'on')}
            >
              <option value="off">Aus</option>
              <option value="on">An</option>
            </select>
          </label>
        </div>
      </details>

      <div class="roi-section">
        <div class="roi-head">
          <span class="opt-label">
            Bildbereich (ROI)
            <InfoTooltip
              text="Begrenzt den Trainings- und Erkennungsbereich auf einen Ausschnitt des Kamerabildes. Wird mit dem trainierten Modell gespeichert."
            />
          </span>
          <Button
            variant={$roiEditing ? 'active' : 'ghost'}
            size="small"
            onclick={() => roiEditing.update((v) => !v)}
          >
            {$roiEditing ? 'Fertig' : $draftRoi ? 'ROI ändern' : 'ROI wählen'}
          </Button>
        </div>
        {#if $draftRoi}
          <div class="roi-meta">
            <span class="roi-chip">
              {Math.round($draftRoi.w * 100)}×{Math.round($draftRoi.h * 100)}%
              &nbsp;@&nbsp;({Math.round($draftRoi.x * 100)}, {Math.round($draftRoi.y * 100)})
            </span>
            <button
              type="button"
              class="roi-clear"
              onclick={() => { draftRoi.set(null); roiEditing.set(false); }}
            >
              Entfernen
            </button>
          </div>
        {:else}
          <div class="hint">Kein ROI – gesamtes Kamerabild wird verwendet.</div>
        {/if}
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
</div>

<ModelDetailsModal bind:isOpen={detailsOpen} />

<style lang="scss">
  .model-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .tab-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
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
    flex-shrink: 0;
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
  .progress-bar.indeterminate {
    overflow: hidden;
    .progress-fill {
      width: 40%;
      animation: indeterminate 1.4s ease-in-out infinite;
    }
  }
  @keyframes indeterminate {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }
  .phase-steps {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    .phase-step {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      &.active { color: rgb(var(--md-on-surface)); font-weight: 600; }
      &.done { color: rgb(var(--md-on-surface-variant)); opacity: 0.7; }
    }
    .phase-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 2px solid currentColor;
      flex-shrink: 0;
    }
    .phase-step.active .phase-dot { background: rgb(var(--md-primary)); border-color: rgb(var(--md-primary)); }
    .phase-step.done .phase-dot   { background: rgb(var(--md-tertiary)); border-color: rgb(var(--md-tertiary)); }
  }
  .advanced {
    margin-top: 12px;
    background: rgba(var(--md-surface-variant), 0.25);
    border-radius: var(--md-radius-md);
    padding: 8px 12px;
    summary {
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
      list-style: none;
      padding: 4px 0;
      user-select: none;
      &::-webkit-details-marker { display: none; }
      &::before {
        content: '▸';
        display: inline-block;
        margin-right: 6px;
        transition: transform 0.15s;
      }
    }
    &[open] summary::before { transform: rotate(90deg); }
    .adv-note {
      font-size: 11px;
      color: rgb(var(--md-on-surface-variant));
      font-style: italic;
      margin: 6px 0 10px;
      line-height: 1.4;
    }
    select {
      padding: 6px 8px;
      border: 1px solid rgb(var(--md-outline));
      border-radius: var(--md-radius-sm);
      background: rgb(var(--md-surface));
      color: rgb(var(--md-on-surface));
      font: inherit;
      font-size: 12px;
    }
  }
  .live-chart {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px dashed rgba(var(--md-outline-variant), 0.7);
  }
  .roi-section {
    margin-top: 12px;
    padding: 10px 12px;
    background: rgba(var(--md-surface-variant), 0.35);
    border-radius: var(--md-radius-md);
    display: flex;
    flex-direction: column;
    gap: 6px;
    .roi-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .opt-label {
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      display: inline-flex;
      align-items: center;
    }
    .roi-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .roi-chip {
      flex: 1;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      padding: 4px 8px;
      background: rgb(var(--md-surface));
      border: 1px solid rgb(var(--md-outline-variant));
      border-radius: var(--md-radius-sm);
    }
    .roi-clear {
      background: transparent;
      border: none;
      color: rgb(var(--md-on-surface-variant));
      font: inherit;
      font-size: 12px;
      text-decoration: underline;
      cursor: pointer;
      padding: 0 4px;
      min-height: unset;
      box-shadow: none;
      &:hover { color: rgb(var(--md-primary)); }
    }
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
