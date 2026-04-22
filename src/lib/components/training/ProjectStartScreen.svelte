<script lang="ts">
  import { onMount } from 'svelte';
  import {
    projectList,
    refreshProjectList,
    loadProject,
    deleteProject
  } from '$lib/stores/projects';
  import {
    newProject,
    importProjectFromFile,
    importModelAsNewProject
  } from '$lib/projects-io';
  import { loadClassifierFromArtifacts } from '$lib/machine';
  import { currentProject } from '$lib/stores/projects';
  import { showNotification } from '$lib/stores/notifications';
  import { get } from 'svelte/store';

  let importProjectEl: HTMLInputElement;
  let importModelEl: HTMLInputElement;

  onMount(() => {
    void refreshProjectList();
  });

  async function onCreate() {
    try {
      await newProject();
    } catch (err) {
      showNotification('Projekt konnte nicht erstellt werden', { type: 'error' });
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

  async function onOpen(id: string) {
    const p = await loadProject(id);
    if (p?.modelArtifacts) {
      try {
        await loadClassifierFromArtifacts(p.modelArtifacts);
      } catch {
        /* ignore */
      }
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`Projekt "${name}" wirklich löschen?`)) return;
    await deleteProject(id);
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

<div class="start-screen">
  <div class="hero">
    <h1>Projekt wählen</h1>
    <p>Starte ein neues Projekt, importiere ein bestehendes oder lade ein fertiges Modell.</p>
  </div>

  <div class="options">
    <button class="option-card" onclick={onCreate}>
      <div class="icon">＋</div>
      <div class="title">Neues Projekt</div>
      <div class="desc">Klassen aufnehmen, Modell trainieren</div>
    </button>

    <button class="option-card" onclick={() => importProjectEl?.click()}>
      <div class="icon">↥</div>
      <div class="title">Projekt importieren</div>
      <div class="desc">Vorhandenes Projekt laden (.zip)</div>
      <input
        bind:this={importProjectEl}
        type="file"
        accept=".zip"
        style="display:none"
        onchange={onProjectImport}
      />
    </button>

    <button class="option-card" onclick={() => importModelEl?.click()}>
      <div class="icon">⚙</div>
      <div class="title">Fertiges Modell importieren</div>
      <div class="desc">Trainiertes Modell laden (.zip)</div>
      <input
        bind:this={importModelEl}
        type="file"
        accept=".zip"
        style="display:none"
        onchange={onModelImport}
      />
    </button>
  </div>

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
                  <span>{prj.classCount} Klassen</span>
                  {#if prj.hasModel}<span class="badge">Modell</span>{/if}
                </div>
              </div>
              <span class="row-date">{formatDate(prj.updatedAt)}</span>
            </button>
            <button
              class="delete-btn ghost"
              title="Löschen"
              aria-label="Projekt löschen"
              onclick={() => onDelete(prj.id, prj.name)}
            >
              ✕
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style lang="scss">
  .start-screen {
    flex: 1;
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
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }
  .option-card {
    background: rgb(var(--md-surface-variant));
    border: 2px solid transparent;
    border-radius: var(--md-radius-lg);
    padding: 24px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: none;
    min-height: unset;
    color: rgb(var(--md-on-surface));
    &:hover {
      background: rgb(var(--md-primary-container));
      border-color: rgb(var(--md-primary));
      transform: translateY(-2px);
      box-shadow: var(--md-elevation-2);
    }
    .icon {
      font-size: 40px;
      margin-bottom: 12px;
      color: rgb(var(--md-primary));
      font-weight: 300;
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .desc {
      font-size: 13px;
      color: rgb(var(--md-on-surface-variant));
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
    .row-date {
      font-size: 12px;
      color: rgb(var(--md-on-surface-variant));
      flex-shrink: 0;
    }
  }
  .delete-btn {
    padding: 0 14px;
    min-height: unset;
    align-self: stretch;
    box-shadow: none;
    color: rgb(var(--md-on-surface-variant));
    border-radius: 0;
    &:hover {
      background: rgba(var(--md-error), 0.15);
      color: rgb(var(--md-error));
    }
  }
</style>
