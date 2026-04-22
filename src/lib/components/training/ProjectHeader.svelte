<script lang="ts">
  import {
    currentProject,
    closeCurrentProject,
    renameCurrentProject,
    deleteProject
  } from '$lib/stores/projects';
  import {
    exportCurrentProject,
    importProjectFromFile,
    importModelAsNewProject
  } from '$lib/projects-io';
  import { showNotification } from '$lib/stores/notifications';
  import { classifierModel } from '$lib/stores';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import DropdownItem from '$lib/components/ui/DropdownItem.svelte';

  let editing = $state(false);
  let nameInput = $state('');
  let importProjectEl: HTMLInputElement = $state()!;
  let importModelEl: HTMLInputElement = $state()!;

  function startEdit() {
    nameInput = $currentProject?.name ?? '';
    editing = true;
  }

  async function commitEdit() {
    if (editing && nameInput.trim() && nameInput.trim() !== $currentProject?.name) {
      await renameCurrentProject(nameInput.trim());
    }
    editing = false;
  }

  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      editing = false;
    }
  }

  async function onExport() {
    try {
      await exportCurrentProject();
      showNotification('Projekt exportiert', { type: 'success' });
    } catch (err) {
      showNotification((err as Error).message, { type: 'error' });
    }
  }

  async function onProjectImport(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      await importProjectFromFile(input.files[0]);
      showNotification('Projekt importiert', { type: 'success' });
    } catch (err) {
      showNotification((err as Error).message, { type: 'error' });
    }
    input.value = '';
  }

  async function onModelImport(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      await importModelAsNewProject(input.files[0]);
      showNotification('Modell importiert', { type: 'success' });
    } catch (err) {
      showNotification((err as Error).message, { type: 'error' });
    }
    input.value = '';
  }

  function onBackToStart() {
    classifierModel.set(null);
    closeCurrentProject();
  }

  async function onDelete() {
    if (!$currentProject) return;
    if (!confirm(`Projekt "${$currentProject.name}" wirklich löschen?`)) return;
    classifierModel.set(null);
    await deleteProject($currentProject.id);
    showNotification('Projekt gelöscht', { type: 'success' });
  }
</script>

{#if $currentProject}
  <header class="project-header">
    <button class="back-btn ghost" title="Zurück zur Übersicht" aria-label="Zurück" onclick={onBackToStart}>
      ←
    </button>

    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="name-input"
        bind:value={nameInput}
        onblur={commitEdit}
        onkeydown={onNameKey}
        autofocus
      />
    {:else}
      <button class="name-btn" onclick={startEdit} title="Umbenennen">
        {$currentProject.name}
        <span class="edit-hint">✎</span>
      </button>
    {/if}

    <Dropdown placement="bottom-end">
      {#snippet trigger()}
        <button class="menu-btn ghost" aria-label="Projekt-Menü">⋯</button>
      {/snippet}
      {#snippet children()}
        <DropdownItem onclick={onExport}>Projekt herunterladen</DropdownItem>
        <DropdownItem onclick={onDelete}>Projekt löschen</DropdownItem>
      {/snippet}
    </Dropdown>

    <input
      bind:this={importProjectEl}
      type="file"
      accept=".zip"
      style="display:none"
      onchange={onProjectImport}
    />
    <input
      bind:this={importModelEl}
      type="file"
      accept=".zip"
      style="display:none"
      onchange={onModelImport}
    />
  </header>
{/if}

<style lang="scss">
  .project-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 12px;
    border-bottom: 1px solid rgba(var(--md-outline-variant), 0.5);
    margin-bottom: 12px;
  }
  .back-btn,
  .menu-btn {
    width: 36px;
    height: 36px;
    min-height: unset;
    padding: 0;
    font-size: 18px;
    border-radius: 50%;
    box-shadow: none;
    flex-shrink: 0;
  }
  .name-btn {
    flex: 1;
    text-align: left;
    background: transparent;
    border: none;
    padding: 6px 10px;
    border-radius: var(--md-radius-sm);
    font-size: 18px;
    font-weight: 600;
    color: rgb(var(--md-on-surface));
    cursor: pointer;
    min-height: unset;
    box-shadow: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 8px;
    .edit-hint {
      opacity: 0;
      font-size: 14px;
      color: rgb(var(--md-on-surface-variant));
    }
    &:hover {
      background: rgba(var(--md-surface-variant), 0.5);
      .edit-hint {
        opacity: 1;
      }
    }
  }
  .name-input {
    flex: 1;
    font-size: 18px;
    font-weight: 600;
    padding: 6px 10px;
    border: 2px solid rgb(var(--md-primary));
    border-radius: var(--md-radius-sm);
    background: rgb(var(--md-surface));
    color: rgb(var(--md-on-surface));
  }
</style>
