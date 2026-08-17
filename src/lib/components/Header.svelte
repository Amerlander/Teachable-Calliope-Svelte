<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Dropdown from './ui/Dropdown.svelte';
  import DropdownItem from './ui/DropdownItem.svelte';
  import { ConnectButton } from '@calliope-edu/mini-connection-widget';
  import {
    showLanguageOverlay,
    showAIInfoOverlay,
    currentLang,
    t
  } from '$lib/stores/app';
  import {
    currentProject,
    closeCurrentProject,
    renameCurrentProject
  } from '$lib/stores/projects';
  import { exportCurrentProject } from '$lib/projects-io';
  import { showNotification } from '$lib/stores/notifications';
  import { classifierModel } from '$lib/stores';
  import {
    cameras,
    cameraLabel,
    refreshCameras,
    selectedCameraId,
    switchCamera
  } from '$lib/stores/camera';

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

  const lang = $derived($currentLang);

  // The camera picker used to sit in each view; it lives here now so there is one
  // place to change the camera from. It only makes sense where a live feed is on
  // screen, and only when there is something to choose between.
  const onCameraView = $derived(
    ['/training', '/tryout', '/apply'].some((p) => $page.url.pathname.startsWith(p))
  );
  const currentCameraId = $derived($selectedCameraId ?? $cameras[0]?.deviceId ?? '');
  const showCameraPicker = $derived(onCameraView && $cameras.length > 1);

  // Devices come and go, so the list is re-read every time the menu opens rather
  // than once at startup.
  $effect(() => {
    if (settingsOpen) void refreshCameras();
  });

  async function pickCamera(deviceId: string) {
    if (!deviceId || deviceId === currentCameraId) return;
    await switchCamera(deviceId);
  }

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
  // The brand is the only way back to the overview now that the back arrow is
  // gone, so it carries what the arrow did: drop the loaded model and close the
  // project before navigating. Kept as a real <a href="/"> so it still reads and
  // behaves like a link (middle-click, open in new tab).
  function onBrandClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    classifierModel.set(null);
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
      {/if}
    </nav>

    <div class="header-right">
      <!-- Icon variant, as campus uses: a status-coloured circle with the
           Calliope logo instead of the labelled pill. It morphs into a short
           pill while transferring (percent, or a spinner for the
           indeterminate phases). -->
      <!-- On /tryout the connection pill is docked into the MakeCode toolbar
           instead, right next to the editor it acts on — showing it here too
           would be the same control twice on one screen. -->
      {#if active !== 'tryout'}
        <ConnectButton appearance="icon" />
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
          {#if $currentProject}
            <DropdownItem onclick={onExport}>{t('training.downloadProject', lang)}</DropdownItem>
          {/if}
          {#if showCameraPicker}
            {#if $currentProject}
              <div class="menu-sep" role="separator"></div>
            {/if}
            <div class="menu-label" id="settings-camera-label">{t('settings.camera', lang)}</div>
            <div class="camera-group" role="group" aria-labelledby="settings-camera-label">
              {#each $cameras as cam, i (cam.deviceId)}
                <DropdownItem
                  selected={cam.deviceId === currentCameraId}
                  onselected={() => pickCamera(cam.deviceId)}
                  title={cameraLabel(cam, i)}
                >
                  {cameraLabel(cam, i)}
                </DropdownItem>
              {/each}
            </div>
            <div class="menu-sep" role="separator"></div>
          {/if}
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

  // Grouping inside the settings menu. The menu itself is white with dark 14px
  // items (see DropdownItem), so these follow the same px metrics.
  .menu-label {
    padding: 8px 16px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: hsl(210, 4%, 45%);
  }
  .menu-sep {
    height: 1px;
    margin: 4px 0;
    background: hsl(156, 12%, 90%);
  }
  // Device labels can be long ("HD Pro Webcam C920 (046d:082d)"); clamp them so
  // one verbose camera can't stretch the whole menu.
  .camera-group :global(.dropdown-item) {
    display: block;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 900px) {
    .header-left { gap: 10px; }
    .brand-link { gap: 10px; }
    .header-title { font-size: 15px; }
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
