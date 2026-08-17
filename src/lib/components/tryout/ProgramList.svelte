<script lang="ts">
  import { get } from 'svelte/store';
  import {
    activeModel,
    availableModels,
    currentProject,
    deleteMakeCodeProgram,
    modelsForProgram,
    renameMakeCodeProgram,
    type MakeCodeProgram,
  } from '$lib/stores/projects';
  import { createProgramForModel, openProgram, switchProgramModel } from '$lib/programs';
  import { modelLabel } from '$lib/models';
  import { showNotification } from '$lib/stores/notifications';
  import ModelPicker from '$lib/components/ModelPicker.svelte';
  import NoModelNotice from '$lib/components/NoModelNotice.svelte';

  const programs = $derived($currentProject?.makeCodePrograms ?? []);
  const activeId = $derived($currentProject?.currentProgramId ?? null);

  let renamingId: string | null = $state(null);
  let renameDraft = $state('');

  async function handleSelect(p: MakeCodeProgram) {
    if (renamingId === p.id) return;
    if (p.id === activeId) return;
    await openProgram(p);
  }

  /**
   * A new program is programmed against the model that is currently selected —
   * its classes decide which blocks the program gets. Without a model there is
   * nothing to program against, which is what the notice above the list is for.
   */
  function handleNew() {
    const model = $activeModel ?? $availableModels[0] ?? null;
    if (!model) {
      showNotification('Trainiere oder importiere zuerst ein Modell', { type: 'warning' });
      return;
    }
    createProgramForModel(model);
  }

  async function handlePickModel(program: MakeCodeProgram, modelId: string) {
    const model = await switchProgramModel(program.id, modelId);
    if (!model) {
      showNotification('Dieses Modell passt nicht zu den Klassen des Programms', {
        type: 'warning',
      });
      return;
    }
    showNotification(`Programm nutzt jetzt „${modelLabel(model)}“`, { type: 'success' });
  }

  async function handleDelete(p: MakeCodeProgram, e: Event) {
    e.stopPropagation();
    if (!confirm(`"${p.name}" löschen?`)) return;
    deleteMakeCodeProgram(p.id);
    // If we just deleted the active program, open whatever is newly active —
    // including its model, so the prediction follows the program on screen.
    const now = get(currentProject);
    const next = (now?.makeCodePrograms ?? []).find((x) => x.id === now?.currentProgramId);
    if (next) await openProgram(next);
  }

  function startRename(p: MakeCodeProgram, e: Event) {
    e.stopPropagation();
    renamingId = p.id;
    renameDraft = p.name;
  }

  function commitRename() {
    if (!renamingId) return;
    const name = renameDraft.trim();
    if (name) renameMakeCodeProgram(renamingId, name);
    renamingId = null;
  }

  function cancelRename() {
    renamingId = null;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div class="program-list">
  <div class="head">
    <h4>Programme</h4>
    <button
      class="add-btn"
      onclick={handleNew}
      title="Neues Programm"
      disabled={$availableModels.length === 0}
    >+</button>
  </div>

  <!-- Nothing can be programmed without a model, so the way to get one is
       offered right here instead of leaving an empty list behind. -->
  {#if $availableModels.length === 0}
    <NoModelNotice
      message="Ein Programm wird immer für ein Modell erstellt. Trainiere eines mit deinen Bildern oder importiere ein fertiges."
    />
  {:else if programs.length === 0}
    <div class="empty">Noch kein Programm gespeichert.</div>
  {:else}
    <ul>
      {#each programs as p (p.id)}
        {@const model = $availableModels.find((m) => m.id === p.modelId) ?? null}
        {@const options = modelsForProgram(p, $availableModels)}
        <li class:active={p.id === activeId}>
          {#if renamingId === p.id}
            <div class="main-row">
              <input
                type="text"
                bind:value={renameDraft}
                onblur={commitRename}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  else if (e.key === 'Escape') cancelRename();
                }}
              />
            </div>
            <div class="meta">{formatDate(p.updatedAt)}</div>
          {:else}
            <button type="button" class="program-row" onclick={() => handleSelect(p)}>
              <span class="name">{p.name}</span>
              <span class="meta">
                {formatDate(p.updatedAt)} · {p.classes.length} Klassen
              </span>
            </button>
            <div class="actions">
              <button class="icon-btn" title="Umbenennen" onclick={(e) => startRename(p, e)}>✎</button>
              <button class="icon-btn danger" title="Löschen" onclick={(e) => handleDelete(p, e)}>✕</button>
            </div>
            <!-- Which model this program runs on. Swappable within its own class
                 list: a later run on the same classes fits, a model with
                 different classes needs its own program. -->
            {#if p.classes.length}
              <div class="model-row">
                <span class="model-caption">Modell</span>
                <ModelPicker
                  models={options}
                  selectedId={model?.id ?? null}
                  onselect={(id) => handlePickModel(p, id)}
                  placeholder={options.length ? 'Modell wählen' : 'Kein passendes Modell'}
                  compact
                />
                {#if !model}
                  <span class="model-warn" title="Das Modell dieses Programms wurde gelöscht.">
                    fehlt
                  </span>
                {/if}
              </div>
              <div class="classes" title={p.classes.join(', ')}>{p.classes.join(' · ')}</div>
            {:else}
              <!-- Built in the editor before any model existed, so it has no
                   class blocks and nothing to bind a model to. -->
              <div class="classes">ohne Klassen-Blöcke</div>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style lang="scss">
  .program-list {
    padding: 12px 14px 6px;
    background: #fafafa;
    border-bottom: 1px solid #eee;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    h4 {
      margin: 0;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
      font-weight: 600;
    }
  }
  .add-btn {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 1px solid #d1d5db;
    background: #fff;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    color: #444;
    &:hover:not(:disabled) { background: #f3f4f6; }
    &:disabled { opacity: 0.4; cursor: default; }
  }
  .empty {
    font-size: 12px;
    color: #999;
    font-style: italic;
    padding: 6px 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    position: relative;
    border-radius: 8px;
    border: 1px solid transparent;
    background: #fff;
    transition: background 0.12s, border-color 0.12s;
    padding-bottom: 8px;

    &:hover { background: #f3f4f6; }
    &.active {
      background: #eef7ff;
      border-color: #93c5fd;
    }
  }
  .program-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 8px 44px 4px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .name {
    font-weight: 500;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .model-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    min-width: 0;
  }
  .model-caption {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #888;
    flex-shrink: 0;
  }
  .model-warn {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 4px;
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
  }
  .classes {
    padding: 4px 10px 0;
    font-size: 11px;
    color: #888;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .main-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
  }
  input {
    flex: 1;
    padding: 4px 6px;
    border: 1px solid #93c5fd;
    border-radius: 4px;
    font-size: 13px;
  }
  .actions {
    position: absolute;
    right: 6px;
    top: 6px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  li:hover .actions, li.active .actions {
    opacity: 1;
  }
  .icon-btn {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    color: #666;
    &:hover { background: rgba(0, 0, 0, 0.08); color: #222; }
    &.danger:hover { background: #fee2e2; color: #991b1b; }
  }
  .meta {
    font-size: 11px;
    color: #888;
    margin-top: 2px;
    margin-left: 2px;
  }
</style>
