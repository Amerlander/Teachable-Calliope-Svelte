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
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import ModelPicker from '$lib/components/ModelPicker.svelte';
  import NoModelNotice from '$lib/components/NoModelNotice.svelte';

  // Saved in the order they were created, so the newest program is the last row —
  // the same direction the model list runs in, with the "new" row below both.
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
    const model = $activeModel ?? $availableModels.at(-1) ?? null;
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

  async function handleDelete(p: MakeCodeProgram) {
    if (!confirm(`"${p.name}" löschen?`)) return;
    deleteMakeCodeProgram(p.id);
    // If we just deleted the active program, open whatever is newly active —
    // including its model, so the prediction follows the program on screen.
    const now = get(currentProject);
    const next = (now?.makeCodePrograms ?? []).find((x) => x.id === now?.currentProgramId);
    if (next) await openProgram(next);
  }

  function startRename(p: MakeCodeProgram, e?: Event) {
    e?.stopPropagation();
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

  function onRenameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') commitRename();
    else if (e.key === 'Escape') cancelRename();
    e.stopPropagation();
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString('de-DE');
  }
</script>

<div class="program-list">
  <div class="head">
    <span class="section-label">Programme</span>
  </div>

  <!-- Nothing can be programmed without a model, so the way to get one is
       offered right here instead of leaving an empty list behind. -->
  {#if $availableModels.length === 0}
    <NoModelNotice
      message="Ein Programm wird immer für ein Modell erstellt. Trainiere eines mit deinen Bildern oder importiere ein fertiges."
    />
  {:else}
    {#if programs.length === 0}
      <div class="empty">Noch kein Programm gespeichert.</div>
    {:else}
      <ul class="entry-list">
        {#each programs as p (p.id)}
          {@const model = $availableModels.find((m) => m.id === p.modelId) ?? null}
          {@const options = modelsForProgram(p, $availableModels)}
          <li class="entry-row" class:active={p.id === activeId}>
            <div class="row-top">
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="main"
                role="button"
                tabindex="0"
                onclick={() => handleSelect(p)}
                onkeydown={(e) => e.key === 'Enter' && handleSelect(p)}
              >
                <div class="title">
                  {#if renamingId === p.id}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      class="title-edit"
                      bind:value={renameDraft}
                      onkeydown={onRenameKey}
                      onblur={commitRename}
                      onclick={(e) => e.stopPropagation()}
                      autofocus
                    />
                  {:else}
                    <span class="title-text">{p.name}</span>
                    <button
                      type="button"
                      class="edit-btn"
                      onclick={(e) => startRename(p, e)}
                      title="Umbenennen"
                      aria-label="Umbenennen"
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                      </svg>
                    </button>
                  {/if}
                  {#if p.id === activeId}
                    <span class="chip">aktiv</span>
                  {/if}
                </div>
                <!-- Same three lines as a model row: what it is called, its
                     numbers, then its classes. -->
                <div class="meta">
                  <span>{formatDate(p.updatedAt)}</span>
                  <span>·</span>
                  <span>{p.classes.length} Klassen</span>
                  {#if p.classes.length && !model}
                    <span class="chip warn" title="Das Modell dieses Programms wurde gelöscht.">
                      Modell fehlt
                    </span>
                  {/if}
                </div>
                <div class="classes" title={p.classes.join(', ') || undefined}>
                  {#if p.classes.length}
                    {p.classes.join(' · ')}
                  {:else}
                    <!-- Built in the editor before any model existed, so it has
                         no class blocks and nothing to bind a model to. -->
                    ohne Klassen-Blöcke
                  {/if}
                </div>
              </div>
              <Dropdown placement="bottom-end">
                {#snippet trigger()}
                  <button type="button" class="menu" aria-label="Aktionen" title="Mehr">⋯</button>
                {/snippet}
                {#snippet children()}
                  <DropdownItem onclick={() => handleSelect(p)}>Dieses Programm öffnen</DropdownItem>
                  <DropdownItem onclick={() => startRename(p)}>Umbenennen</DropdownItem>
                  <DropdownItem onclick={() => handleDelete(p)}>Löschen</DropdownItem>
                {/snippet}
              </Dropdown>
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
                  block
                />
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <button class="add-row" onclick={handleNew} title="Neues Programm">
      <span aria-hidden="true">+</span> Neues Programm
    </button>
  {/if}
</div>

<style lang="scss">
  @use '../../styles/lists' as *;

  .program-list {
    padding: 12px 14px 10px;
    background: rgb(var(--md-background));
    border-bottom: 1px solid rgba(var(--md-outline-variant), 0.6);
  }
  .head { @include entry-head; }
  .entry-list { @include entry-list; }
  .entry-row { @include entry-row; }
  .row-top { @include entry-row-top; }
  .main { @include entry-main; }
  .title { @include entry-title; }
  .title-text { @include entry-title-text; }
  .title-edit { @include entry-title-edit; }
  .edit-btn { @include entry-edit-btn; }
  .chip { @include entry-chip; }
  .meta { @include entry-meta; }
  .classes { @include entry-classes; }
  .menu { @include entry-menu-btn; }
  .add-row { @include entry-add-row; }
  .empty { @include entry-empty; }

  .entry-row:hover .edit-btn,
  .entry-row.active .edit-btn {
    opacity: 0.7;
    &:hover { opacity: 1; }
  }

  // Bottom line of a program card: the model it runs on, laid out like a labelled
  // field so the picker is recognisable as one.
  .model-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px 10px;
    min-width: 0;
  }
  .model-caption {
    font-size: 11px;
    color: rgb(var(--md-on-surface-variant));
    flex-shrink: 0;
  }
</style>
