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
  import { COMPARE_COLORS, MAX_COMPARED } from '$lib/compare';

  // `highlightActive` is off while the sidebar is composing a new model: nothing
  // in the list is the subject of the view then, so nothing should look selected.
  //
  // In `selectable` mode the same list picks the models for a comparison instead
  // of loading one: the rows keep their layout and only gain a checkbox, because
  // the facts that decide which runs are worth comparing are already on them.
  let {
    onselect,
    highlightActive = true,
    selectable = false,
    selectedIds = [],
    ontoggle
  }: {
    onselect?: (id: string) => void;
    highlightActive?: boolean;
    selectable?: boolean;
    selectedIds?: string[];
    ontoggle?: (id: string) => void;
  } = $props();

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

  // Renaming and picking are two different jobs on the same row. Once the list
  // is picking models for a comparison, a rename that was already open would
  // sit inside a row that now reacts to every click — so it ends here.
  $effect(() => {
    if (selectable) cancelEdit();
  });

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
      {@const pickedAt = selectedIds.indexOf(run.id)}
      {@const full = selectedIds.length >= MAX_COMPARED && pickedAt < 0}
      <li
        class="entry-row"
        class:active={!selectable && run.id === currentId}
        class:picked={selectable && pickedAt >= 0}
        class:full={selectable && full}
      >
        <!-- In selection mode the whole row is the target, checkbox included: the
             box is the thing people aim at, and it is the one spot a handler on
             the row body would not have covered. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="row-top"
          class:pickable={selectable}
          role={selectable ? 'button' : undefined}
          tabindex={selectable ? 0 : undefined}
          aria-pressed={selectable ? pickedAt >= 0 : undefined}
          onclick={selectable ? () => !full && ontoggle?.(run.id) : undefined}
          onkeydown={selectable
            ? (e) => e.key === 'Enter' && !full && ontoggle?.(run.id)
            : undefined}
        >
          {#if selectable}
            <span class="cb" class:on={pickedAt >= 0} aria-hidden="true"></span>
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div
            class="main"
            role={selectable ? undefined : 'button'}
            tabindex={selectable ? undefined : 0}
            onclick={selectable ? undefined : () => onLoad(run.id)}
            onkeydown={selectable ? undefined : (e) => e.key === 'Enter' && onLoad(run.id)}
          >
            <div class="title">
              {#if selectable && pickedAt >= 0}
                <span
                  class="pick-dot"
                  style="background: {COMPARE_COLORS[pickedAt % COMPARE_COLORS.length]}"
                  aria-hidden="true"
                ></span>
              {/if}
              {#if editingId === run.id && !selectable}
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
                {#if !selectable}
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
          {#if !selectable}
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
          {/if}
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

  // Selection mode: the checkbox sits where the row's left padding is, so the
  // rows do not shift when the mode is turned on.
  .cb {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 2px solid rgb(var(--md-outline-variant));
    background: rgb(var(--md-surface));
    margin: 12px 0 0 10px;
    flex-shrink: 0;
    position: relative;
  }
  .cb.on {
    background: rgb(var(--md-primary));
    border-color: rgb(var(--md-primary));
    &::after {
      content: '';
      position: absolute;
      left: 4px;
      top: 1px;
      width: 4px;
      height: 8px;
      border: solid rgb(var(--md-on-primary));
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
  }
  .row-top.pickable {
    cursor: pointer;
    .main { cursor: inherit; }
  }
  .entry-row.picked {
    border-color: rgb(var(--md-primary));
    background: rgba(var(--md-surface-variant), 0.8);
  }
  // Nothing more fits into a comparison; the row stays readable but inert.
  .entry-row.full {
    opacity: 0.45;
    .row-top.pickable { cursor: default; }
  }
  .pick-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
  }

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
