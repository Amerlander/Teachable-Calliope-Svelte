<script lang="ts">
  import { get } from 'svelte/store';
  import {
    activeModel,
    availableModels,
    currentProject,
    deleteMakeCodeProgram,
    renameMakeCodeProgram,
    type MakeCodeProgram,
  } from '$lib/stores/projects';
  import { createProgramForModel, openProgram } from '$lib/programs';
  import { highestClassIndex } from '$lib/makecode/programFiles';
  import { activateModel } from '$lib/models';
  import { showNotification } from '$lib/stores/notifications';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';
  import NoModelNotice from '$lib/components/NoModelNotice.svelte';
  import DeleteConfirmDialog, {
    type DeleteTarget
  } from '$lib/components/DeleteConfirmDialog.svelte';

  // Saved in the order they were created; shown newest first, the same direction
  // the model list runs in, with the "new" button above both.
  const programs = $derived([...($currentProject?.makeCodePrograms ?? [])].reverse());
  const activeId = $derived($currentProject?.currentProgramId ?? null);
  /** Classes the loaded model has, for flagging programs that reach past them. */
  const modelClassCount = $derived($activeModel?.classes.length ?? 0);

  let renamingId: string | null = $state(null);
  let renameDraft = $state('');

  function handleSelect(p: MakeCodeProgram) {
    if (renamingId === p.id) return;
    if (p.id === activeId) return;
    openProgram(p);
  }

  /**
   * A starter program is generated from a model's classes, so it needs one to
   * start from — but it isn't bound to it: the blocks address class slots, and
   * the names they show follow whichever model is loaded later.
   */
  async function handleNew() {
    const model = $activeModel ?? $availableModels.at(-1) ?? null;
    if (!model) {
      showNotification('Trainiere oder importiere zuerst ein Modell', { type: 'warning' });
      return;
    }
    // The starter's block labels come from the loaded model, so that has to be
    // this one before it is generated — not just the one it was picked from.
    if (model.id !== $activeModel?.id) {
      try {
        await activateModel(model.id);
      } catch (err) {
        showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
        return;
      }
    }
    createProgramForModel(model);
  }

  /** The program the confirm dialog is asking about; null keeps it closed. */
  let pendingDelete = $state<DeleteTarget | null>(null);

  function handleDelete(p: MakeCodeProgram) {
    pendingDelete = { kind: 'program', program: p };
  }

  function runDelete() {
    const t = pendingDelete;
    pendingDelete = null;
    if (t?.kind !== 'program') return;
    deleteMakeCodeProgram(t.program.id);
    // If we just deleted the active program, open whatever is newly active.
    const now = get(currentProject);
    const next = (now?.makeCodePrograms ?? []).find((x) => x.id === now?.currentProgramId);
    if (next) openProgram(next);
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
    <!-- Above the list, where the program it creates will appear. -->
    <button
      type="button"
      class="add-btn"
      onclick={handleNew}
      disabled={$availableModels.length === 0}
      title="Neues Programm"
    >
      <span aria-hidden="true">+</span> Neues Programm
    </button>
  </div>

  <!-- A starter program needs a model's classes to be generated from, so the way
       to get one is offered right here instead of leaving an empty list behind. -->
  {#if $availableModels.length === 0}
    <NoModelNotice
      message="Die Blöcke eines neuen Programms entstehen aus den Klassen eines Modells. Trainiere eines mit deinen Bildern oder importiere ein fertiges."
    />
  {:else if programs.length === 0}
    <div class="empty">Noch kein Programm gespeichert.</div>
  {:else}
    <ul class="entry-list">
      {#each programs as p (p.id)}
        {@const used = highestClassIndex(p.files)}
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
              <!-- How many class slots the blocks use, not which classes: the
                   names come from the loaded model, so they are the same for
                   every program in the list and belong in the header instead. -->
              <div class="meta">
                <span>{formatDate(p.updatedAt)}</span>
                <span>·</span>
                <span>
                  {#if used === 0}
                    ohne Klassen-Blöcke
                  {:else}
                    Blöcke für {used} Klassen
                  {/if}
                </span>
                {#if used > modelClassCount}
                  <span
                    class="chip warn"
                    title="Das geladene Modell hat nur {modelClassCount} Klassen. Die übrigen Blöcke bleiben ohne Wirkung."
                  >
                    {used - modelClassCount} ohne Wirkung
                  </span>
                {/if}
              </div>
            </div>
            <Dropdown placement="bottom-end">
              {#snippet trigger()}
                <button type="button" class="menu" aria-label="Aktionen" title="Mehr">⋯</button>
              {/snippet}
              {#snippet children()}
                <!-- No "open" entry: clicking the row is what opens a program. -->
                <DropdownItem onclick={() => startRename(p)}>Umbenennen</DropdownItem>
                <DropdownItem onclick={() => handleDelete(p)}>Löschen</DropdownItem>
              {/snippet}
            </Dropdown>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<DeleteConfirmDialog
  target={pendingDelete}
  onconfirm={runDelete}
  oncancel={() => (pendingDelete = null)}
/>

<style lang="scss">
  @use '../../styles/lists' as *;

  // Its own pane now: head on top, the list underneath taking the rest of the
  // height and scrolling on its own.
  .program-list {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 12px 14px;
  }
  .head {
    @include entry-head;
    flex-shrink: 0;
  }
  .add-btn { @include entry-add-btn; }
  .entry-list {
    @include entry-list;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }
  .entry-row { @include entry-row; }
  .row-top { @include entry-row-top; }
  .main { @include entry-main; }
  .title { @include entry-title; }
  .title-text { @include entry-title-text; }
  .title-edit { @include entry-title-edit; }
  .edit-btn { @include entry-edit-btn; }
  .chip { @include entry-chip; }
  .meta { @include entry-meta; }
  .menu { @include entry-menu-btn; }
  .empty { @include entry-empty; }

  .entry-row:hover .edit-btn,
  .entry-row.active .edit-btn {
    opacity: 0.7;
    &:hover { opacity: 1; }
  }
</style>
