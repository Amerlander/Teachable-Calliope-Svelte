<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    projectList,
    currentProject,
    refreshProjectList,
    loadProject,
    deleteProject,
    type ProjectMode,
    type ProjectSummary
  } from '$lib/stores/projects';
  import {
    newProject,
    importProjectFromFile,
    importModelAsNewProject,
    exportProjectById
  } from '$lib/projects-io';
  import { loadClassifierFromArtifacts } from '$lib/machine';
  import { showNotification } from '$lib/stores/notifications';
  import { classifierModel } from '$lib/stores';
  import NewProjectDialog from './NewProjectDialog.svelte';
  import DeleteConfirmDialog, {
    type DeleteTarget
  } from '$lib/components/DeleteConfirmDialog.svelte';

  let importProjectEl: HTMLInputElement;
  let importModelEl: HTMLInputElement;
  let dialogOpen = $state(false);

  onMount(() => {
    void refreshProjectList();
  });

  function onCreate() {
    dialogOpen = true;
  }

  async function onDialogSubmit(name: string, mode: ProjectMode) {
    try {
      await newProject(name, mode);
      await goto('/training');
    } catch {
      showNotification('Projekt konnte nicht erstellt werden', { type: 'error' });
    }
  }

  async function onProjectImport(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      await importProjectFromFile(input.files[0]);
      showNotification('Projekt importiert', { type: 'success' });
      await goto('/training');
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
      await goto('/training');
    } catch (err) {
      showNotification((err as Error).message, { type: 'error' });
    }
    input.value = '';
  }

  async function onOpen(id: string) {
    const p = await loadProject(id);
    if (p?.modelArtifacts) {
      try {
        await loadClassifierFromArtifacts(p.modelArtifacts);
      } catch {
        /* ignore */
      }
    }
    await goto('/training');
  }

  async function onDownload(id: string) {
    try {
      await exportProjectById(id);
      showNotification('Projekt exportiert', { type: 'success' });
    } catch (err) {
      showNotification((err as Error).message, { type: 'error' });
    }
  }

  /** The project the confirm dialog is asking about; null keeps it closed. */
  let pendingDelete = $state<DeleteTarget | null>(null);

  function onDelete(project: ProjectSummary) {
    pendingDelete = { kind: 'project', project };
  }

  async function runDelete() {
    const t = pendingDelete;
    pendingDelete = null;
    if (t?.kind !== 'project') return;
    // Deleting the project that is currently open also has to drop its loaded
    // classifier — `deleteProject` only clears the store entry.
    if ($currentProject?.id === t.project.id) classifierModel.set(null);
    await deleteProject(t.project.id);
    showNotification('Projekt gelöscht', { type: 'success' });
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<NewProjectDialog bind:isOpen={dialogOpen} onsubmit={onDialogSubmit} />

<DeleteConfirmDialog
  target={pendingDelete}
  onconfirm={runDelete}
  oncancel={() => (pendingDelete = null)}
/>

<div class="start-screen">
  <div class="hero">
    <h1>Projekt wählen</h1>
    <p>Starte ein neues Projekt, importiere ein bestehendes oder lade ein fertiges Modell.</p>
  </div>

  <div class="options">
    <button class="option-card" onclick={onCreate}>
      <span class="card-text">
        <span class="card-title">Neues Projekt</span>
        <span class="card-desc">Klassen aufnehmen, Modell trainieren</span>
      </span>
      <span class="card-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M11 11V5H13V11H19V13H13V19H11V13H5V11H11Z" />
        </svg>
      </span>
    </button>

    <button class="option-card" onclick={() => importProjectEl?.click()}>
      <span class="card-text">
        <span class="card-title">Projekt importieren</span>
        <span class="card-desc">Vorhandenes Projekt laden (.zip)</span>
      </span>
      <span class="card-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M3 21C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H10.4142L12.4142 5H20C20.5523 5 21 5.44772 21 6V9H19V7H11.5858L9.58579 5H4V16.998L5.5 11H22.5L20.1894 20.2425C20.0781 20.6877 19.6781 21 19.2192 21H3ZM19.9384 13H7.06155L5.56155 19H18.4384L19.9384 13Z"
          />
        </svg>
      </span>
    </button>

    <button class="option-card" onclick={() => importModelEl?.click()}>
      <span class="card-text">
        <span class="card-title">Fertiges Modell importieren</span>
        <span class="card-desc">Trainiertes Modell laden (.zip)</span>
      </span>
      <span class="card-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 18H18V6H6V18ZM14 20H10V22H8V20H5C4.44772 20 4 19.5523 4 19V16H2V14H4V10H2V8H4V5C4 4.44772 4.44772 4 5 4H8V2H10V4H14V2H16V4H19C19.5523 4 20 4.44772 20 5V8H22V10H20V14H22V16H20V19C20 19.5523 19.5523 20 19 20H16V22H14V20ZM8 8H16V16H8V8Z"
          />
        </svg>
      </span>
    </button>
  </div>

  <!-- A button may not contain interactive content, so the two file inputs the
       cards trigger sit outside them. -->
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

  {#if $projectList.length}
    <div class="recent">
      <h2>Zuletzt verwendet</h2>
      <ul class="project-list">
        {#each $projectList as prj (prj.id)}
          <li class="project-row">
            <button class="open-btn" onclick={() => onOpen(prj.id)}>
              <div class="row-main">
                <span class="project-name">{prj.name}</span>
                <div class="row-meta">
                  <span class="mode-chip mode-{prj.mode}">{prj.mode === 'pose' ? 'Pose' : 'Objekt'}</span>
                  <span>{prj.classCount} Klassen</span>
                  {#if prj.hasModel}<span class="badge">Modell</span>{/if}
                </div>
              </div>
              <span class="row-date">{formatDate(prj.updatedAt)}</span>
            </button>
            <div class="row-actions">
              <button
                class="row-btn"
                onclick={() => onDownload(prj.id)}
                title="Projekt herunterladen"
                aria-label="Projekt {prj.name} herunterladen"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1zM5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/>
                </svg>
                <span>Herunterladen</span>
              </button>
              <button
                class="row-btn danger"
                onclick={() => onDelete(prj)}
                title="Projekt löschen"
                aria-label="Projekt {prj.name} löschen"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9zM6 9h12l-.87 10.14A2 2 0 0 1 15.14 21H8.86a2 2 0 0 1-1.99-1.86L6 9z"/>
                </svg>
                <span>Löschen</span>
              </button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style lang="scss">
  .start-screen {
    flex: 1;
    // Same content width as the ml-trainer's page container, so neither the
    // cards nor the project list stretch across a wide window.
    width: 100%;
    max-width: 1180px;
    margin-inline: auto;
    padding: 32px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .hero {
    text-align: center;
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      font-weight: 600;
      color: rgb(var(--md-on-surface));
    }
    p {
      margin: 0;
      color: rgb(var(--md-on-surface-variant));
      font-size: 15px;
    }
  }
  .options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
  }
  // Split card like the "Neue Session" choices on ki-training.calliope.cc/new:
  // heading plus description on the left, a full-height neon square holding an
  // oversized white icon on the right.
  .option-card {
    display: flex;
    align-items: stretch;
    padding: 0;
    overflow: hidden;
    min-height: 160px;
    border: none;
    border-radius: 6px;
    background: rgb(var(--md-surface));
    color: rgb(var(--md-on-surface));
    box-shadow:
      0 10px 15px -3px rgba(0, 0, 0, 0.1),
      0 4px 6px -2px rgba(0, 0, 0, 0.05);
    text-align: left;
    cursor: pointer;
    transition: box-shadow 0.2s, transform 0.2s;
    &:hover {
      transform: translateY(-2px);
      box-shadow:
        0 20px 25px -5px rgba(0, 0, 0, 0.12),
        0 8px 10px -6px rgba(0, 0, 0, 0.06);
      .card-icon {
        background: var(--btn-green-hover);
      }
    }
    &:focus-visible {
      outline: 3px solid rgb(var(--md-primary));
      outline-offset: 2px;
    }
  }
  .card-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 20px;
  }
  .card-title {
    font-size: 20px;
    font-weight: 700;
    line-height: 24px;
  }
  .card-desc {
    font-size: 16px;
    line-height: 24px;
    color: rgb(var(--md-on-surface-variant));
  }
  .card-icon {
    flex: 0 0 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--btn-green);
    color: #fff;
    transition: background 0.2s;
    svg {
      width: 80px;
      height: 80px;
    }
  }
  .recent {
    h2 {
      margin: 0 0 12px;
      font-size: 16px;
      font-weight: 600;
      color: rgb(var(--md-on-surface-variant));
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
  }
  .project-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .project-row {
    display: flex;
    align-items: stretch;
    gap: 4px;
    background: rgba(var(--md-surface-variant), 0.4);
    border-radius: var(--md-radius-md);
    overflow: hidden;
    transition: background 0.15s;
    &:hover {
      background: rgba(var(--md-surface-variant), 0.7);
    }
  }
  .open-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    color: rgb(var(--md-on-surface));
    box-shadow: none;
    min-height: unset;
    .row-main {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .project-name {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-meta {
      display: flex;
      gap: 10px;
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
    }
    .badge {
      background: rgb(var(--md-primary));
      color: rgb(var(--md-on-primary));
      padding: 1px 8px;
      border-radius: 99px;
      font-weight: 600;
      font-size: 11px;
    }
    .mode-chip {
      padding: 1px 8px;
      border-radius: 99px;
      font-weight: 600;
      font-size: 11px;
      &.mode-image {
        background: rgba(158, 196, 26, 0.25);
        color: #5a7d00;
      }
      &.mode-pose {
        background: rgba(0, 229, 255, 0.25);
        color: #006a7a;
      }
    }
    .row-date {
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      flex-shrink: 0;
    }
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 10px;
  }
  .row-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    min-height: unset;
    font-size: 13px;
    font-family: inherit;
    border: 1px solid rgb(var(--md-outline-variant));
    border-radius: 999px;
    background: rgb(var(--md-surface));
    color: rgb(var(--md-on-surface-variant));
    box-shadow: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    &:hover {
      border-color: rgb(var(--md-primary));
      background: rgba(var(--md-primary-container), 0.6);
      color: rgb(var(--md-on-surface));
    }
    &.danger:hover {
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.12);
      color: #ef4444;
    }
  }

  @media (max-width: 860px) {
    .options {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 720px) {
    .row-btn span { display: none; }
    .row-btn { padding: 8px; border-radius: 50%; }
  }
</style>
