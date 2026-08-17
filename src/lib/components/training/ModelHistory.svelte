<script lang="ts">
  import {
    currentProject,
    setCurrentModel,
    deleteTrainedModel,
    renameTrainedModel
  } from '$lib/stores/projects';
  import { loadClassifierFromArtifacts } from '$lib/machine';
  import { showNotification } from '$lib/stores/notifications';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';

  // `highlightActive` is off while the sidebar is composing a new model: nothing
  // in the list is the subject of the view then, so nothing should look selected.
  let {
    onselect,
    highlightActive = true
  }: { onselect?: (id: string) => void; highlightActive?: boolean } = $props();

  const history = $derived($currentProject?.modelHistory ?? []);
  const currentId = $derived(
    highlightActive ? ($currentProject?.currentModelId ?? null) : null
  );

  const sorted = $derived([...history].sort((a, b) => b.trainedAt - a.trainedAt));

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
    const m = setCurrentModel(id);
    onselect?.(id);
    if (!m) return;
    try {
      await loadClassifierFromArtifacts(m.artifacts);
      showNotification('Modell geladen', { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
    }
  }

  function onDelete(id: string) {
    if (!confirm('Diesen Trainingslauf löschen?')) return;
    deleteTrainedModel(id);
    showNotification('Trainingslauf gelöscht', { type: 'success' });
  }
</script>

{#if sorted.length}
  <ul class="history-list">
    {#each sorted as run (run.id)}
      {@const acc = accuracyOf(run.history.epochs, run.history.accuracy)}
      <li class="history-row" class:active={run.id === currentId}>
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
          </div>
          <div class="meta">
            <span class="acc">{acc != null ? (acc * 100).toFixed(1) + ' %' : '–'}</span>
            <span>·</span>
            <span>{run.history.epochs.length} Ep.</span>
            <span>·</span>
            <span>{run.classesSnapshot.length} Klassen</span>
            <span>·</span>
            <span>{Object.values(run.exampleCounts).reduce((a, b) => a + b, 0)} Bilder</span>
            {#if run.roi}
              <span class="roi-badge" title="Trainiert mit ROI {Math.round(run.roi.w * 100)}×{Math.round(run.roi.h * 100)}% @ ({Math.round(run.roi.x * 100)}, {Math.round(run.roi.y * 100)})">
                ROI {Math.round(run.roi.w * 100)}×{Math.round(run.roi.h * 100)}%
              </span>
            {/if}
          </div>
        </div>
        <Dropdown placement="bottom-end">
          {#snippet trigger()}
            <button type="button" class="menu" aria-label="Aktionen" title="Mehr">⋯</button>
          {/snippet}
          {#snippet children()}
            <DropdownItem onclick={() => onLoad(run.id)}>Dieses Modell laden</DropdownItem>
            <DropdownItem onclick={() => startEdit(run.id, run.label)}>Umbenennen</DropdownItem>
            <DropdownItem onclick={() => onDelete(run.id)}>Löschen</DropdownItem>
          {/snippet}
        </Dropdown>
      </li>
    {/each}
  </ul>
{:else}
  <div class="empty">Noch kein Training durchgeführt.</div>
{/if}

<style lang="scss">
  .history-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 260px;
    overflow-y: auto;
  }
  .history-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 0;
    border-radius: var(--md-radius-md);
    background: rgba(var(--md-surface-variant), 0.3);
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.2s;
    &:hover {
      background: rgb(var(--md-surface-variant));
      box-shadow: var(--md-elevation-1);
    }
    &.active {
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary-container));
    }
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    color: rgb(var(--md-on-surface));
    box-shadow: none;
    min-height: unset;
    font: inherit;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .title-edit {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    border: 1.5px solid rgb(var(--md-primary));
    border-radius: var(--md-radius-sm);
    background: rgb(var(--md-surface));
    font: inherit;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
  }
  .edit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    color: rgb(var(--md-on-surface-variant));
    border-radius: 999px;
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s, opacity 0.15s, color 0.15s;
    &:focus-visible {
      opacity: 1;
      outline: 2px solid rgb(var(--md-primary));
      outline-offset: 1px;
    }
    &:hover {
      background: rgba(var(--md-on-surface), 0.08);
      color: rgb(var(--md-on-surface));
    }
  }
  .history-row:hover .edit-btn,
  .history-row.active .edit-btn {
    opacity: 0.7;
    &:hover { opacity: 1; }
  }
  .chip {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: 99px;
    background: rgb(var(--md-primary));
    color: rgb(var(--md-on-primary));
  }
  .meta {
    font-size: 12px;
    color: rgb(var(--md-on-surface-variant));
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    .acc {
      color: rgb(var(--md-primary));
      font-weight: 600;
    }
    .roi-badge {
      margin-left: auto;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.3px;
      padding: 1px 6px;
      border-radius: 99px;
      background: rgb(var(--md-tertiary-container, var(--md-surface-variant)));
      color: rgb(var(--md-on-tertiary-container, var(--md-on-surface)));
      font-variant-numeric: tabular-nums;
    }
  }
  .menu {
    width: 28px;
    height: 28px;
    min-height: unset;
    padding: 0;
    box-shadow: none;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: rgb(var(--md-on-surface-variant));
    cursor: pointer;
    font-size: 16px;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
    &:hover {
      background: rgba(var(--md-on-surface), 0.08);
      color: rgb(var(--md-on-surface));
    }
  }
  .empty {
    padding: 12px;
    text-align: center;
    font-size: 13px;
    color: rgb(var(--md-on-surface-variant));
    font-style: italic;
  }
</style>
