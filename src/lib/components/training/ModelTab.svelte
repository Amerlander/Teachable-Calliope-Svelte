<script lang="ts">
  import { get } from 'svelte/store';
  import {
    trainingOptions,
    setTrainingOptions,
    classifierModel,
    trainingReadiness,
    draftRoi
  } from '$lib/stores';
  import type { TrainingOptions } from '$lib/stores';
  import {
    activeModel,
    availableModels,
    currentProject,
    deleteTrainedModel,
    getModelById,
    renameTrainedModel,
    type TrainedModel
  } from '$lib/stores/projects';
  import {
    isTraining,
    trainStatus,
    modelTrained,
    modelTabView,
    trainPhase,
    trainEpoch,
    trainTotalEpochs,
    trainProgress
  } from '$lib/stores/app';
  import { trainModel, exportModelToZip } from '$lib/machine';
  import { activateModel, importModelFile, modelLabel } from '$lib/models';
  import { createProgramForModel } from '$lib/programs';
  import { showNotification } from '$lib/stores/notifications';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import InfoTooltip from '$lib/components/ui/InfoTooltip.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import DeleteConfirmDialog, {
    type DeleteTarget
  } from '$lib/components/DeleteConfirmDialog.svelte';
  import ModelHistory from './ModelHistory.svelte';
  import ModelCompareModal from './ModelCompareModal.svelte';
  import { MAX_COMPARED, MIN_COMPARED } from '$lib/compare';

  let loadModelEl: HTMLInputElement = $state()!;

  // Same gate as the classes sidebar CTA that leads here — kept in one place so
  // the button and the hint can't drift apart from the CTA's condition.
  const readiness = $derived($trainingReadiness);
  // Export and delete need a model entry to act on, which an in-memory-only
  // classifier isn't — every model now comes from the list.
  const hasSelectedModel = $derived(!!$activeModel);
  const isPose = $derived($currentProject?.mode === 'pose');

  modelTabView.set(get(classifierModel) ? 'model' : 'new');
  let newModelName = $state('');

  // Composing a new model: name, options and the train button form one entry at
  // the top of the list, and nothing in the list below counts as selected.
  const isNewView = $derived($modelTabView === 'new' && !$isTraining);

  // The column the list lives in. A finished run becomes its first entry, so
  // after training the top is where the user has to be looking.
  let listScrollEl: HTMLDivElement | undefined = $state();

  function startNewModel() {
    if (get(isTraining)) return;
    modelTabView.set('new');
    listScrollEl?.scrollTo({ top: 0 });
  }

  // Only offered once a model exists: with an empty list there is nothing to
  // fall back to, so the composer stays open.
  function closeNewModel() {
    modelTabView.set('model');
  }

  async function doTrain() {
    const gate = get(trainingReadiness);
    if (!gate.ready) {
      showNotification(gate.hint ?? 'Zu wenig Trainingsdaten', { type: 'warning' });
      return;
    }
    const opts = get(trainingOptions);
    const roi = get(draftRoi);
    trainEpoch.set(0);
    trainTotalEpochs.set(opts.epochs);
    isTraining.set(true);
    trainPhase.set('preparing');
    trainStatus.set('Bilder werden vorbereitet…');
    try {
      await trainModel(
        {
          epochs: opts.epochs,
          batchSize: opts.batchSize,
          learningRate: opts.learningRate,
          hiddenUnits: opts.hiddenUnits,
          featureExtractor: opts.featureExtractor,
          optimizer: opts.optimizer,
          dropout: opts.dropout,
          validationSplit: opts.validationSplit,
          earlyStopLoss: opts.earlyStopLoss,
          roi: roi ?? null
        },
        (ep) => {
          if (get(trainPhase) !== 'training') trainPhase.set('training');
          trainEpoch.set(ep + 1);
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
      // Classes, region and extractor were recorded on the model during
      // training (see machine.ts) — nothing to attach after the fact.
      newModelName = '';
      modelTabView.set('model');
      listScrollEl?.scrollTo({ top: 0 });
      // A run with new classes can't be programmed with any existing program,
      // so it brings its own starter along. Previous programs stay untouched
      // and keep running on the models they were built for.
      try {
        const trained = getModelById(id);
        if (trained) {
          createProgramForModel(trained, {
            name: `Starter — ${modelLabel(trained)}`
          });
        }
      } catch {
        /* a starter that fails to generate must not fail the training */
      }
    } catch (err) {
      trainPhase.set('error');
      trainStatus.set('Fehler beim Training');
      showNotification('Fehler: ' + (err as Error).message, { type: 'error' });
    } finally {
      isTraining.set(false);
    }
  }

  // Export/delete act on the selected model, not on whatever classifier happens
  // to sit in memory: the list is the subject of this sidebar.
  async function onExportModel() {
    const model = $activeModel;
    if (!model) {
      showNotification('Kein Modell ausgewählt', { type: 'warning' });
      return;
    }
    try {
      await exportModelToZip(model);
      showNotification('Modell exportiert', { type: 'success' });
    } catch {
      showNotification('Fehler beim Speichern', { type: 'error' });
    }
  }

  async function onImportModelChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      const imported = await importModelFile(input.files[0]);
      if (imported) {
        modelTrained.set(true);
        modelTabView.set('model');
        showNotification(`Modell „${modelLabel(imported)}“ importiert`, { type: 'success' });
      } else {
        showNotification('Modell konnte nicht gelesen werden', { type: 'error' });
      }
    } catch (err) {
      showNotification('Fehler: ' + (err as Error).message, { type: 'error' });
    }
    input.value = '';
  }

  /** The model the confirm dialog is asking about; null keeps it closed. */
  let pendingDelete = $state<DeleteTarget | null>(null);

  function onDeleteModel() {
    const model = $activeModel;
    if (model) pendingDelete = { kind: 'model', model };
  }

  async function runDelete() {
    const t = pendingDelete;
    pendingDelete = null;
    if (t?.kind !== 'model') return;
    deleteTrainedModel(t.model.id);
    // Programs that used it were moved to a fitting model (or left model-less)
    // by the store; here we only have to bring the runtime classifier in line
    // with whatever is selected now.
    const next = get(currentProject)?.currentModelId;
    if (next) {
      await activateModel(next);
    } else {
      classifierModel.set(null);
      modelTrained.set(false);
      modelTabView.set('new');
    }
    showNotification('Modell gelöscht', { type: 'success' });
  }

  function updateOpt<K extends keyof TrainingOptions>(key: K, value: TrainingOptions[K]) {
    setTrainingOptions({ [key]: value } as Partial<TrainingOptions>);
  }

  let augSettingsOpen = $state(false);

  // ---------- Comparing models ----------
  // Picking the models happens in the list itself rather than in a dialog of its
  // own: the numbers that decide which two runs are worth putting next to each
  // other are already on the rows.
  let compareMode = $state(false);
  let compareIds = $state<string[]>([]);
  let compareOpen = $state(false);

  const compareModels = $derived(
    compareIds
      .map((id) => $availableModels.find((m) => m.id === id))
      .filter(Boolean) as TrainedModel[]
  );

  function startCompare() {
    if ($availableModels.length < MIN_COMPARED) {
      showNotification(`Zum Vergleichen braucht es mindestens ${MIN_COMPARED} Modelle`, {
        type: 'warning'
      });
      return;
    }
    compareMode = true;
    // The model in use is the one a comparison usually starts from.
    const current = $currentProject?.currentModelId;
    compareIds = current ? [current] : [];
    modelTabView.set('model');
  }

  function endCompare() {
    compareMode = false;
    compareIds = [];
  }

  function toggleCompare(id: string) {
    if (compareIds.includes(id)) compareIds = compareIds.filter((x) => x !== id);
    else if (compareIds.length < MAX_COMPARED) compareIds = [...compareIds, id];
  }

  function openCompare() {
    if (compareModels.length < MIN_COMPARED) return;
    compareOpen = true;
  }

  function updateAug<K extends keyof TrainingOptions['augmentationSettings']>(
    key: K,
    value: TrainingOptions['augmentationSettings'][K]
  ) {
    const curr = get(trainingOptions).augmentationSettings;
    setTrainingOptions({ augmentationSettings: { ...curr, [key]: value } });
  }
