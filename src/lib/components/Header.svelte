<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Dropdown from './ui/Dropdown.svelte';
  import DropdownItem from './ui/DropdownItem.svelte';
  import { ConnectButton } from '@calliope-edu/mini-connection-widget';
  import { showLanguageOverlay, showCameraOverlay, showAIInfoOverlay } from '$lib/stores/app';
  import {
    activeModel,
    availableModels,
    currentProject,
    closeCurrentProject,
    renameCurrentProject
  } from '$lib/stores/projects';
  import { activateModel, modelLabel } from '$lib/models';
  import { exportCurrentProject } from '$lib/projects-io';
  import { showNotification } from '$lib/stores/notifications';

  let settingsOpen = $state(false);
  let editingName = $state(false);
  let nameInput = $state('');

  const active = $derived(
    $page.url.pathname.startsWith('/apply')
      ? 'apply'
      : $page.url.pathname.startsWith('/tryout')
        ? 'tryout'
        : 'training',
  );


  // The three project views. `$currentProject` on its own can't decide what the
  // header shows: the layout restores the last project on load, so it is set on
  // the overview too — and there the nav would point into a project the user has
  // not picked yet.
  const onProjectView = $derived(
    ['/training', '/tryout', '/apply'].some((p) => $page.url.pathname.startsWith(p))
  );

  // Newest first. `availableModels` runs oldest-first, the way the history in
  // Trainieren reads; a menu is picked from the top, so it is reversed here.
  const headerModels = $derived([...$availableModels].reverse());

  async function pickModel(id: string) {
    if (id === $activeModel?.id) return;
    try {
      // Loads the weights, and re-labels the open program's class blocks if
      // Programmieren is the view we are on.
      const model = await activateModel(id);
      if (model) showNotification(`Modell „${modelLabel(model)}“ geladen`, { type: 'success' });
    } catch (err) {
      showNotification('Fehler beim Laden: ' + (err as Error).message, { type: 'error' });
    }
  }

  function navTo(view: string) { goto(`/${view}`); }

  function openLanguage() {
    settingsOpen = false;
    showLanguageOverlay.set(true);
  }
  // Always offered, on every view. The picker used to be an inline list that
  // hid itself whenever the browser reported fewer than two devices — which is
  // exactly what a missing permission looks like, so the one control that could
  // have fixed it was the one that disappeared. The overlay asks for the camera
  // itself, so outside the feed views this sets the device for the next start.
  function openCamera() {
    settingsOpen = false;
    showCameraOverlay.set(true);
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
  // The brand is the only way back to the overview now that the back arrow is
  // gone, so it carries what the arrow did: close the project before navigating,
  // which is also what drops the loaded model (see $lib/models). Kept as a real
  // <a href="/"> so it still reads and behaves like a link (middle-click, open
  // in new tab).
  function onBrandClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    closeCurrentProject();
    goto('/');
  }
  async function onExport() {
    settingsOpen = false;
    try {
      await exportCurrentProject();
      showNotification('Projekt exportiert', { type: 'success' });
    } catch (err) {
      showNotification((err as Error).message, { type: 'error' });
    }
  }
</script>

