<script lang="ts">
  import {
    availableModels,
    currentProject,
    deleteTrainedModel,
    renameTrainedModel
  } from '$lib/stores/projects';
  import { exportModelToZip } from '$lib/machine';
  import { activateModel } from '$lib/models';
  import { showNotification } from '$lib/stores/notifications';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import DeleteConfirmDialog, {
    type DeleteTarget
  } from '$lib/components/DeleteConfirmDialog.svelte';

  // `highlightActive` is off while the sidebar is composing a new model: nothing
  // in the list is the subject of the view then, so nothing should look selected.
  let {
    onselect,
    highlightActive = true
  }: { onselect?: (id: string) => void; highlightActive?: boolean } = $props();

  const currentId = $derived(
    highlightActive ? ($currentProject?.currentModelId ?? null) : null
  );

  // One list of models for the whole app — trained runs and imported ZIPs. The
  // store keeps them oldest first; the list shows the newest at the top, where
  // the run that just finished is the one being looked for.
  const models = $derived([...$availableModels].reverse());

  let editingId = $state<string | null>(null);
  let draft = $state('');

  function startEdit(id: string, currentLabel: string | undefined, e?: Event) {
    e?.stopPropagation();
    draft = currentLabel ?? '';
    editingId = id;
  }

  function commitEdit() {
    if (!editingId) return;
    renameTrainedModel(editingId, draft);
    editingId = null;
    draft = '';
  }

  function cancelEdit() {
    editingId = null;
    draft = '';
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') cancelEdit();
    e.stopPropagation();
  }

  function accuracyOf(epochs: number[], accuracy: number[]): number | null {
    if (!accuracy.length) return null;
    return accuracy[accuracy.length - 1];
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString('de-DE');
  }

  async function onLoad(id: string) {
    onselect?.(id);
    try {
      const m = await activateModel(id);
      if (m) showNotification('Modell geladen', { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
    }
  }

  /** The run the confirm dialog is asking about; null keeps it closed. */
  let pendingDelete = $state<DeleteTarget | null>(null);

  function onDelete(id: string) {
    const model = models.find((m) => m.id === id);
    if (model) pendingDelete = { kind: 'model', model };
  }

  function runDelete() {
    const t = pendingDelete;
    pendingDelete = null;
    if (t?.kind !== 'model') return;
    deleteTrainedModel(t.model.id);
    showNotification('Modell gelöscht', { type: 'success' });
  }

  async function onExport(id: string) {
    const model = $availableModels.find((m) => m.id === id);
    if (!model) return;
    try {
      await exportModelToZip(model);
      showNotification('Modell exportiert', { type: 'success' });
    } catch {
      showNotification('Fehler beim Speichern', { type: 'error' });
    }
  }
</script>

{#if models.length}
  <ul class="entry-list">
    {#each models as run (run.id)}
      {@const acc = accuracyOf(run.history.epochs, run.history.accuracy)}
      <li class="entry-row" class:active={run.id === currentId}>
        <div class="row-top">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="main"
            role="button"
            tabindex="0"
            onclick={() => onLoad(run.id)}
            onkeydown={(e) => e.key === 'Enter' && onLoad(run.id)}
          >
            <div class="title">
              {#if editingId === run.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="title-edit"
                  bind:value={draft}
                  onkeydown={onInputKey}
                  onblur={commitEdit}
                  onclick={(e) => e.stopPropagation()}
                  autofocus
                />
              {:else}
                <span class="title-text">{run.label || formatDate(run.trainedAt)}</span>
                <button
                  type="button"
                  class="edit-btn"
                  onclick={(e) => startEdit(run.id, run.label, e)}
                  title="Umbenennen"
                  aria-label="Umbenennen"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                    <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
              {/if}
              {#if run.id === currentId}
                <span class="chip">aktiv</span>
              {/if}
              {#if run.source === 'imported'}
                <span class="chip muted">importiert</span>
              {/if}
            </div>
            <!-- What the run achieved, then how it was set up. Two single
                 lines rather than one wrapping one: the settings are what tells
                 two runs over the same classes apart. -->
            <div class="meta">
              {#if run.source === 'imported'}
                <span>{run.classes.length} Klassen</span>
              {:else}
                <span class="acc">{acc != null ? (acc * 100).toFixed(1) + ' %' : '–'}</span>
                <span>·</span>
                <span>{run.history.epochs.length} Ep.</span>
                <span>·</span>
                <span>{run.classes.length} Klassen</span>
                <span>·</span>
                <span>{Object.values(run.exampleCounts).reduce((a, b) => a + b, 0)} Bilder</span>
              {/if}
            </div>
            {#if run.source !== 'imported'}
              <div class="meta settings">
                <span>Lernrate {run.options.learningRate}</span>
                <span>·</span>
                <span>Batch {run.options.batchSize}</span>
                <span>·</span>
                <span>{run.options.hiddenUnits} Units</span>
              </div>
            {/if}
          </div>
          <Dropdown placement="bottom-end">
            {#snippet trigger()}
              <button type="button" class="menu" aria-label="Aktionen" title="Mehr">⋯</button>
            {/snippet}
            {#snippet children()}
              <!-- No "load" entry: clicking the row is what loads a model. -->
              <DropdownItem onclick={() => startEdit(run.id, run.label)}>Umbenennen</DropdownItem>
              <DropdownItem onclick={() => onExport(run.id)}>Exportieren</DropdownItem>
              <DropdownItem onclick={() => onDelete(run.id)}>Löschen</DropdownItem>
            {/snippet}
          </Dropdown>
        </div>
      </li>
    {/each}
  </ul>
{:else}
  <div class="empty">Noch kein Training durchgeführt.</div>
{/if}

<DeleteConfirmDialog
  target={pendingDelete}
  onconfirm={runDelete}
  oncancel={() => (pendingDelete = null)}
/>

<style lang="scss">
  // Shared with the program list in Programmieren — see src/lib/styles/_lists.scss.
  @use '../../styles/lists' as *;

  .entry-list { @include entry-list; }
  .entry-row { @include entry-row; }
  .row-top { @include entry-row-top; }
  .main { @include entry-main; }
  .title { @include entry-title; }
  .title-text { @include entry-title-text; }
  .title-edit { @include entry-title-edit; }
  .edit-btn { @include entry-edit-btn; }
  .chip { @include entry-chip; }
  .menu { @include entry-menu-btn; }
  .empty { @include entry-empty; }

  .entry-row:hover .edit-btn,
  .entry-row.active .edit-btn {
    opacity: 0.7;
    &:hover { opacity: 1; }
  }

  .meta {
    @include entry-meta;
    // Both fact lines stay on one line each: wrapping them back into a block
    // is what made the rows look cluttered.
    flex-wrap: nowrap;
    overflow: hidden;
    .acc {
      color: rgb(var(--md-primary));
      font-weight: 600;
    }
    &.settings {
      font-size: 11px;
      opacity: 0.85;
      font-variant-numeric: tabular-nums;
    }
  }
</style>
