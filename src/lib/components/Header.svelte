<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Dropdown from './ui/Dropdown.svelte';
  import DropdownItem from './ui/DropdownItem.svelte';
  import { ConnectButton } from '@calliope-edu/mini-connection-widget';
  import {
    appMode,
    showLanguageOverlay,
    showAIInfoOverlay,
    currentLang,
    t
  } from '$lib/stores/app';
  import {
    currentProject,
    closeCurrentProject,
    renameCurrentProject,
    deleteProject
  } from '$lib/stores/projects';
  import { exportCurrentProject } from '$lib/projects-io';
  import { showNotification } from '$lib/stores/notifications';
  import { classifierModel } from '$lib/stores';

  let settingsOpen = $state(false);
  let editingName = $state(false);
  let nameInput = $state('');
  let projectMenuOpen = $state(false);

  const active = $derived(
    $page.url.pathname.startsWith('/apply')
      ? 'apply'
      : $page.url.pathname.startsWith('/tryout')
        ? 'tryout'
        : 'training',
  );

  const lang = $derived($currentLang);

  function navTo(view: string) { goto(`/${view}`); }

  function openLanguage() {
    settingsOpen = false;
    showLanguageOverlay.set(true);
  }
  function openAIInfo() {
    settingsOpen = false;
    showAIInfoOverlay.set(true);
  }

  function startEditName() {
    nameInput = $currentProject?.name ?? '';
    editingName = true;
  }
  async function commitEditName() {
    if (editingName && nameInput.trim() && nameInput.trim() !== $currentProject?.name) {
      await renameCurrentProject(nameInput.trim());
    }
    editingName = false;
  }
  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') editingName = false;
  }
  function onBackToStart() {
    classifierModel.set(null);
    closeCurrentProject();
    goto('/');
  }
  async function onExport() {
    projectMenuOpen = false;
    try {
      await exportCurrentProject();
      showNotification('Projekt exportiert', { type: 'success' });
    } catch (err) {
      showNotification((err as Error).message, { type: 'error' });
    }
  }
  async function onDeleteProject() {
    projectMenuOpen = false;
    if (!$currentProject) return;
    if (!confirm(`Projekt "${$currentProject.name}" wirklich löschen?`)) return;
    classifierModel.set(null);
    await deleteProject($currentProject.id);
    showNotification('Projekt gelöscht', { type: 'success' });
  }
</script>

