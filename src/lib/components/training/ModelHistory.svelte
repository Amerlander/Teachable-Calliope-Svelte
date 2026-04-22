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

  const history = $derived($currentProject?.modelHistory ?? []);
  const currentId = $derived($currentProject?.currentModelId ?? null);

  const sorted = $derived([...history].sort((a, b) => b.trainedAt - a.trainedAt));

  function accuracyOf(epochs: number[], accuracy: number[]): number | null {
    if (!accuracy.length) return null;
    return accuracy[accuracy.length - 1];
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString('de-DE');
  }

  async function onLoad(id: string) {
    const m = setCurrentModel(id);
    if (!m) return;
    try {
      await loadClassifierFromArtifacts(m.artifacts);
      showNotification('Modell geladen', { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
    }
  }

  function onRename(id: string, currentLabel?: string) {
    const label = prompt('Name für diesen Trainingslauf:', currentLabel || '');
    if (label == null) return;
    renameTrainedModel(id, label);
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
        <button class="main" onclick={() => onLoad(run.id)}>
          <div class="title">
            {run.label || formatDate(run.trainedAt)}
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
          </div>
        </button>
        <Dropdown placement="bottom-end">
          {#snippet trigger()}
            <button class="menu ghost" aria-label="Aktionen" title="Mehr">⋯</button>
          {/snippet}
          {#snippet children()}
            <DropdownItem onclick={() => onLoad(run.id)}>Dieses Modell laden</DropdownItem>
            <DropdownItem onclick={() => onRename(run.id, run.label)}>Umbenennen</DropdownItem>
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
    align-items: stretch;
    gap: 2px;
    border-radius: var(--md-radius-md);
    background: rgba(var(--md-surface-variant), 0.4);
    border: 2px solid transparent;
    transition: background 0.15s;
    &:hover {
      background: rgba(var(--md-surface-variant), 0.7);
    }
    &.active {
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary-container), 0.5);
    }
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    color: rgb(var(--md-on-surface));
    box-shadow: none;
    min-height: unset;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
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
  }
  .menu {
    width: 36px;
    padding: 0;
    box-shadow: none;
    border-radius: 0;
    background: transparent;
    &:hover {
      background: rgba(var(--md-surface-variant), 0.5);
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
