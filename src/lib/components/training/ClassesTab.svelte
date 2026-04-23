<script lang="ts">
  import { get } from 'svelte/store';
  import {
    classes,
    addClass,
    examples,
    activeClass,
    setActiveClass,
    pushExample,
    clearClass,
    videoRefs,
    removeClass,
    renameClass
  } from '$lib/stores';
  import { updateProject } from '$lib/stores/projects';
  import { showNotification } from '$lib/stores/notifications';
  import {
    captureFrameFromVideo,
    processZipFile,
    downloadClassImages,
    downloadAllClassImages
  } from '$lib/machine';
  import ClassItem from './ClassItem.svelte';
  import Thumbs from '$lib/components/Thumbs.svelte';
  import ImportDialog from '$lib/components/ImportDialog.svelte';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  let { ontraintab }: { ontraintab?: () => void } = $props();

  let newClassName = $state('');
  let isCapturing = $state(false);
  let captureInterval: ReturnType<typeof setInterval> | null = null;
  let importDialogOpen = $state(false);
  let importDialogImages = $state<string[]>([]);
  let importDetectedClass = $state<string | null>(null);

  let filesInputEl: HTMLInputElement = $state()!;
  let importAllEl: HTMLInputElement = $state()!;

  const hasEnoughForTraining = $derived($classes.length >= 3);

  function createClass() {
    if (!newClassName.trim()) return;
    addClass(newClassName.trim());
    newClassName = '';
  }

  function onNewClassKey(e: KeyboardEvent) {
    if (e.key === 'Enter') createClass();
  }

  function startCapture() {
    const cls = get(activeClass);
    if (!cls) {
      showNotification('Bitte zuerst eine Klasse wählen', { type: 'warning' });
      return;
    }
    const vid = get(videoRefs).webcam;
    if (!vid) {
      showNotification('Kamera nicht verbunden', { type: 'error' });
      return;
    }
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
    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }
  }

  async function onFilesChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;
    if (!get(activeClass)) {
      showNotification('Bitte zuerst eine Klasse wählen', { type: 'warning' });
      input.value = '';
      return;
    }
    for (const file of Array.from(files)) {
      if (file.name.endsWith('.zip')) {
        try {
          const result = await processZipFile(file);
          const imgs = result.images || [];
          const det = result.detectedClass;
          if (det && get(classes).includes(det)) {
            imgs.forEach((url) => pushExample(det, url));
          } else if (get(activeClass) && imgs.length > 0) {
            imgs.forEach((url) => pushExample(get(activeClass)!, url));
          } else {
            importDialogImages = imgs;
            importDetectedClass = det || null;
            importDialogOpen = true;
          }
        } catch (err) {
          showNotification('Fehler: ' + (err as Error).message, { type: 'error' });
        }
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => pushExample(get(activeClass)!, ev.target?.result as string);
        reader.readAsDataURL(file);
      }
    }
    input.value = '';
  }

  async function onImportAll(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      const result = await processZipFile(input.files[0]);
      const imgs = result.images || [];
      if (!imgs.length) {
        showNotification('Keine Bilder im ZIP gefunden', { type: 'warning' });
      } else {
        const det = result.detectedClass;
        if (det) {
          if (!get(classes).includes(det)) addClass(det);
          imgs.forEach((url) => pushExample(det, url));
          showNotification(`${imgs.length} Bilder importiert`, { type: 'success' });
        } else {
          importDialogImages = imgs;
          importDetectedClass = null;
          importDialogOpen = true;
        }
      }
    } catch (err) {
      showNotification('Fehler: ' + (err as Error).message, { type: 'error' });
    }
    input.value = '';
  }

  function onImportConfirm(
    e: CustomEvent<{ images: string[]; selectedClass: string | null }>
  ) {
    const { images, selectedClass } = e.detail;
    if (selectedClass) {
      images.forEach((im) => pushExample(selectedClass, im));
      setActiveClass(selectedClass);
      showNotification(`${images.length} Bilder importiert in "${selectedClass}"`, {
        type: 'success'
      });
    }
    importDialogOpen = false;
  }

  function onImportCancel() {
    importDialogOpen = false;
    importDialogImages = [];
    importDetectedClass = null;
  }

  function clearAllClasses() {
    if (!confirm('Alle aufgenommenen Bilder aus allen Klassen löschen?')) return;
    updateProject((p) => {
      for (const c of p.classes) p.examples[c] = [];
    });
    showNotification('Alle Bilder gelöscht', { type: 'success' });
  }

  function rawExamples() {
    const e = get(examples);
    const active = get(activeClass);
    return active ? e[active] || [] : [];
  }
</script>