<header id="main-header">
  <div class="header-inner">
    <div class="header-left">
      <svg width="35" height="35" xmlns="http://www.w3.org/2000/svg" xml:space="preserve"
        style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2"
        viewBox="0 0 27 26" class="logo-icon">
        <path d="M24.84.52h-4.62c-.69 0-1.26.56-1.26 1.26v3.48A5.26 5.26 0 0 0 13.7 0c-2.9 0-5.26 2.36-5.26 5.26v5.78L2.2 15.72c-4.21 3.21-1.94 9.93 3.36 9.93h1.25c.53-3.87 1.74-8.66 4.19-11.56h5.71c2.49 2.94 3.55 7.67 4.06 11.56h1.77c1.96 0 3.56-1.59 3.56-3.56V1.78c0-.69-.56-1.26-1.26-1.26M11.68 3.37h4.34V6.3c0 .95-.77 1.71-1.71 1.71h-.91c-.95 0-1.71-.77-1.71-1.71V3.37zm-1.03 8.49 1.97-3.76 1.17 3.76zm3.24 0 1.18-3.79 1.96 3.79zm11.25-3.25h-5.22V2.18h5.22z"
          style="fill:#fff;fill-rule:nonzero" transform="translate(-.012)" />
        <path d="M11.14 14.09v11.56h6.91c-2.79-2-5.07-7.24-6.91-11.56"
          style="fill:#fff;fill-rule:nonzero" transform="translate(-.012)" />
      </svg>

      <span class="header-title">Calliope Teachable Machine</span>

      {#if $appMode}
        <span class="mode-badge mode-badge-{$appMode}">
          {$appMode === 'pose' ? 'POSE' : 'OBJEKT'}
        </span>
      {/if}

      {#if $currentProject}
        <div class="project-bar">
          <button class="icon-btn" title="Zurück zur Übersicht" aria-label="Zurück" onclick={onBackToStart}>
            ←
          </button>
          {#if editingName}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="project-name-input"
              bind:value={nameInput}
              onblur={commitEditName}
              onkeydown={onNameKey}
              autofocus
            />
          {:else}
            <button class="project-name-btn" onclick={startEditName} title="Umbenennen">
              {$currentProject.name}
              <span class="edit-hint">✎</span>
            </button>
          {/if}
          <Dropdown bind:isOpen={projectMenuOpen} placement="bottom-end">
            {#snippet trigger()}
              <button class="icon-btn" aria-label="Projekt-Menü">⋯</button>
            {/snippet}
            {#snippet children()}
              <DropdownItem onclick={onExport}>Projekt herunterladen</DropdownItem>
              <DropdownItem onclick={onDeleteProject}>Projekt löschen</DropdownItem>
            {/snippet}
          </Dropdown>
        </div>
      {/if}
    </div>

    <div class="header-right">
      <ConnectButton appearance="dark" />
      {#if $currentProject}
        <button class="header-btn" class:active={active === 'training'} onclick={() => navTo('training')}>
          {t('header.training', lang)}
        </button>
        <button class="header-btn" class:active={active === 'tryout'} onclick={() => navTo('tryout')}>
          {t('header.tryout', lang)}
        </button>
        <button class="header-btn" class:active={active === 'apply'} onclick={() => navTo('apply')}>
          {t('header.apply', lang)}
        </button>
        <!-- <button class="header-btn ghost-tab" onclick={() => navTo('')} title="Projektübersicht">
          ⌂
        </button> -->
      {/if}

      <Dropdown bind:isOpen={settingsOpen} minWidth="200px">
        {#snippet trigger()}
          <button class="settings-btn" aria-label={t('header.settings', lang)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        {/snippet}
        {#snippet children()}
          <DropdownItem onclick={openLanguage}>{t('settings.language', lang)}</DropdownItem>
          <DropdownItem onclick={openAIInfo}>{t('settings.aiInfo', lang)}</DropdownItem>
        {/snippet}
      </Dropdown>
    </div>
  </div>
</header>

<style lang="scss">
  #main-header {
    background: #1b1c1d;
    width: 100%;
    z-index: 100000000;
    padding: 8px 24px;
  }
  .header-inner {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .logo-icon {
    width: clamp(30px, 5vw, 35px);
    height: clamp(30px, 5vw, 35px);
    flex-shrink: 0;
  }
  .header-title {
    font-size: clamp(15px, 2.6vw, 18px);
    color: white;
    font-weight: 500;
    white-space: nowrap;
  }
  .mode-badge {
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    &.mode-badge-image {
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.35);
    }
    &.mode-badge-pose {
      background: #00e5ff;
      color: #003040;
      border: 1px solid #00b8cc;
    }
  }
  .header-right { display: flex; align-items: center; gap: 12px; }
  .project-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
    padding-left: 12px;
    border-left: 1px solid rgba(255, 255, 255, 0.15);
  }
  .icon-btn {
    width: 32px;
    height: 32px;
    min-height: unset;
    padding: 0;
    font-size: 16px;
    border-radius: 50%;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    box-shadow: none;
    &:hover { background: rgba(255, 255, 255, 0.12); }
  }
  .project-name-btn {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 15px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    min-height: unset;
    box-shadow: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    .edit-hint { opacity: 0; font-size: 12px; }
    &:hover {
      background: rgba(255, 255, 255, 0.12);
      .edit-hint { opacity: 0.8; }
    }
  }
  .project-name-input {
    font-size: 15px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.4);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    max-width: 240px;
  }
  .settings-btn {
    padding: 8px 18px;
    border-radius: 20px;
    background-color: transparent;
    border: 1px solid transparent;
    color: rgba(255, 255, 255, 0.93);
    cursor: pointer;
    transition: background-color 0.2s, color 0.2s;
    display: flex; align-items: center; justify-content: center;
    min-height: unset;
    box-shadow: none;
    &:hover { background-color: rgba(250, 250, 250, 0.6); color: black; }
  }

  @media (max-width: 720px) {
    #main-header { padding: 6px 10px; }
    .header-inner { flex-wrap: wrap; row-gap: 4px; column-gap: 8px; justify-content: center; }
    .header-left { flex: 1 1 100%; justify-content: center; gap: 8px; }
    .header-right { flex: 1 1 100%; justify-content: center; gap: 6px; flex-wrap: wrap; }
  }
</style>
