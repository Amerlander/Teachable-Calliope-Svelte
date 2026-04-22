<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import {
    classes, addClass, examples, activeClass, setActiveClass,
    pushExample, clearClass, videoRefs, modelMetadata, trainingHistory,
    classifierModel, removeClass
  } from '$lib/stores';
  import { showNotification } from '$lib/stores/notifications';
  import { currentLang, t, isTraining, modelTrained, trainStatus } from '$lib/stores/app';
  import ClassItem from './ClassItem.svelte';
  import Thumbs from '$lib/components/Thumbs.svelte';
  import ImportDialog from '$lib/components/ImportDialog.svelte';
  import ModelDetailsDialog from '$lib/components/ModelDetailsDialog.svelte';
  import {
    trainModel, captureFrameFromVideo, processZipFile,
    downloadClassImages, downloadAllClassImages,
    loadModelFromZip, saveModelToZip
  } from '$lib/machine';
  import { generateMakeCodeProject, importProject, downloadMakeCodeProject } from '$lib/makecode';

  const lang = $derived($currentLang);

  let newClassName = $state('');
  let epochs = $state(30);
  let isCapturing = $state(false);
  let captureInterval: ReturnType<typeof setInterval> | null = null;
  let detailsOpen = $state(false);
  let modelInfo = $state('');
  let importDialogOpen = $state(false);
  let importDialogImages = $state<string[]>([]);
  let importDetectedClass = $state<string | null>(null);

  // File input refs
  let filesInputEl: HTMLInputElement;
  let loadModelEl: HTMLInputElement;
  let importProjectEl: HTMLInputElement;

  // Reactively compute step visibility
  const hasClasses   = $derived($classes.length > 0);
  const hasEnough    = $derived($classes.length >= 2);
  const hasTrained   = $derived($modelTrained);

  $effect(() => {
    const m = $modelMetadata;
    if (m?.date) modelInfo = `${m.name || 'Modell'} – ${new Date(m.date).toLocaleString()}`;
  });

  function createClass() {
    if (!newClassName.trim()) return;
    addClass(newClassName.trim());
    newClassName = '';
  }

  function onNewClassKey(e: KeyboardEvent) { if (e.key === 'Enter') createClass(); }

  function selectClass(name: string) { setActiveClass(name); }

  function startCapture() {
    const cls = get(activeClass);
    if (!cls) { showNotification('Bitte zuerst eine Klasse wählen', { type: 'warning' }); return; }
    const vid = get(videoRefs).webcam;
    if (!vid) { showNotification('Kamera nicht verbunden', { type: 'error' }); return; }
    isCapturing = true;
    const doCapture = () => {
      const v = get(videoRefs).webcam;
      if (!v || !get(activeClass)) return;
      const data = captureFrameFromVideo(v);
      pushExample(get(activeClass)!, data);
    };
    doCapture();
    captureInterval = setInterval(doCapture, 80);
  }

  function stopCapture() {
    isCapturing = false;
    if (captureInterval) { clearInterval(captureInterval); captureInterval = null; }
  }

  async function doTrain() {
    if ($classes.length < 2) { showNotification('Mindestens 2 Klassen erforderlich', { type: 'warning' }); return; }
    isTraining.set(true);
    trainStatus.set('Training läuft…');
    try {
      await trainModel(epochs, (ep) => {
        trainStatus.set(`Epoche ${ep + 1}/${epochs}`);
      });
      modelTrained.set(true);
      trainStatus.set('Training abgeschlossen');
      showNotification('Training abgeschlossen!', { type: 'success' });
      try {
        const project = generateMakeCodeProject('Teachable Project', get(classes), get(examples));
        importProject(project);
      } catch { /* ignore */ }
    } catch (err) {
      trainStatus.set('Fehler beim Training');
      showNotification('Fehler: ' + (err as Error).message, { type: 'error' });
    } finally {
      isTraining.set(false);
    }
  }

  async function onFilesChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;
    if (!get(activeClass)) { showNotification('Bitte zuerst eine Klasse wählen', { type: 'warning' }); input.value = ''; return; }
    for (const file of Array.from(files)) {
      if (file.name.endsWith('.zip')) {
        try {
          const result = await processZipFile(file);
          const imgs = result.images || [];
          const det = result.detectedClass;
          if (det && get(classes).includes(det)) {
            imgs.forEach(url => pushExample(det, url));
          } else if (get(activeClass) && imgs.length > 0) {
            imgs.forEach(url => pushExample(get(activeClass)!, url));
          } else {
            importDialogImages = imgs;
            importDetectedClass = det || null;
            importDialogOpen = true;
          }
        } catch (err) {
          showNotification('Fehler beim Verarbeiten: ' + (err as Error).message, { type: 'error' });
        }
      } else {
        const reader = new FileReader();
        reader.onload = ev => pushExample(get(activeClass)!, ev.target?.result as string);
        reader.readAsDataURL(file);
      }
    }
    input.value = '';
  }

  function onImportConfirm(e: CustomEvent<{ images: string[]; selectedClass: string | null }>) {
    const { images, selectedClass } = e.detail;
    if (selectedClass) {
      images.forEach(im => pushExample(selectedClass, im));
      setActiveClass(selectedClass);
      showNotification(`${images.length} Bilder importiert in "${selectedClass}"`, { type: 'success' });
    }
    importDialogOpen = false;
  }

  function onImportCancel() { importDialogOpen = false; importDialogImages = []; importDetectedClass = null; }

  async function onLoadModelChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      await loadModelFromZip(input.files[0]);
      modelTrained.set(true);
      modelInfo = 'Modell geladen';
      showNotification('Modell geladen', { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
    }
    input.value = '';
  }

  async function onSaveModel() {
    const model = get(classifierModel);
    if (!model) { showNotification('Kein Modell vorhanden', { type: 'warning' }); return; }
    try {
      await saveModelToZip(model, get(modelMetadata));
      showNotification('Modell gespeichert', { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Speichern', { type: 'error' });
    }
  }

  async function onDownloadProject() {
    try {
      await downloadMakeCodeProject('Teachable Project', get(classes), get(examples));
      showNotification('Projekt heruntergeladen', { type: 'success' });
    } catch (err) {
      showNotification('Fehler: ' + (err as Error).message, { type: 'error' });
    }
  }

  function onActiveClassChange(e: Event) {
    setActiveClass((e.target as HTMLSelectElement).value);
  }

  async function onImportProjectChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const files: Record<string, string> = {};
      for (const path of Object.keys(zip.files)) {
        if (zip.files[path].dir) continue;
        try { files[path.split('/').pop() || path] = await zip.files[path].async('string'); } catch { /* binary */ }
      }
      importProject({ header: { name: file.name }, files });
      showNotification('Projekt importiert', { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Importieren des Projekts', { type: 'error' });
    }
    input.value = '';
  }
</script>

<div class="left-panel panel">
  <!-- New class input -->
  <div class="section">
    <label for="new-class-name">{t('training.newClass', lang)}</label>
    <div class="row" style="margin-top:4px;">
      <input
        id="new-class-name"
        type="text"
        placeholder={t('training.newClassPlaceholder', lang)}
        bind:value={newClassName}
        onkeydown={onNewClassKey}
      />
      <button onclick={createClass} style="min-width:40px;">+</button>
    </div>
  </div>

  <!-- Step 1: class list -->
  {#if hasClasses}
    <div class="section" style="margin-top:12px;">
      <div class="row-between">
        <span class="section-label">{t('training.classes', lang)}</span>
        <button class="ghost small" onclick={() => downloadAllClassImages($examples)}>
          {t('training.downloadAll', lang)}
        </button>
      </div>
      <div class="class-list">
        {#each $classes as cls}
          <ClassItem
            name={cls}
            count={($examples[cls] || []).length}
            selected={$activeClass === cls}
            onselect={() => selectClass(cls)}
            onclear={() => clearClass(cls)}
            ondelete={() => removeClass(cls)}
            ondownload={() => downloadClassImages(cls, $examples[cls] || [])}
          />
        {/each}
      </div>
    </div>
  {/if}

  <!-- Step 2: active class + capture -->
  {#if hasClasses}
    <hr />
    <div class="section">
      <label for="active-class">{t('training.activeClass', lang)}</label>
      <select id="active-class" value={$activeClass} onchange={onActiveClassChange} style="margin-top:4px;">
        {#each $classes as cls}
          <option value={cls}>{cls}</option>
        {/each}
      </select>

      <div class="capture-actions" style="margin-top:8px;">
        <button
          class={isCapturing ? 'active-btn' : ''}
          onmousedown={startCapture}
          onmouseup={stopCapture}
          onmouseleave={stopCapture}
          ontouchstart={startCapture}
          ontouchend={stopCapture}
        >
          {isCapturing ? t('training.stopCapture', lang) : t('training.startCapture', lang)}
        </button>

        <label class="file-label" for="file-input">
          {t('training.files', lang)}
          <input
            id="file-input"
            type="file"
            accept="image/*,.zip"
            multiple
            style="display:none"
            onchange={onFilesChange}
          />
        </label>
      </div>

      <div class="button-hint">{t('training.captureHint', lang)}</div>

      {#if $activeClass}
        <div class="capture-count">
          <span>{($examples[$activeClass] || []).length}</span> {t('training.imagesCount', lang)}
        </div>
        <Thumbs />
      {/if}
    </div>
  {/if}

  <!-- Step 3: train -->
  {#if hasEnough}
    <hr />
    <div class="section">
      <label for="epochs">{t('training.epochs', lang)}</label>
      <div class="row" style="margin-top:6px;">
        <input id="epochs" type="number" bind:value={epochs} min="1" style="width:80px;" />
        <button onclick={doTrain} disabled={$isTraining}>
          {#if $isTraining}<span class="spinner"></span>{/if}
          {t('training.train', lang)}
        </button>
      </div>
      <div class="status light" style="margin-top:6px;">{$trainStatus}</div>
    </div>
  {/if}

  <!-- Model details button -->
  {#if hasTrained}
    <div class="section" style="margin-top:8px;">
      <button class="ghost" onclick={() => detailsOpen = true}>{t('training.modelDetails', lang)}</button>
    </div>
  {/if}

  <!-- Model save/load -->
  <hr />
  <div class="section">
    <span class="section-label">{t('training.model', lang)}</span>
    <div class="row" style="margin-top:6px;">
      {#if hasTrained}
        <button class="ghost" onclick={onSaveModel}>{t('training.save', lang)}</button>
      {/if}
      <label class="file-label" for="load-model">
        {t('training.load', lang)}
        <input id="load-model" type="file" accept=".zip" style="display:none" onchange={onLoadModelChange} />
      </label>
    </div>
    {#if modelInfo}<div class="model-info">{modelInfo}</div>{/if}
  </div>

  <!-- Project buttons -->
  <div class="project-buttons">
    {#if hasTrained}
      <button onclick={onDownloadProject}>{t('training.downloadProject', lang)}</button>
    {/if}
    <label class="file-label" for="import-project">
      {t('training.importProject', lang)}
      <input id="import-project" type="file" accept=".zip" style="display:none" onchange={onImportProjectChange} />
    </label>
  </div>
</div>

<ImportDialog
  open={importDialogOpen}
  images={importDialogImages}
  detectedClass={importDetectedClass}
  on:confirm={onImportConfirm}
  on:cancel={onImportCancel}
/>

<ModelDetailsDialog open={detailsOpen} on:close={() => detailsOpen = false} />

<style lang="scss">
  .section { display: flex; flex-direction: column; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row-between { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .capture-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .capture-count { margin-top: 6px; font-size: 13px; color: #555; }
</style>