</script>

<div class="model-tab">
  <div class="head">
    <span class="section-label">
      {compareMode ? `Vergleich · ${compareIds.length} ausgewählt` : 'Modelle'}
    </span>
    <div class="head-actions">
      {#if compareMode}
        <button
          type="button"
          class="add-btn"
          onclick={() => (compareIds = [])}
          disabled={!compareIds.length}
        >
          Alle abwählen
        </button>
        <Button variant="ghost" size="small" onclick={endCompare} aria-label="Vergleich verlassen" title="Vergleich verlassen">
          ×
        </Button>
      {:else}
        <!-- Sits above the list because that is where its result appears: the run
             being composed, and afterwards its model, are the first entry. -->
        <button type="button" class="add-btn" onclick={startNewModel} disabled={$isTraining}>
          <span aria-hidden="true">+</span> Neues Modell
        </button>
        <Dropdown placement="bottom-end">
          {#snippet trigger()}
            <Button variant="ghost" size="small" aria-label="Modell-Aktionen" title="Mehr Aktionen">⋯</Button>
          {/snippet}
          {#snippet children()}
            <DropdownItem onclick={onExportModel} disabled={!hasSelectedModel}>
              Modell exportieren
            </DropdownItem>
            <DropdownItem onclick={() => loadModelEl?.click()}>
              Modell importieren
            </DropdownItem>
            <DropdownItem onclick={startCompare} disabled={$availableModels.length < MIN_COMPARED}>
              Modelle vergleichen
            </DropdownItem>
            <DropdownItem onclick={onDeleteModel} disabled={!hasSelectedModel}>
              Modell löschen
            </DropdownItem>
          {/snippet}
        </Dropdown>
      {/if}
      <input
        bind:this={loadModelEl}
        type="file"
        accept=".zip"
        style="display:none"
        onchange={onImportModelChange}
      />
    </div>
  </div>

  <!-- The column scrolls as one, so the run being composed or trained stays part
       of the same list its model joins when it is done. -->
  <div class="list-scroll" bind:this={listScrollEl}>
    {#if $isTraining}
      <!-- Holds the spot the finished run will take, so the list never looks
           idle mid-training. The full progress, curves included, is under the
           video — this only says that something is happening here. -->
      <div class="entry-row training-entry">
        <div class="main">
          <div class="title">
            <span class="title-text">{newModelName.trim() || 'Neues Modell'}</span>
            <span class="chip">trainiert…</span>
          </div>
          <div class="meta">
            <span>
              {$trainPhase === 'preparing'
                ? 'Bilder werden vorbereitet'
                : `Epoche ${$trainEpoch} / ${$trainTotalEpochs}`}
            </span>
            {#if $trainPhase !== 'preparing'}
              <span>·</span>
              <span>{$trainProgress} %</span>
            {/if}
          </div>
          <div class="train-bar" class:indeterminate={$trainPhase === 'preparing'}>
            <div
              class="train-bar-fill"
              style={$trainPhase === 'preparing' ? '' : `width:${$trainProgress}%`}
            ></div>
          </div>
          <div class="classes">Fortschritt und Kurven siehst du unter dem Video.</div>
        </div>
      </div>
    {:else if isNewView}
      <section class="entry-row composer">
        <div class="composer-head">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="composer-name"
            type="text"
            placeholder="Neues Modell (Name)"
            bind:value={newModelName}
            onkeydown={(e) => e.key === 'Enter' && readiness.ready && !$isTraining && doTrain()}
            autofocus
          />
          {#if $availableModels.length}
            <button
              type="button"
              class="composer-close"
              onclick={closeNewModel}
              title="Abbrechen"
              aria-label="Abbrechen"
            >×</button>
          {/if}
        </div>
        <div class="composer-body">
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
            <div class="opt-grid">
              {#if !isPose}
                <label class="opt">
                  <span class="opt-label">
                    Feature-Extraktor
                    <InfoTooltip
                      text="Basis-CNN, das Bilder in Merkmalsvektoren umwandelt. v3 Large ist der Standard, v4 Medium trifft am genauesten (dafür 32 MB Download), v4 Small ist der beste Kompromiss aus Größe und Genauigkeit, v3 Small und Lite laufen am schnellsten auf schwacher Hardware."
                    />
                  </span>
                  <select
                    value={$trainingOptions.featureExtractor}
                    onchange={(e) => updateOpt('featureExtractor', (e.target as HTMLSelectElement).value as any)}
                  >
                    <option value="mobilenet-v3-large">MobileNet v3 Large (α=1.0, ~16 MB, Standard)</option>
                    <option value="mobilenet-v1">MobileNet v1 (α=1.0, ~16 MB, bewährt)</option>
                    <option value="mobilenet-v2">MobileNet v2 (α=1.0, ~14 MB)</option>
                    <option value="mobilenet-v4-medium">MobileNet v4 Medium (~32 MB, am genauesten)</option>
                    <option value="mobilenet-v4-small">MobileNet v4 Small (~10 MB, genau und klein)</option>
                    <option value="mobilenet-v3-small">MobileNet v3 Small (α=1.0, ~6 MB, schnell)</option>
                    <option value="mobilenet-v1-lite">MobileNet v1 Lite (α=0.5, ~5 MB, schneller)</option>
                  </select>
                </label>
              {/if}

              <label class="opt">
                <span class="opt-label">
                  Optimierer
                  <InfoTooltip
                    text="Algorithmus, der die Gewichte des Modells anpasst. Adam funktioniert für die meisten Fälle. SGD ist robuster für große Datensätze, RMSProp für rauschige."
                  />
                </span>
                <select
                  value={$trainingOptions.optimizer}
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
                  value={$trainingOptions.dropout}
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
                  value={$trainingOptions.validationSplit}
                  onchange={(e) => updateOpt('validationSplit', +((e.target as HTMLInputElement).value))}
                />
              </label>

              <label class="opt">
                <span class="opt-label">
                  Stop-Loss
                  <InfoTooltip
                    text="Frühzeitiger Abbruch: Training stoppt, sobald der Trainings-Loss unter diesen Wert fällt. 0 = kein frühzeitiger Abbruch."
                  />
                </span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.005"
                  value={$trainingOptions.earlyStopLoss}
                  onchange={(e) => updateOpt('earlyStopLoss', +((e.target as HTMLInputElement).value))}
                />
              </label>

              {#if !isPose}
              <div class="opt aug-opt">
                <span class="opt-label">
                  Daten-Augmentierung
                  <InfoTooltip
                    text="Erzeugt zufällig gespiegelte, gedrehte, heller/dunkler und leicht gezoomte Varianten deiner Bilder, damit das Modell robuster wird."
                  />
                </span>
                <div class="aug-row">
                  <select
                    value={$trainingOptions.augmentation ? 'on' : 'off'}
                    onchange={(e) => updateOpt('augmentation', (e.target as HTMLSelectElement).value === 'on')}
                  >
                    <option value="off">Aus</option>
                    <option value="on">An</option>
                  </select>
                  <button
                    type="button"
                    class="aug-settings-btn"
                    disabled={!$trainingOptions.augmentation}
                    onclick={() => (augSettingsOpen = !augSettingsOpen)}
                    aria-label="Augmentierung konfigurieren"
                    title="Augmentierung konfigurieren"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09c0 .66.39 1.25 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.26.61.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.39-1.51 1z"/>
                    </svg>
                  </button>
                </div>
              </div>
              {/if}
            </div>

            {#if !isPose && augSettingsOpen && $trainingOptions.augmentation}
              {@const a = $trainingOptions.augmentationSettings}
              <div class="aug-settings">
                <div class="aug-settings-head">Augmentierungs-Details</div>
                <div class="opt-grid">
                  <label class="opt">
                    <span class="opt-label">Horizontal spiegeln</span>
                    <select
                      value={a.horizontalFlip ? 'on' : 'off'}
                      onchange={(e) => updateAug('horizontalFlip', (e.target as HTMLSelectElement).value === 'on')}
                    >
                      <option value="off">Aus</option>
                      <option value="on">An</option>
                    </select>
                  </label>
                  <label class="opt">
                    <span class="opt-label">Rotation (±°)</span>
                    <input
                      type="number" min="0" max="45" step="1"
                      value={a.rotationDegrees}
                      onchange={(e) => updateAug('rotationDegrees', +((e.target as HTMLInputElement).value))}
                    />
                  </label>
                  <label class="opt">
                    <span class="opt-label">Helligkeit (±)</span>
                    <input
                      type="number" min="0" max="0.5" step="0.05"
                      value={a.brightnessJitter}
                      onchange={(e) => updateAug('brightnessJitter', +((e.target as HTMLInputElement).value))}
                    />
                  </label>
                  <label class="opt">
                    <span class="opt-label">Zoom-Jitter (±)</span>
                    <input
                      type="number" min="0" max="0.5" step="0.05"
                      value={a.zoomJitter}
                      onchange={(e) => updateAug('zoomJitter', +((e.target as HTMLInputElement).value))}
                    />
                  </label>
                  <label class="opt">
                    <span class="opt-label">Extra-Kopien pro Bild</span>
                    <input
                      type="number" min="0" max="6" step="1"
                      value={a.multiplier}
                      onchange={(e) => updateAug('multiplier', +((e.target as HTMLInputElement).value))}
                    />
                  </label>
                </div>
              </div>
            {/if}
          </details>
          <div class="train-row">
            <Button class="train-btn" fullWidth disabled={!readiness.ready} onclick={doTrain}>
              Trainieren
            </Button>
          </div>
          <!-- Either what is still missing, or — once the run can go ahead —
               that the half-filled classes are being left out of it. -->
          {#if readiness.hint}
            <div class="hint">{readiness.hint}</div>
          {:else if readiness.ignoredHint}
            <div class="hint">{readiness.ignoredHint}</div>
          {/if}
        </div>
      </section>
    {/if}

    <ModelHistory
      highlightActive={$modelTabView === 'model'}
      onselect={() => modelTabView.set('model')}
      selectable={compareMode}
      selectedIds={compareIds}
      ontoggle={toggleCompare}
    />
  </div>

  {#if compareMode}
    <!-- Sits below the list, where the selection it counts is. -->
    <div class="compare-bar">
      <span class="hint">
        {MIN_COMPARED} bis {MAX_COMPARED} Modelle · {compareIds.length} ausgewählt
      </span>
      <Button size="small" disabled={compareIds.length < MIN_COMPARED} onclick={openCompare}>
        Vergleichen ({compareIds.length})
      </Button>
    </div>
  {/if}
</div>

<ModelCompareModal bind:isOpen={compareOpen} models={compareModels} />

<DeleteConfirmDialog
  target={pendingDelete}
  onconfirm={runDelete}
  oncancel={() => (pendingDelete = null)}
/>

<style lang="scss">
  // The rows here are the same cards the program list is built from — see
  // src/lib/styles/_lists.scss.
  @use '../../styles/lists' as *;

  // Head stays put, the list below takes whatever height is left: this sidebar
  // is the model list, not a form with a list on top of it.
  .model-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .head {
    @include entry-head;
    flex-shrink: 0;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .compare-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 2px 2px;
    border-top: 1px solid rgb(var(--md-outline-variant));
    .hint {
      font-size: 11.5px;
      color: rgb(var(--md-on-surface-variant));
      margin-right: auto;
    }
  }
  .add-btn { @include entry-add-btn; }
  .list-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 4px;
  }

  .entry-row { @include entry-row; }
  // Neither of the two rows above the list is a choice, so nothing in them
  // reacts to being pointed at.
  .main { @include entry-main; cursor: default; }
  .title { @include entry-title; }
  .title-text { @include entry-title-text; }
  .chip { @include entry-chip; }
  .meta { @include entry-meta; }
  .classes { @include entry-classes; }

  .training-entry {
    border-color: rgb(var(--md-primary));
    background: rgba(var(--md-primary-container), 0.5);
    &:hover {
      background: rgba(var(--md-primary-container), 0.5);
      box-shadow: none;
    }
  }
  .train-bar {
    height: 6px;
    border-radius: 999px;
    background: rgba(var(--md-on-surface), 0.12);
    overflow: hidden;
  }
  .train-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: rgb(var(--md-primary));
    transition: width 0.3s;
  }
  // Before the first epoch there is no percentage to show, so the bar sweeps
  // instead of standing at zero.
  .train-bar.indeterminate .train-bar-fill {
    width: 40%;
    animation: train-sweep 1.4s ease-in-out infinite;
  }
  @keyframes train-sweep {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  // The same card as an entry, opened up: the name the run will be saved under,
  // then everything it needs, then the button that starts it.
  .composer {
    border-color: rgb(var(--md-primary));
    background: rgba(var(--md-primary-container), 0.3);
    &:hover { box-shadow: none; }
  }
  .composer-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 0 10px;
  }
  .composer-name {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 6px 0;
    font: inherit;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    &:focus {
      outline: none;
      border: none;
    }
  }
  .composer-close {
    width: 24px;
    height: 24px;
    min-height: unset;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: transparent;
    box-shadow: none;
    color: rgb(var(--md-on-surface-variant));
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    &:hover {
      background: rgba(var(--md-on-surface), 0.08);
      color: rgb(var(--md-on-surface));
    }
  }
  .composer-body {
    padding: 6px 12px 12px;
    h3 {
      margin: 0 0 10px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgb(var(--md-on-surface-variant));
    }
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
  .aug-opt {
    .aug-row {
      display: flex;
      gap: 6px;
      align-items: center;
      select { flex: 1; }
    }
  }
  .aug-settings-btn {
    width: 30px;
    height: 30px;
    min-height: unset;
    padding: 0;
    border: 1px solid rgb(var(--md-outline));
    border-radius: var(--md-radius-sm);
    background: rgb(var(--md-surface));
    color: rgb(var(--md-on-surface-variant));
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: none;
    flex-shrink: 0;
    &:hover:not(:disabled) {
      background: rgba(var(--md-primary), 0.08);
      border-color: rgb(var(--md-primary));
      color: rgb(var(--md-primary));
    }
    &:disabled { opacity: 0.35; cursor: not-allowed; }
  }
  .aug-settings {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: var(--md-radius-sm);
    background: rgba(var(--md-primary-container), 0.35);
    border-left: 3px solid rgb(var(--md-primary));
    .aug-settings-head {
      font-size: 12px;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
      margin-bottom: 8px;
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