<div class="classes-tab">
  <!-- Class list (empty allowed, input is always the last row) -->
  <div class="section">
    <div class="row-between">
      <span class="section-label">Klassen</span>
      {#if $classes.length}
        <Dropdown placement="bottom-end">
          {#snippet trigger()}
            <Button variant="ghost" size="small" aria-label="Klassen-Menü" title="Mehr Aktionen">⋯</Button>
          {/snippet}
          {#snippet children()}
            <DropdownItem onclick={() => downloadAllClassImages($examples)}>
              Alle herunterladen
            </DropdownItem>
            <DropdownItem onclick={() => importAllEl?.click()}>
              Bilder importieren
            </DropdownItem>
            <DropdownItem onclick={clearAllClasses}>
              Alle Klassen leeren
            </DropdownItem>
          {/snippet}
        </Dropdown>
      {/if}
      <input
        bind:this={importAllEl}
        type="file"
        accept=".zip"
        style="display:none"
        onchange={onImportAll}
      />
    </div>
    <div class="class-list">
      {#each $classes as cls (cls)}
        <ClassItem
          name={cls}
          count={($examples[cls] || []).length}
          selected={$activeClass === cls}
          onselect={() => setActiveClass(cls)}
          onrename={(next) => renameClass(cls, next)}
        />
      {/each}

      <!-- New class input styled like a list row -->
      <div class="new-class-row">
        <input
          class="new-class-input"
          type="text"
          placeholder="Neue Klasse hinzufügen"
          bind:value={newClassName}
          onkeydown={onNewClassKey}
        />
        <Button
          class="add-btn"
          size="small"
          onclick={createClass}
          disabled={!newClassName.trim()}
          aria-label="Klasse hinzufügen"
        >
          +
        </Button>
      </div>
    </div>
  </div>

  <!-- Active class capture section -->
  {#if $activeClass}
    <hr />
    <div class="section">

      <div class="capture-actions">
        <Button
          class="capture-btn"
          active={isCapturing}
          onmousedown={startCapture}
          onmouseup={stopCapture}
          onmouseleave={stopCapture}
          ontouchstart={startCapture}
          ontouchend={stopCapture}
        >
          {isCapturing ? 'Aufnahme stoppen' : 'Aufnahme starten'}
        </Button>

        <Dropdown placement="bottom-end">
          {#snippet trigger()}
            <Button class="icon-btn" variant="ghost" aria-label="Klassen-Aktionen" title="Mehr Aktionen">⋯</Button>
          {/snippet}
          {#snippet children()}
            <DropdownItem
              onclick={() => {
                const active = get(activeClass);
                if (active) downloadClassImages(active, $examples[active] || []);
              }}
            >
              Dateien herunterladen
            </DropdownItem>
            <DropdownItem onclick={() => filesInputEl?.click()}>
              Dateien importieren
            </DropdownItem>
            <DropdownItem
              onclick={() => {
                const active = get(activeClass);
                if (active && confirm(`"${active}" leeren?`)) clearClass(active);
              }}
            >
              Klasse leeren
            </DropdownItem>
            <DropdownItem
              onclick={() => {
                const active = get(activeClass);
                if (active && confirm(`"${active}" löschen?`)) removeClass(active);
              }}
            >
              Klasse löschen
            </DropdownItem>
          {/snippet}
        </Dropdown>
      </div>

      <div class="button-hint">Halte die Taste gedrückt</div>

      <input
        bind:this={filesInputEl}
        type="file"
        accept="image/*,.zip"
        multiple
        style="display:none"
        onchange={onFilesChange}
      />

      <Thumbs />
    </div>
  {/if}

  <!-- Train model CTA -->
  <div class="train-cta">
    <Button
      class="train-btn"
      fullWidth
      disabled={!hasEnoughForTraining}
      onclick={() => ontraintab?.()}
      title={hasEnoughForTraining ? 'Zum Modell-Tab wechseln' : 'Mindestens 3 Klassen erforderlich'}
    >
      Modell trainieren
    </Button>
    {#if !hasEnoughForTraining}
      <div class="hint">Mindestens 3 Klassen erforderlich ({$classes.length}/3)</div>
    {/if}
  </div>
</div>

<ImportDialog
  open={importDialogOpen}
  images={importDialogImages}
  detectedClass={importDetectedClass}
  on:confirm={onImportConfirm}
  on:cancel={onImportCancel}
/>

<style lang="scss">
  .classes-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .section {
    display: flex;
    flex-direction: column;
    margin-bottom: 12px;
    .section-label {
      font-size: 13px;
      font-weight: 600;
      color: rgb(var(--md-on-surface-variant));
      margin-bottom: 4px;
    }
  }
  .new-class-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px;
    border: 1px dashed rgba(var(--md-outline), 0.7);
    border-radius: var(--md-radius-md);
    margin-top: 4px;
    &:focus-within {
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary-container), 0.3);
    }
  }
  .new-class-input {
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
  :global(.add-btn) {
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
  .row-between {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .class-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  hr {
    border: none;
    border-top: 1px solid rgba(var(--md-outline-variant), 0.5);
    margin: 12px 0;
  }
  .capture-count {
    font-size: 13px;
    color: rgb(var(--md-on-surface-variant));
  }
  .capture-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 4px;
  }
  :global(.capture-btn) {
    flex: 1;
  }
  :global(.icon-btn) {
    width: 40px;
    min-width: 40px;
    padding: 0;
    box-shadow: none;
  }
  .button-hint {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    margin-top: 4px;
  }
  .train-cta {
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid rgba(var(--md-outline-variant), 0.5);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  :global(.train-btn) {
    font-weight: 600;
  }
  .hint {
    text-align: center;
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
  }
</style>