<header id="main-header">
  <div class="header-inner">
    <div class="header-left">
      <a class="brand-link" href="/" onclick={onBrandClick} title="Zur Startseite">
        <svg width="35" height="35" xmlns="http://www.w3.org/2000/svg" xml:space="preserve"
          style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2"
          viewBox="0 0 27 26" class="logo-icon">
          <path d="M24.84.52h-4.62c-.69 0-1.26.56-1.26 1.26v3.48A5.26 5.26 0 0 0 13.7 0c-2.9 0-5.26 2.36-5.26 5.26v5.78L2.2 15.72c-4.21 3.21-1.94 9.93 3.36 9.93h1.25c.53-3.87 1.74-8.66 4.19-11.56h5.71c2.49 2.94 3.55 7.67 4.06 11.56h1.77c1.96 0 3.56-1.59 3.56-3.56V1.78c0-.69-.56-1.26-1.26-1.26M11.68 3.37h4.34V6.3c0 .95-.77 1.71-1.71 1.71h-.91c-.95 0-1.71-.77-1.71-1.71V3.37zm-1.03 8.49 1.97-3.76 1.17 3.76zm3.24 0 1.18-3.79 1.96 3.79zm11.25-3.25h-5.22V2.18h5.22z"
            style="fill:#fff;fill-rule:nonzero" transform="translate(-.012)" />
          <path d="M11.14 14.09v11.56h6.91c-2.79-2-5.07-7.24-6.91-11.56"
            style="fill:#fff;fill-rule:nonzero" transform="translate(-.012)" />
        </svg>

        <span class="header-title">Calliope Teachable Machine</span>
      </a>

      {#if $currentProject}
        <div class="project-bar">
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
        </div>
      {/if}
    </div>

    <nav class="header-center">
      {#if $currentProject && onProjectView}
        <button class="header-btn" class:active={active === 'training'} onclick={() => navTo('training')}>
          Trainieren
        </button>
        <button class="header-btn" class:active={active === 'tryout'} onclick={() => navTo('tryout')}>
          Programmieren
        </button>
        <button class="header-btn" class:active={active === 'apply'} onclick={() => navTo('apply')}>
          Anwenden
        </button>
      {/if}
    </nav>

    <div class="header-right">
      <!-- Which model is loaded, and the one place to change it. It used to be
           asked once per view — a picker in Anwenden, one per program card in
           Programmieren — but nothing is bound to a model any more: the classes
           a program's blocks show come from whichever one is loaded. So it is a
           single app-wide setting, and it belongs where the other ones are. -->
      {#if $currentProject && onProjectView && $availableModels.length}
        <Dropdown placement="bottom-end" minWidth="260px">
          {#snippet trigger()}
            <button
              class="model-btn"
              class:empty={!$activeModel}
              title={$activeModel ? `Modell: ${modelLabel($activeModel)}` : 'Kein Modell geladen'}
            >
              <span class="model-caption">Modell</span>
              <span class="model-name">
                {$activeModel ? modelLabel($activeModel) : 'keines'}
              </span>
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 9.5 12 15.5 18 9.5"
                />
              </svg>
            </button>
          {/snippet}
          {#snippet children()}
            <!-- Newest first, the direction the model list in Trainieren runs in. -->
            {#each headerModels as model (model.id)}
              <DropdownItem
                selected={model.id === $activeModel?.id}
                onselected={() => pickModel(model.id)}
                title={modelLabel(model)}
              >
                <span class="model-option">
                  <span class="option-name">{modelLabel(model)}</span>
                  <span class="option-meta">
                    {model.classes.length} Klassen
                    {#if model.mode === 'pose'}· Pose{/if}
                    {#if model.source === 'imported'}· importiert{/if}
                  </span>
                </span>
              </DropdownItem>
            {/each}
          {/snippet}
        </Dropdown>
      {/if}

      <!-- Icon variant, as campus uses: a status-coloured circle with the
           Calliope logo instead of the labelled pill. It morphs into a short
           pill while transferring (percent, or a spinner for the
           indeterminate phases). -->
      <ConnectButton appearance="icon" />

      <Dropdown bind:isOpen={settingsOpen} minWidth="200px">
        {#snippet trigger()}
          <button class="settings-btn" aria-label="Einstellungen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        {/snippet}
        {#snippet children()}
          {#if $currentProject}
            <DropdownItem onclick={onExport}>Projekt herunterladen</DropdownItem>
            <div class="menu-sep" role="separator"></div>
          {/if}
          <DropdownItem onclick={openCamera}>Kamera</DropdownItem>
          <DropdownItem onclick={openLanguage}>Sprachen</DropdownItem>
          <DropdownItem onclick={openAIInfo}>KI-Hinweise</DropdownItem>
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
  // Three tracks so the nav sits in the true centre of the header, independent
  // of how wide the project name on the left grows.
  .header-inner {
    width: 100%;
    min-height: 40px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    column-gap: 12px;
  }
  .header-left { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .header-center { display: flex; align-items: center; justify-content: center; gap: 8px; }
  .header-right { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }

  // Brand block matches the campus header: 24px mark, 16px/600 wordmark.
  .brand-link {
    display: flex;
    align-items: center;
    gap: 16px;
    text-decoration: none;
    color: inherit;
    transition: opacity 0.2s ease;
    &:hover { opacity: 0.8; }
  }
  .logo-icon {
    width: auto;
    height: 24px;
    flex-shrink: 0;
  }
  .header-title {
    font-size: 16px;
    color: white;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
  }
  .project-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-left: 12px;
    border-left: 1px solid rgba(255, 255, 255, 0.15);
    min-width: 0;
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
  // Field-shaped rather than button-shaped, like the model picker in Anwenden
  // was: a caption, the value, a chevron. On the dark bar that means a hairline
  // outline instead of a border.
  .model-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 280px;
    padding: 5px 10px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 20px;
    background: rgba(0, 0, 0, 0.18);
    color: rgba(255, 255, 255, 0.93);
    font: inherit;
    font-size: 13px;
    min-height: unset;
    box-shadow: none;
    cursor: pointer;
    transition: background-color 0.2s, border-color 0.2s;

    &:hover {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.5);
    }
    svg { opacity: 0.7; flex-shrink: 0; }
    &:hover svg { opacity: 1; }
    &.empty .model-name { font-style: italic; opacity: 0.75; }
  }
  .model-caption {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.6;
    flex-shrink: 0;
  }
  .model-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  // Menu items are dark on white (see DropdownItem), so these follow that scale
  // rather than the header's.
  .model-option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .option-name { font-weight: 500; }
  .option-meta {
    font-size: 11px;
    color: hsl(210, 4%, 40%);
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

  // Separates the project action from the app-wide settings below it. The menu is
  // white with dark 14px items (see DropdownItem), so this follows those metrics.
  .menu-sep {
    height: 1px;
    margin: 4px 0;
    background: hsl(156, 12%, 90%);
  }

  @media (max-width: 900px) {
    .header-left { gap: 10px; }
    .brand-link { gap: 10px; }
    .header-title { font-size: 15px; }
    // The value alone still reads as the model; the caption is what goes first.
    .model-caption { display: none; }
    .model-btn { max-width: 180px; }
  }

  @media (max-width: 720px) {
    #main-header { padding: 6px 10px; }
    .header-inner {
      grid-template-columns: 1fr auto;
      row-gap: 4px;
    }
    .header-left { grid-column: 1; }
    .header-right { grid-column: 2; }
    .header-center { grid-column: 1 / -1; justify-content: center; flex-wrap: wrap; gap: 6px; }
  }
</style>
